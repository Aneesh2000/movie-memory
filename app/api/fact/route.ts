import type { FactResponse } from "@/lib/api-types";
import { getFactForUser } from "@/lib/facts/service";
import { productionFactDeps } from "@/lib/facts/prisma-repo";
import { apiError, unauthorized, withErrorHandling } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/**
 * GET /api/fact: the signed-in user's fact for their current favourite movie.
 * Takes no user id, movie or fact id from the request: identity comes only from
 * the session, so there is nothing a caller can change to read another user's facts.
 */
export const GET = withErrorHandling(async () => {
  const userId = await getSessionUserId();
  if (!userId) return unauthorized();

  const result = await getFactForUser(userId, productionFactDeps());

  if (!result.ok) {
    switch (result.code) {
      case "NO_MOVIE":
        return apiError(409, "NO_MOVIE", "Pick a favourite movie first.");
      case "FACT_PENDING":
        return apiError(503, "FACT_PENDING", "Your fact is still being written. Try again in a moment.", {
          "Retry-After": "3",
        });
      case "FACT_UNAVAILABLE":
        return apiError(503, "FACT_UNAVAILABLE", "We couldn't come up with a fact right now. Please try again shortly.");
    }
  }

  const { fact, source, freshUntil } = result;
  const body: FactResponse = {
    fact: { id: fact.id, movie: fact.movie, content: fact.content, createdAt: fact.createdAt.toISOString() },
    source,
    freshUntil: freshUntil.toISOString(),
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
});
