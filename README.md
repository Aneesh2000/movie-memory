# Movie Memory

Sign in with Google, tell us your favourite movie, and get a fun fact about it from OpenAI.

**Live demo:** https://movie-memory-seven.vercel.app

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Neon Postgres · Prisma 6 (`pg` driver adapter) · Auth.js v5 (Google) · OpenAI · Vitest

---

## Variant chosen: A (backend caching and correctness)

**I chose Variant A.** The hard part of this app is the fact endpoint: it's the only thing that costs money (OpenAI) and the only thing exposed to concurrency (refreshes, several tabs). Those bugs don't show up in a normal click-through: duplicate generations, a lock that never releases, one user seeing another's fact. So that's where careful design pays off most. A Postgres lease also lets me reason about correctness across serverless instances, which an in-memory approach can't.

What Variant A covers here:

- **60-second cache window** per user + movie: `lib/facts/service.ts`
- **Burst protection** with a "generation in progress" lease in Postgres, taken in one atomic SQL statement: `lib/facts/prisma-repo.ts`
- **Failure handling:** if OpenAI fails, the last fact is returned, otherwise a friendly 503
- **Tests** for the cache window and for authorization (one user can't fetch another's facts): `tests/fact-service.test.ts`, `tests/api-routes.test.ts`

**I also implemented Variant B**, because the client needed solid behaviour around the same endpoint anyway: a typed API layer (`GET /api/me`, `PUT /api/me/movie`, `GET /api/fact`) with a typed client in `lib/api.ts`, inline movie editing with an optimistic update and revert on failure, a 30-second client cache, and tests for the API client and the edit flow. Variant A is the primary submission; Variant B sits on top of it without changing its guarantees. The table below shows how the two layers fit together.

---

## How it fits together

Fact handling has two layers that complement each other rather than overlap:

| Concern | Server | Client |
|---|---|---|
| Cache | 60s per user + movie, in Postgres. Protects cost and correctness. | 30s in `sessionStorage`. Saves a round-trip on reload. |
| Burst protection | Per-user DB lease. Only one OpenAI call at a time. | Aborts superseded requests. Only the latest response updates the UI. |
| Failures | Falls back to the last fact, else a friendly 503. | Typed `ApiError` with loading, error and retry states. |
| Tests | Cache window, lease, fallback, authorization | API client errors, optimistic edit flow |

---

## Setup

Prerequisites: Node 20+, a Postgres database, a Google OAuth client, and an OpenAI API key.

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then fill it in (see Environment variables below)
npm run db:deploy           # creates the tables (applies prisma/migrations)
npm run dev                 # http://localhost:3000
```

**Getting a database**, either one:

- **Neon (free, what the live demo uses):** create a project at [neon.tech](https://neon.tech). Put the pooled connection string in `DATABASE_URL` and the direct one in `DATABASE_URL_UNPOOLED`. With the Neon CLI, `neon env pull` writes both for you.
- **Local Docker:** `docker compose up -d`, then set both variables to `postgresql://postgres:postgres@localhost:5432/movie_memory`.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** URL (`-pooler` host), used by the app. Written by `neon env pull`. |
| `DATABASE_URL_UNPOOLED` | yes | Neon **direct** URL, used by Prisma Migrate. Written by `neon env pull`. |
| `AUTH_SECRET` | yes | `npx auth secret` or `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | yes | Google Cloud Console → Credentials → OAuth client ID (Web) |
| `OPENAI_API_KEY` | yes | Server-only, never sent to the browser |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o-mini` |
| `AUTH_TRUST_HOST` | no | `true` when self-hosting behind a proxy (not needed on Vercel) |

Google OAuth **Authorised redirect URI**: `http://localhost:3000/api/auth/callback/google` (plus your production URL, see Deploying).

### Database driver

Prisma talks to Neon through the `pg` (node-postgres) driver adapter on the **pooled** URL, per Neon's guidance for Vercel's Node.js runtime. `lib/db.ts` creates one small pool per function instance and registers it with `attachDatabasePool` from `@vercel/functions`, so Vercel closes idle connections before suspending an instance. Migrations use the **direct** URL: PgBouncer's transaction mode breaks Prisma Migrate's prepared statements.

### Database migrations

- `npm run db:migrate`: create or apply migrations in development (`prisma migrate dev`)
- `npm run db:deploy`: apply committed migrations in production (`prisma migrate deploy`)
- The initial migration is committed in `prisma/migrations/20261109000000_init`.

### Scripts

`npm test` · `npm run test:db` (integration tests against the real database) · `npm run typecheck` · `npm run lint` · `npm run build`

---

## Architecture overview

```
app/
  page.tsx                    Landing: "Sign in with Google" (redirects to /dashboard if signed in)
  onboarding/                 First-time only: favourite-movie form + server action
  dashboard/                  Profile, logout, inline movie editor, fact panel
  api/auth/[...nextauth]/     Auth.js handlers
  api/me                      GET    current user
  api/me/movie                PUT    change favourite movie
  api/fact                    GET    fact for the current movie (server cache + lease)
auth.ts                       Auth.js config: Google provider, Prisma adapter, DB sessions
neon.ts, .neon                Neon project config and link (CLI)
lib/
  session.ts                  Data-access layer: getSessionUserId / requireUser
  movie.ts                    Shared zod validation for movie titles
  api-types.ts                API contract: zod schemas + inferred TS types
  api.ts                      Typed fetch client + ApiError
  fact-cache.ts, use-fact.ts  30s client cache + fact state hook
  facts/service.ts            Cache window, lease, fallback. Pure, injectable
  db.ts                       Prisma client over a `pg` pool (Neon pooled URL, Vercel-aware)
  facts/prisma-repo.ts        Postgres implementation of the repo + lease SQL
  openai.ts                   server-only OpenAI call with timeout/retry limits
components/                   MovieEditor, FactPanel, UI primitives
tests/                        Vitest: service, routes, API client, editor, validation
```

### Auth flow

1. `/` shows the landing page. The sign-in button is a server action calling `signIn("google", { redirectTo: "/dashboard" })`.
2. After Google returns, Auth.js (Prisma adapter) upserts `User` and `Account` and creates a `Session` row. The browser gets only an opaque httpOnly cookie.
3. `/dashboard` runs `requireUser()`. With no session it redirects to `/`. If `favoriteMovie` is null (a first-time user) it redirects to `/onboarding`.
4. `/onboarding` redirects returning users (movie already set) to `/dashboard`.

"First-time vs returning" is derived from data (`favoriteMovie IS NULL`), not from a first-login event. A user who signs in and abandons onboarding is correctly sent back to it next time.

**Database sessions over JWT:** sessions can be revoked server-side, and the cookie carries no user data. The cost is one indexed lookup per request, which is negligible here.

**Guards in pages and routes, not in `proxy.ts`:** with database sessions, the authoritative check needs the database. Every page, route handler and server action checks the session itself, so nothing depends on a single edge filter.

### Data model

```
User ─┬─< Account                (Auth.js)
      ├─< Session                (Auth.js)
      ├─< Fact (userId, movie, content, createdAt)
      └── FactGenerationLock (userId PK, token, lockedUntil)
```

- **`User.favoriteMovie` is a nullable `VARCHAR(120)` column, not a table.** There's one per user, a separate table would only add a join, and `NULL` doubles as the "needs onboarding" signal.
- **`Fact.movie` is a snapshot of the title.** The cache key is *user + movie*. When the movie changes, old facts stop matching with no invalidation code, and they stay as history.
- **Index `(userId, movie, createdAt DESC)`** makes the hot query, "latest fact for this user and movie", a single index seek.
- **`FactGenerationLock`** is the burst-protection lease. It's its own table so the lock doesn't churn the `User` row or tangle with Auth.js writes.
- **All relations use `ON DELETE CASCADE`,** so deleting a user removes everything they own.

### Fact generation: `lib/facts/service.ts`

```
movie  = user's favouriteMovie               → none: 409 NO_MOVIE
latest = newest fact for (user, movie)
if latest is < 60s old                       → return it            (source: "cache")
try to acquire the per-user lease
├─ lost (another tab or refresh is generating):
│     poll up to 8s for a newer fact         → return it            (source: "cache")
│     else latest                            → return it            (source: "stale")
│     else                                   → 503 FACT_PENDING
└─ won:
      re-check freshness (double-checked locking)
      call OpenAI (10s timeout, 1 retry)
      ├─ ok   → insert fact                  → return it            (source: "fresh")
      └─ fail → latest exists                → return it            (source: "fallback")
                else                         → 503 FACT_UNAVAILABLE
      finally release the lease (only if our token still owns it)
```

**Why a lease (the "generation in progress" flag option):**

```sql
INSERT INTO "FactGenerationLock" ("userId","token","lockedUntil")
VALUES ($1, $2, now() + 30s)
ON CONFLICT ("userId") DO UPDATE SET token = EXCLUDED.token, "lockedUntil" = EXCLUDED."lockedUntil"
WHERE "FactGenerationLock"."lockedUntil" < now()
RETURNING "userId";        -- a row back = acquired
```

- **Atomic in one statement.** It's correct across tabs *and* across server instances or serverless functions, unlike an in-memory lock.
- **No DB connection held during the OpenAI call.** An advisory lock or `SELECT … FOR UPDATE` would pin a pooled connection for seconds, which hurts on serverless.
- **Self-healing.** If a request crashes, the lease expires after 30s. That's longer than the worst-case OpenAI call (10s × 2).
- **Owner-only release.** The random token means a slow request whose lease already expired can't delete a newer owner's lease.
- **No time-bucket edge cases.** A "unique per 60s window" constraint lets two requests at :59 and :01 both through.

Losers wait for the winner's fact instead of failing. Two tabs opening at once both show the same fact, and only one OpenAI call is made.

**Safe OpenAI usage:**
- `lib/openai.ts` imports `server-only`, so importing it from a client component fails the build.
- The key is read only from `process.env` at call time.
- The movie title is passed as delimited user content, and the system prompt says to treat it as a title, never as instructions.
- Output is capped at 200 tokens and 600 characters, and an empty reply counts as a failure.
- Raw OpenAI errors are logged server-side and never returned to the client.

### API contract and client state

Every response is either the typed body or `{ "error": { "code", "message" } }`.

| Endpoint | Success | Errors |
|---|---|---|
| `GET /api/me` | `{ user: { id, name, email, image, favoriteMovie } }` | 401 |
| `PUT /api/me/movie` `{ movie }` | `{ favoriteMovie }` (normalised) | 400 `VALIDATION_ERROR`, 401 |
| `GET /api/fact` | `{ fact: { id, movie, content, createdAt }, source, freshUntil }` | 401, 409 `NO_MOVIE`, 503 `FACT_PENDING` / `FACT_UNAVAILABLE` |

`lib/api-types.ts` defines the contract once as zod schemas. Route handlers use the inferred types. `lib/api.ts` **validates responses at runtime**, so a contract drift surfaces as `BAD_RESPONSE` instead of `undefined` deep in the UI.

`lib/api.ts` normalises every failure into one `ApiError { status, code, message }`:
- **Error envelope from our server:** keeps the server's code and message.
- **Non-JSON error (proxy HTML page, bare 401):** a code derived from the status, with a friendly message. Bodies are never shown.
- **`fetch` throws:** `NETWORK_ERROR` with status 0.
- **Aborts:** re-thrown untouched so callers can ignore them.

**Inline edit (`components/movie-editor.tsx`):**
1. Clicking Save validates with the same zod rules the server uses.
2. The new title shows immediately (optimistic) and a "Saving…" status appears.
3. On success, the server's normalised value is shown and the parent is notified.
4. On failure, the title reverts, the editor reopens with the user's draft so they can retry, and the error shows.
5. A 401 sends the user to sign-in.

**Client cache (`lib/fact-cache.ts`, `lib/use-fact.ts`):** a plain React hook plus `sessionStorage`, no React Query or SWR.
- **Why no library:** there's one query, with one rule ("reuse for 30s unless forced, drop when the movie changes"). A library would bring its own cache-time and refetch-on-focus semantics I'd need to configure against. A 100-line hook is easier to read and explain.
- **Why `sessionStorage`:** it survives a reload, which is when a 30s cache saves a request. It's per-tab and cleared when the tab closes. The key includes the user id, and it's cleared on logout.
- **Invalidation:** the hook keys off the *server-confirmed* movie, not the optimistic one. It never fetches a fact for a title the server hasn't accepted. When the confirmed movie changes, the entry is cleared and refetched.
- **Races:** each fetch aborts the previous one, so a slow response for the old movie can't overwrite the new movie's fact.
- **"New fact" button:** bypasses the client cache. If the server's 60s window returns the same fact, the UI says when a new one unlocks (`freshUntil`).

### Security checklist

- **Server-side movie validation** in both the onboarding action and `PUT`: NFC normalisation, whitespace collapsing, trimming, 1–120 characters, no control characters, plus a `VARCHAR(120)` column limit.
- **No cross-user access:** the user id comes only from the session. No route takes a user id, fact id or movie from the request for reads, and `PUT` ignores any `userId` in the body. A test covers this.
- **No secrets on the client:** OpenAI, Prisma and Auth.js are server-only, there are no `NEXT_PUBLIC_` secrets, and errors are sanitised.
- **Missing Google name or photo:** the name falls back to the email prefix, then "Movie fan". The avatar falls back to an initial.
- **Onboarding is idempotent:** `updateMany … where favoriteMovie IS NULL` makes a double submit a no-op.

---

## Tests

`npm test` runs 53 tests in about 1 second. None need a database or network.

| File | Covers |
|---|---|
| `tests/fact-service.test.ts` | 60s boundary (59.999s cached, 60s regenerates), per-movie keying, OpenAI failure with and without a cached fact, lease release after failure, **5 concurrent requests → 1 generation**, stale and pending paths, expired-lease takeover, no cross-user facts |
| `tests/api-routes.test.ts` | 401 when signed out, user A never gets user B's fact, `PUT` scoped to the session user even with `userId` in the body, validation 400s, clean 500 |
| `tests/api-client.test.ts` | 401 (with and without envelope), 500 HTML page, 503 passthrough, network error, contract mismatch, aborts, success parsing |
| `tests/movie-editor.test.tsx` | Optimistic update then confirm, revert on server failure, Cancel, client-side validation, server normalisation, 401 redirect |
| `tests/movie-and-cache.test.ts` | Validation rules, 30s client-cache window and movie invalidation |

The service is tested through an in-memory repo with the same lease semantics as the SQL, and an injected clock.

`npm run test:db` runs `tests/neon.int.test.ts` against the real Neon database: 8 concurrent lease acquisitions (exactly one wins), owner-only release, expired-lease takeover, and 5 concurrent fact requests producing exactly one stored fact. It creates its own user and deletes it afterwards.

---

## Key tradeoffs

- **App clock for freshness, DB clock for the lease.** `Fact.createdAt` is set from the app clock and compared with the app clock, so they're consistent. Across many instances, small clock skew could shift the 60s window by milliseconds. The lease uses `now()` in Postgres, where agreement matters more.
- **Polling while a peer generates** (up to 8s) instead of LISTEN/NOTIFY or SSE. It's simple and stateless. The cost is a few cheap indexed reads.
- **The lease is per user, not per user + movie.** Users have one movie, so this is simpler. A movie change mid-generation just waits a moment.
- **Facts are append-only.** That keeps history and makes "latest" trivial. A cleanup job would be needed eventually.
- **Optimistic UI only for the movie edit.** Fact generation can't be predicted, so it shows loading states instead.
- **Cache Components (Next 16 default) left on.** Session-dependent UI streams in behind `<Suspense>`, and `connection()` marks session reads as request-time.

## With 2 more hours

- Run the database integration tests on a throwaway Neon branch per CI run (`neon checkout ci-<sha> --create`).
- Per-user rate limiting on `GET /api/fact` and `PUT /api/me/movie`.
- Playwright end-to-end tests for the auth redirects (with a mocked Google provider).
- Streaming the fact token-by-token, and using the DB clock for the 60s window as well.
- Structured logging and metrics (cache hit rate, OpenAI latency and failures).
- A retention job for old facts.

---

## Deploying

The live demo runs on **Vercel (Hobby) + Neon (free Postgres)**. GitHub Pages can't host it: it only serves static files, and this app needs a server for the OAuth callback, server actions, API routes, the database and secrets.

1. **Database:** create it on Neon and run `npm run db:deploy` against it once.
2. **Create the Vercel project:** either import the GitHub repo at [vercel.com/new](https://vercel.com/new) (deploys on every push), or use the CLI: `vercel link`, then `vercel deploy --prod`.
3. **Environment variables** (Vercel → Settings → Environment Variables, or `vercel env add`): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OPENAI_API_KEY`. `AUTH_TRUST_HOST` isn't needed on Vercel.
4. **Google Cloud Console → your OAuth client:**
   - Add `https://<your-app>.vercel.app` to *Authorised JavaScript origins*.
   - Add `https://<your-app>.vercel.app/api/auth/callback/google` to *Authorised redirect URIs*. Changes can take a few minutes to apply.
   - If the consent screen is in "Testing" mode, add your users as test users, or publish it.

OpenAI is pay-as-you-go: each fact costs a fraction of a cent with `gpt-4o-mini`.

---

## AI usage

- Used an AI coding assistant to turn the requirements into a design: schema, auth flow, the lease approach and its alternatives, and the API contract.
- Used it to scaffold code and tests, then reviewed every file. I can explain every decision above.
- Used it to work through Next.js 16 specifics: `proxy.ts` replacing middleware, Cache Components requiring `<Suspense>` around session reads, `connection()`, and `unstable_rethrow` in route-handler error wrappers.
- Typecheck, lint, the test suite and a production build were run locally to verify the code. The Google sign-in round trip and real OpenAI calls need real credentials, so they are verified by hand against a running instance.
