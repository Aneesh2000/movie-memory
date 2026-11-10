/**
 * Integration test against a real Postgres (Neon). Skipped by `npm test`; run
 * with `npm run test:db`, which loads .env and sets RUN_DB_TESTS=1.
 * Exercises the Prisma repo and the lease SQL under real concurrency.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL);

describe.skipIf(!enabled)("Neon Postgres integration", async () => {
  const { prisma } = await import("@/lib/db");
  const { prismaFactRepo } = await import("@/lib/facts/prisma-repo");
  const { getFactForUser } = await import("@/lib/facts/service");

  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `int-test-${Date.now()}@example.test`, name: "Integration Test", favoriteMovie: "Alien" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Cascades to Fact and FactGenerationLock.
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("connects through the pooled URL", async () => {
    const [row] = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(row.ok).toBe(1);
  });

  it("lease SQL: only one of many concurrent acquirers wins, and only the owner can release", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => prismaFactRepo.tryAcquireLease(userId, `token-${i}`, 30_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = `token-${results.indexOf(true)}`;

    await prismaFactRepo.releaseLease(userId, "not-the-owner");
    expect(await prisma.factGenerationLock.count({ where: { userId } })).toBe(1);

    await prismaFactRepo.releaseLease(userId, winner);
    expect(await prisma.factGenerationLock.count({ where: { userId } })).toBe(0);
  });

  it("an expired lease can be taken over", async () => {
    expect(await prismaFactRepo.tryAcquireLease(userId, "short", 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(await prismaFactRepo.tryAcquireLease(userId, "next", 30_000)).toBe(true);
    await prismaFactRepo.releaseLease(userId, "next");
  });

  it("5 concurrent fact requests generate exactly one fact, then the 60s cache serves it", async () => {
    const generate = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 300)); // simulate OpenAI latency
      return "Integration fact";
    });
    const deps = { repo: prismaFactRepo, generate, peerPollMs: 50, log: () => {} };

    const results = await Promise.all(Array.from({ length: 5 }, () => getFactForUser(userId, deps)));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(await prisma.fact.count({ where: { userId } })).toBe(1);
    for (const r of results) expect(r).toMatchObject({ ok: true, fact: { content: "Integration fact" } });

    const again = await getFactForUser(userId, deps);
    expect(again).toMatchObject({ ok: true, source: "cache" });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
