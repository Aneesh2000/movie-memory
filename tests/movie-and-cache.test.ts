import { describe, expect, it } from "vitest";
import { parseMovie } from "@/lib/movie";
import { CLIENT_FACT_TTL_MS, isCacheUsable, type FactCacheEntry } from "@/lib/fact-cache";

describe("parseMovie (server-side validation rules)", () => {
  it("trims and collapses whitespace", () => {
    expect(parseMovie("  The   Godfather \n Part II ")).toEqual({ ok: true, movie: "The Godfather Part II" });
  });

  it.each<[unknown, string]>([
    ["", "empty"],
    ["    ", "whitespace only"],
    ["x".repeat(121), "over 120 chars"],
    [null, "non-string"],
    ["Bad\u0000Title", "control characters"],
  ])("rejects %j (%s)", (input) => {
    expect(parseMovie(input).ok).toBe(false);
  });

  it("accepts exactly 120 characters", () => {
    expect(parseMovie("x".repeat(120)).ok).toBe(true);
  });
});

describe("isCacheUsable (30s client cache)", () => {
  const entry: FactCacheEntry = {
    movie: "Alien",
    fetchedAt: 1_000_000,
    data: {
      fact: { id: "f1", movie: "Alien", content: "c", createdAt: "2026-01-01T00:00:00.000Z" },
      source: "fresh",
      freshUntil: "2026-01-01T00:01:00.000Z",
    },
  };

  it("reuses the entry within 30 seconds for the same movie", () => {
    expect(isCacheUsable(entry, "Alien", entry.fetchedAt + CLIENT_FACT_TTL_MS - 1)).toBe(true);
  });

  it("expires at 30 seconds", () => {
    expect(isCacheUsable(entry, "Alien", entry.fetchedAt + CLIENT_FACT_TTL_MS)).toBe(false);
  });

  it("is invalid for a different movie", () => {
    expect(isCacheUsable(entry, "Heat", entry.fetchedAt)).toBe(false);
  });

  it("is a miss when empty", () => {
    expect(isCacheUsable(null, "Alien", 0)).toBe(false);
  });
});
