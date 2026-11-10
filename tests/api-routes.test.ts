import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "./support/memory-repo";

// --- Mocks: session identity, storage and OpenAI --------------------------------

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({
  getSessionUserId: async () => session.userId,
  findUser: async () => null,
}));

const store = createMemoryRepo({ now: () => new Date(), users: { alice: "Alien", bob: "Heat" } });
const generate = vi.fn(async (movie: string) => `Generated fact about ${movie}`);
vi.mock("@/lib/facts/prisma-repo", () => ({
  productionFactDeps: () => ({ repo: store.repo, generate, log: () => {} }),
}));

const prismaMock = vi.hoisted(() => ({ user: { update: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { GET: getFact } = await import("@/app/api/fact/route");
const { PUT: putMovie } = await import("@/app/api/me/movie/route");

beforeEach(() => {
  session.userId = null;
  generate.mockClear();
  prismaMock.user.update.mockReset();
});

// --- GET /api/fact --------------------------------------------------------------

describe("GET /api/fact authorization", () => {
  it("returns 401 with the error envelope when signed out", async () => {
    const res = await getFact();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
    expect(generate).not.toHaveBeenCalled();
  });

  it("only ever returns the signed-in user's fact", async () => {
    store.seedFact({ userId: "bob", movie: "Heat", content: "Bob's fact", createdAt: new Date() });

    session.userId = "alice";
    const res = await getFact();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fact.movie).toBe("Alien");
    expect(body.fact.content).not.toBe("Bob's fact");
    // There is no request input to tamper with: the handler takes no arguments
    // and resolves identity from the session alone.
    expect(getFact.length).toBe(0);
  });

  it("returns 409 NO_MOVIE for a user who hasn't onboarded", async () => {
    store.setMovie("carol", null);
    session.userId = "carol";
    const res = await getFact();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_MOVIE");
  });

  it("returns 503 FACT_UNAVAILABLE when OpenAI fails with no fallback", async () => {
    store.setMovie("dave", "Brand New Film");
    session.userId = "dave";
    generate.mockRejectedValueOnce(new Error("upstream down"));
    const res = await getFact();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("FACT_UNAVAILABLE");
  });
});

// --- PUT /api/me/movie ----------------------------------------------------------

function put(body: unknown) {
  return new Request("http://test/api/me/movie", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PUT /api/me/movie", () => {
  it("returns 401 when signed out and never touches the database", async () => {
    const res = await putMovie(put({ movie: "Alien" }));
    expect(res.status).toBe(401);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("updates only the session user, ignoring any userId in the body", async () => {
    session.userId = "alice";
    prismaMock.user.update.mockResolvedValue({ favoriteMovie: "Arrival" });

    const res = await putMovie(put({ movie: "  Arrival  ", userId: "bob" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ favoriteMovie: "Arrival" });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "alice" }, data: { favoriteMovie: "Arrival" } }),
    );
  });

  it.each([
    ["empty after trimming", { movie: "   " }],
    ["too long", { movie: "x".repeat(121) }],
    ["wrong type", { movie: 42 }],
    ["missing field", {}],
    ["invalid JSON", "{not json"],
  ])("rejects %s with 400 VALIDATION_ERROR", async (_label, body) => {
    session.userId = "alice";
    const res = await putMovie(put(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("turns an unexpected database error into a clean 500", async () => {
    session.userId = "alice";
    prismaMock.user.update.mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await putMovie(put({ movie: "Alien" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: expect.any(String) } });
  });
});
