import { z } from "zod";

// Shared by the server (authoritative) and the client (instant feedback only).
export const MOVIE_MIN_LENGTH = 1;
export const MOVIE_MAX_LENGTH = 120;

export const movieSchema = z
  .string({ error: "Please enter a movie title." })
  // Normalise: unify Unicode forms, collapse runs of whitespace, trim the ends.
  .transform((s) => s.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(MOVIE_MIN_LENGTH, "Please enter a movie title.")
      .max(MOVIE_MAX_LENGTH, `Keep it under ${MOVIE_MAX_LENGTH} characters.`)
      .refine((s) => !/\p{Cc}/u.test(s), "That title contains invalid characters."),
  );

export type ParseMovieResult = { ok: true; movie: string } | { ok: false; error: string };

export function parseMovie(input: unknown): ParseMovieResult {
  const result = movieSchema.safeParse(input);
  if (result.success) return { ok: true, movie: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Invalid movie title." };
}
