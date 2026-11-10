import { prisma } from "@/lib/db";
import type { UpdateMovieResponse } from "@/lib/api-types";
import { apiError, unauthorized, withErrorHandling } from "@/lib/http";
import { parseMovie } from "@/lib/movie";
import { getSessionUserId } from "@/lib/session";

export const PUT = withErrorHandling(async (request: Request) => {
  const userId = await getSessionUserId();
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be JSON.");
  }

  const parsed = parseMovie((body as { movie?: unknown } | null)?.movie);
  if (!parsed.ok) return apiError(400, "VALIDATION_ERROR", parsed.error);

  // `where: { id: userId }` from the session: a user can only change their own row.
  const user = await prisma.user.update({
    where: { id: userId },
    data: { favoriteMovie: parsed.movie },
    select: { favoriteMovie: true },
  });

  // Old facts stay as history; they're keyed by movie so they simply stop matching.
  const response: UpdateMovieResponse = { favoriteMovie: user.favoriteMovie! };
  return Response.json(response);
});
