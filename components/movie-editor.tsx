"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, errorMessage } from "@/lib/api";
import { MOVIE_MAX_LENGTH, parseMovie } from "@/lib/movie";
import { Button } from "@/components/ui";

type Props = {
  initialMovie: string;
  /** Called once the server has confirmed the new title. */
  onSaved: (movie: string) => void;
};

/**
 * Inline edit with an optimistic update:
 * 1. Save shows the new title immediately and closes the editor.
 * 2. On success, show the server's normalised value and notify the parent.
 * 3. On failure, revert to the previous title, reopen the editor with the
 *    user's draft so they can retry, and show the error.
 */
export function MovieEditor({ initialMovie, onSaved }: Props) {
  const router = useRouter();
  const [movie, setMovie] = useState(initialMovie); // what's displayed (may be optimistic)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialMovie);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraft(movie);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(movie);
    setError(null);
    setEditing(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    // Same rules as the server, for instant feedback. The server still re-validates.
    const parsed = parseMovie(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.movie === movie) {
      setEditing(false);
      return;
    }

    const previous = movie;
    setMovie(parsed.movie); // optimistic
    setEditing(false);
    setError(null);
    setSaving(true);

    try {
      const result = await api.updateMovie(parsed.movie);
      setMovie(result.favoriteMovie);
      onSaved(result.favoriteMovie);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        router.replace("/");
        return;
      }
      setMovie(previous); // revert
      setDraft(parsed.movie);
      setEditing(true);
      setError(`Couldn't save: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-3" noValidate>
        <label htmlFor="edit-movie" className="sr-only">
          Favourite movie
        </label>
        <input
          id="edit-movie"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && cancel()}
          maxLength={MOVIE_MAX_LENGTH}
          autoFocus
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "edit-movie-error" : undefined}
          className="w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 dark:border-stone-700"
        />
        {error && (
          <p id="edit-movie-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit">Save</Button>
          <Button type="button" variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-2xl font-semibold tracking-tight" data-testid="favorite-movie">
        {movie}
      </p>
      <div className="flex items-center gap-3">
        {saving && (
          <span className="text-sm text-stone-500" role="status">
            Saving…
          </span>
        )}
        <Button variant="secondary" onClick={startEditing} disabled={saving}>
          Edit
        </Button>
      </div>
    </div>
  );
}
