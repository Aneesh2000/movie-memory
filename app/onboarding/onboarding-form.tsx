"use client";

import { useActionState } from "react";
import { MOVIE_MAX_LENGTH } from "@/lib/movie";
import { Button } from "@/components/ui";
import { saveFavoriteMovie, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(saveFavoriteMovie, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <label htmlFor="movie" className="block text-sm font-medium">
        What&apos;s your favourite movie?
      </label>
      <input
        id="movie"
        name="movie"
        defaultValue={state.value}
        // maxLength is only a convenience; the server action is the real check.
        maxLength={MOVIE_MAX_LENGTH}
        autoFocus
        required
        placeholder="e.g. Spirited Away"
        aria-invalid={Boolean(state.error)}
        aria-describedby={state.error ? "movie-error" : undefined}
        className="w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 dark:border-stone-700"
      />
      {state.error && (
        <p id="movie-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
