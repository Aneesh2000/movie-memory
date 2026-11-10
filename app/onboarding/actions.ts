"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseMovie } from "@/lib/movie";
import { getSessionUserId } from "@/lib/session";

export type OnboardingState = { error?: string; value?: string };

export async function saveFavoriteMovie(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  // Server actions are public endpoints: re-check the session here, never trust the page.
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const raw = formData.get("movie");
  const parsed = parseMovie(raw);
  if (!parsed.ok) return { error: parsed.error, value: typeof raw === "string" ? raw : "" };

  // Onboarding is first-time only: the `favoriteMovie: null` condition makes a
  // double submit (or a second tab) a harmless no-op instead of an overwrite.
  // Changing the movie later goes through PUT /api/me/movie.
  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: { favoriteMovie: parsed.movie },
  });

  redirect("/dashboard");
}
