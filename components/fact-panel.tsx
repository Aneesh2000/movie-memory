"use client";

import type { FactSource } from "@/lib/api-types";
import { useFact } from "@/lib/use-fact";
import { Button, Card } from "@/components/ui";

const SOURCE_LABEL: Record<FactSource, string> = {
  fresh: "Just generated",
  cache: "Generated in the last minute",
  stale: "A new fact is on its way. Showing your last one",
  fallback: "Couldn't reach our fact writer. Showing your last fact",
};

export function FactPanel({ userId, movie }: { userId: string; movie: string }) {
  const { state, refresh } = useFact(userId, movie);

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">Fun fact</h2>
        {state.status === "success" && (
          <Button variant="ghost" onClick={refresh} disabled={state.refreshing}>
            {state.refreshing ? "Thinking…" : "New fact"}
          </Button>
        )}
      </div>

      {state.status === "loading" && (
        <div role="status" aria-label="Loading fact" className="space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
        </div>
      )}

      {state.status === "error" && (
        <div className="space-y-3">
          <p role="alert" className="text-stone-700 dark:text-stone-300">
            {state.message}
          </p>
          <Button variant="secondary" onClick={refresh}>
            Try again
          </Button>
        </div>
      )}

      {state.status === "success" && (
        <div className={`space-y-3 transition-opacity ${state.refreshing ? "opacity-50" : ""}`}>
          <p className="text-lg leading-relaxed">{state.data.fact.content}</p>
          <p className="text-xs text-stone-500">
            {state.fromClientCache ? "Saved in your browser from the last 30 seconds" : SOURCE_LABEL[state.data.source]}
          </p>
          {state.unchanged && (
            <p className="text-sm text-stone-600 dark:text-stone-400" role="status">
              Same fact for now. A new one unlocks at{" "}
              {new Date(state.data.freshUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}.
            </p>
          )}
          {state.refreshError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {state.refreshError}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
