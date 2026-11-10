import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACT_CACHE_TTL_MS, getFactForUser, isFresh, type FactDeps } from "@/lib/facts/service";
import { createMemoryRepo } from "./support/memory-repo";

const T0 = new Date("2026-01-01T12:00:00.000Z");

function setup(movie: string | null = "Alien") {
  let clock = T0.getTime();
  const now = () => new Date(clock);
  const advance = (ms: number) => (clock += ms);
  const store = createMemoryRepo({ now, users: { alice: movie } });
  const generate = vi.fn(async (m: string) => `A fact about ${m}`);
  const deps: FactDeps = {
    repo: store.repo,
    generate,
    now,
    // Polling advances the fake clock instead of really waiting.
    sleep: async (ms) => {
      advance(ms);
    },
    log: () => {},
  };
  const getFact = () => getFactForUser("alice", deps);
  return { store, generate, deps, advance, now, getFact };
}

describe("isFresh (60s window)", () => {
  it("is fresh just under 60s and stale at exactly 60s", () => {
    expect(isFresh({ createdAt: T0 }, new Date(T0.getTime() + FACT_CACHE_TTL_MS - 1))).toBe(true);
    expect(isFresh({ createdAt: T0 }, new Date(T0.getTime() + FACT_CACHE_TTL_MS))).toBe(false);
  });
});

describe("getFactForUser: cache window", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("generates and stores a fact when none exists", async () => {
    const result = await ctx.getFact();
    expect(result).toMatchObject({ ok: true, source: "fresh", fact: { content: "A fact about Alien" } });
    expect(ctx.generate).toHaveBeenCalledTimes(1);
    expect(ctx.store.facts).toHaveLength(1);
  });

  it("returns the cached fact when it is under 60 seconds old", async () => {
    const first = await ctx.getFact();
    ctx.advance(59_999);
    const second = await ctx.getFact();

    expect(second).toMatchObject({ ok: true, source: "cache" });
    expect(second.ok && first.ok && second.fact.id === first.fact.id).toBe(true);
    expect(ctx.generate).toHaveBeenCalledTimes(1);
  });

  it("generates a new fact once the cached one is 60 seconds old", async () => {
    await ctx.getFact();
    ctx.advance(60_000);
    const result = await ctx.getFact();

    expect(result).toMatchObject({ ok: true, source: "fresh" });
    expect(ctx.generate).toHaveBeenCalledTimes(2);
    expect(ctx.store.facts).toHaveLength(2);
  });

  it("reports freshUntil as createdAt + 60s", async () => {
    const result = await ctx.getFact();
    expect(result.ok && result.freshUntil.getTime()).toBe(T0.getTime() + FACT_CACHE_TTL_MS);
  });

  it("does not reuse a fact for a different movie (cache key is user + movie)", async () => {
    await ctx.getFact();
    ctx.store.setMovie("alice", "Heat");
    const result = await ctx.getFact();

    expect(result).toMatchObject({ ok: true, source: "fresh", fact: { movie: "Heat" } });
  });

  it("returns NO_MOVIE when onboarding isn't finished", async () => {
    ctx.store.setMovie("alice", null);
    expect(await ctx.getFact()).toEqual({ ok: false, code: "NO_MOVIE" });
    expect(ctx.generate).not.toHaveBeenCalled();
  });
});

describe("getFactForUser: failure handling", () => {
  it("falls back to the most recent fact when OpenAI fails", async () => {
    const ctx = setup();
    const old = ctx.store.seedFact({ userId: "alice", movie: "Alien", content: "Old fact", createdAt: T0 });
    ctx.advance(5 * 60_000);
    ctx.generate.mockRejectedValueOnce(new Error("timeout"));

    const result = await ctx.getFact();
    expect(result).toMatchObject({ ok: true, source: "fallback", fact: { id: old.id } });
  });

  it("returns FACT_UNAVAILABLE when OpenAI fails and nothing is cached", async () => {
    const ctx = setup();
    ctx.generate.mockRejectedValueOnce(new Error("500"));
    expect(await ctx.getFact()).toEqual({ ok: false, code: "FACT_UNAVAILABLE" });
  });

  it("releases the lease after a failure so the next request can retry", async () => {
    const ctx = setup();
    ctx.generate.mockRejectedValueOnce(new Error("500"));
    await ctx.getFact();
    expect(ctx.store.leases.size).toBe(0);
    expect(await ctx.getFact()).toMatchObject({ ok: true, source: "fresh" });
  });
});

describe("getFactForUser: burst protection", () => {
  it("generates only once when many requests arrive together", async () => {
    // Real timers here: the generator resolves only when we say so, and the
    // losers poll with real (tiny) sleeps until the winner has stored the fact.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = createMemoryRepo({ now: () => new Date(), users: { alice: "Alien" } });
    const generate = vi.fn(async () => {
      await gate;
      return "Only one of me";
    });
    const deps: FactDeps = { repo: store.repo, generate, peerPollMs: 1, peerWaitMs: 2_000, log: () => {} };

    const requests = Array.from({ length: 5 }, () => getFactForUser("alice", deps));
    await new Promise((r) => setTimeout(r, 10));
    release();
    const results = await Promise.all(requests);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.facts).toHaveLength(1);
    for (const r of results) expect(r).toMatchObject({ ok: true, fact: { content: "Only one of me" } });
  });

  it("serves the previous fact as 'stale' if the peer is still generating after the wait", async () => {
    const ctx = setup();
    const old = ctx.store.seedFact({ userId: "alice", movie: "Alien", content: "Old", createdAt: T0 });
    ctx.advance(2 * 60_000);
    await ctx.store.repo.tryAcquireLease("alice", "someone-else", 30_000);

    const result = await getFactForUser("alice", { ...ctx.deps, peerWaitMs: 1_000, peerPollMs: 250 });
    expect(result).toMatchObject({ ok: true, source: "stale", fact: { id: old.id } });
    expect(ctx.generate).not.toHaveBeenCalled();
  });

  it("returns FACT_PENDING if a peer is generating and there is no previous fact", async () => {
    const ctx = setup();
    await ctx.store.repo.tryAcquireLease("alice", "someone-else", 30_000);
    const result = await getFactForUser("alice", { ...ctx.deps, peerWaitMs: 1_000, peerPollMs: 250 });
    expect(result).toEqual({ ok: false, code: "FACT_PENDING" });
  });

  it("takes over an expired lease left behind by a crashed request", async () => {
    const ctx = setup();
    await ctx.store.repo.tryAcquireLease("alice", "crashed", 30_000);
    ctx.advance(30_001);
    expect(await ctx.getFact()).toMatchObject({ ok: true, source: "fresh" });
  });
});

describe("getFactForUser: authorization", () => {
  it("never returns another user's fact, even for the same movie", async () => {
    const ctx = setup();
    ctx.store.setMovie("bob", "Alien");
    ctx.store.seedFact({ userId: "bob", movie: "Alien", content: "Bob's secret fact", createdAt: T0 });

    const result = await ctx.getFact();
    expect(result).toMatchObject({ ok: true, source: "fresh" });
    expect(result.ok && result.fact.userId).toBe("alice");
    expect(result.ok && result.fact.content).not.toBe("Bob's secret fact");
  });
});
