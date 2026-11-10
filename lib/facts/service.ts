/**
 * Fact generation with a 60s cache window, burst protection and
 * failure fallback.
 *
 * Pure business logic. Storage, OpenAI and the clock are injected so tests can
 * drive every branch deterministically. No Next.js or Prisma imports here.
 */

export const FACT_CACHE_TTL_MS = 60_000;
/** Upper bound on one generation (OpenAI timeout x retries + margin). */
export const LEASE_TTL_MS = 30_000;

export type StoredFact = {
  id: string;
  userId: string;
  movie: string;
  content: string;
  createdAt: Date;
};

export interface FactRepo {
  getFavoriteMovie(userId: string): Promise<string | null>;
  /** Most recent fact for exactly this user + movie, or null. */
  latestFact(userId: string, movie: string): Promise<StoredFact | null>;
  insertFact(data: Omit<StoredFact, "id">): Promise<StoredFact>;
  /** Atomically take the per-user lease if it is free or expired. */
  tryAcquireLease(userId: string, token: string, ttlMs: number): Promise<boolean>;
  /** Release only if we still own it (token matches). */
  releaseLease(userId: string, token: string): Promise<void>;
}

export type FactDeps = {
  repo: FactRepo;
  generate: (movie: string) => Promise<string>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  newToken?: () => string;
  /** How long a request that lost the lease waits for the winner's fact. */
  peerWaitMs?: number;
  peerPollMs?: number;
  log?: (message: string, error?: unknown) => void;
};

export type FactSource = "fresh" | "cache" | "stale" | "fallback";

export type FactResult =
  | { ok: true; fact: StoredFact; source: FactSource; freshUntil: Date }
  | { ok: false; code: "NO_MOVIE" | "FACT_PENDING" | "FACT_UNAVAILABLE" };

export function isFresh(fact: Pick<StoredFact, "createdAt">, now: Date): boolean {
  return now.getTime() - fact.createdAt.getTime() < FACT_CACHE_TTL_MS;
}

export async function getFactForUser(userId: string, deps: FactDeps): Promise<FactResult> {
  const {
    repo,
    generate,
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newToken = () => crypto.randomUUID(),
    peerWaitMs = 8_000,
    peerPollMs = 400,
    log = (message, error) => console.error(`[facts] ${message}`, error ?? ""),
  } = deps;

  const ok = (fact: StoredFact, source: FactSource): FactResult => ({
    ok: true,
    fact,
    source,
    freshUntil: new Date(fact.createdAt.getTime() + FACT_CACHE_TTL_MS),
  });

  // Everything below is scoped by the session user id passed in by the caller.
  const movie = await repo.getFavoriteMovie(userId);
  if (!movie) return { ok: false, code: "NO_MOVIE" };

  // 1. Cache window: a fact under 60s old is returned as-is.
  const latest = await repo.latestFact(userId, movie);
  if (latest && isFresh(latest, now())) return ok(latest, "cache");

  // 2. Burst protection: only the request holding the lease calls OpenAI.
  const token = newToken();
  const acquired = await repo.tryAcquireLease(userId, token, LEASE_TTL_MS);

  if (!acquired) {
    // Another tab or refresh is generating. Wait briefly for its result rather
    // than paying for a duplicate generation.
    const deadline = now().getTime() + peerWaitMs;
    while (now().getTime() < deadline) {
      await sleep(peerPollMs);
      const candidate = await repo.latestFact(userId, movie);
      if (candidate && candidate.id !== latest?.id) return ok(candidate, "cache");
    }
    return latest ? ok(latest, "stale") : { ok: false, code: "FACT_PENDING" };
  }

  try {
    // Double-check after taking the lease: a peer may have finished between
    // our first read and the acquire.
    const current = await repo.latestFact(userId, movie);
    if (current && isFresh(current, now())) return ok(current, "cache");

    let content: string;
    try {
      content = await generate(movie);
    } catch (error) {
      // 3. Failure handling: serve the most recent fact if we have one.
      log("generation failed", error);
      return current ? ok(current, "fallback") : { ok: false, code: "FACT_UNAVAILABLE" };
    }

    const fact = await repo.insertFact({ userId, movie, content, createdAt: now() });
    return ok(fact, "fresh");
  } finally {
    await repo.releaseLease(userId, token).catch((error) => log("lease release failed", error));
  }
}
