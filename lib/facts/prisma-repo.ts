import "server-only";
import { prisma } from "@/lib/db";
import { generateMovieFact } from "@/lib/openai";
import type { FactDeps, FactRepo } from "./service";

export const prismaFactRepo: FactRepo = {
  async getFavoriteMovie(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { favoriteMovie: true },
    });
    return user?.favoriteMovie ?? null;
  },

  latestFact(userId, movie) {
    return prisma.fact.findFirst({
      where: { userId, movie },
      orderBy: { createdAt: "desc" },
    });
  },

  insertFact(data) {
    return prisma.fact.create({ data });
  },

  async tryAcquireLease(userId, token, ttlMs) {
    // One atomic statement, so it is race-free across tabs AND server instances:
    // - no row        -> INSERT succeeds          -> acquired
    // - expired row   -> conflict, WHERE true     -> UPDATE takes it -> acquired
    // - live row      -> conflict, WHERE false    -> no row returned -> not acquired
    // Uses the database clock so all app instances agree on expiry.
    const rows = await prisma.$queryRaw<{ userId: string }[]>`
      INSERT INTO "FactGenerationLock" ("userId", "token", "lockedUntil")
      VALUES (${userId}, ${token}, now() + (${ttlMs}::int * interval '1 millisecond'))
      ON CONFLICT ("userId") DO UPDATE
        SET "token" = EXCLUDED."token", "lockedUntil" = EXCLUDED."lockedUntil"
        WHERE "FactGenerationLock"."lockedUntil" < now()
      RETURNING "userId"`;
    return rows.length === 1;
  },

  async releaseLease(userId, token) {
    await prisma.factGenerationLock.deleteMany({ where: { userId, token } });
  },
};

export function productionFactDeps(): FactDeps {
  return { repo: prismaFactRepo, generate: generateMovieFact };
}
