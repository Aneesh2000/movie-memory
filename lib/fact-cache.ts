import type { FactResponse } from "@/lib/api-types";

/**
 * Client cache: the last fact plus when we fetched it.
 *
 * Stored in sessionStorage (per tab, cleared when the tab closes) so it survives
 * a page reload. That's where a 30s cache actually saves a request. The key
 * includes the user id so a different account in the same tab never sees it.
 * Pure functions plus thin storage helpers keep the rules unit-testable.
 */
export const CLIENT_FACT_TTL_MS = 30_000;

export type FactCacheEntry = {
  movie: string;
  fetchedAt: number;
  data: FactResponse;
};

/** A cached fact may be reused only for the same movie and within 30s. */
export function isCacheUsable(entry: FactCacheEntry | null, movie: string, now: number): entry is FactCacheEntry {
  return entry !== null && entry.movie === movie && now - entry.fetchedAt < CLIENT_FACT_TTL_MS;
}

const keyFor = (userId: string) => `movie-memory:fact:${userId}`;

export function readFactCache(userId: string): FactCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(keyFor(userId));
    return raw ? (JSON.parse(raw) as FactCacheEntry) : null;
  } catch {
    return null; // storage blocked or corrupt: behave as a cache miss
  }
}

export function writeFactCache(userId: string, entry: FactCacheEntry): void {
  try {
    sessionStorage.setItem(keyFor(userId), JSON.stringify(entry));
  } catch {
    // Storage full or blocked: caching is an optimisation, so ignore.
  }
}

export function clearFactCache(userId: string): void {
  try {
    sessionStorage.removeItem(keyFor(userId));
  } catch {
    // ignore
  }
}
