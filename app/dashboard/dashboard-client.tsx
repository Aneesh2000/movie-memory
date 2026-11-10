"use client";

import { useState } from "react";
import { MovieEditor } from "@/components/movie-editor";
import { FactPanel } from "@/components/fact-panel";
import { Card } from "@/components/ui";

/**
 * Client half of the dashboard. `confirmedMovie` only changes after the server
 * accepts an edit; the fact panel keys its cache and fetches off that value.
 */
export function DashboardClient({ userId, initialMovie }: { userId: string; initialMovie: string }) {
  const [confirmedMovie, setConfirmedMovie] = useState(initialMovie);

  return (
    <>
      <Card className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">Favourite movie</h2>
        <MovieEditor initialMovie={initialMovie} onSaved={setConfirmedMovie} />
      </Card>
      <FactPanel userId={userId} movie={confirmedMovie} />
    </>
  );
}
