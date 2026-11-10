import type { FactRepo, StoredFact } from "@/lib/facts/service";

/**
 * In-memory FactRepo with the same semantics as the Prisma one, including the
 * lease (first caller wins until it expires or is released by its owner).
 */
export function createMemoryRepo(opts: { now: () => Date; users?: Record<string, string | null> }) {
  const users = new Map(Object.entries(opts.users ?? {}));
  const facts: StoredFact[] = [];
  const leases = new Map<string, { token: string; until: number }>();
  let nextId = 1;

  const repo: FactRepo = {
    async getFavoriteMovie(userId) {
      return users.get(userId) ?? null;
    },
    async latestFact(userId, movie) {
      const matches = facts
        .filter((f) => f.userId === userId && f.movie === movie)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return matches[0] ?? null;
    },
    async insertFact(data) {
      const fact = { ...data, id: `fact-${nextId++}` };
      facts.push(fact);
      return fact;
    },
    async tryAcquireLease(userId, token, ttlMs) {
      const now = opts.now().getTime();
      const current = leases.get(userId);
      if (current && current.until > now) return false;
      leases.set(userId, { token, until: now + ttlMs });
      return true;
    },
    async releaseLease(userId, token) {
      if (leases.get(userId)?.token === token) leases.delete(userId);
    },
  };

  return {
    repo,
    facts,
    leases,
    setMovie: (userId: string, movie: string | null) => users.set(userId, movie),
    seedFact: (fact: Omit<StoredFact, "id">) => {
      const stored = { ...fact, id: `fact-${nextId++}` };
      facts.push(stored);
      return stored;
    },
  };
}
