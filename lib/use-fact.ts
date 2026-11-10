"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FactResponse } from "@/lib/api-types";
import { api, ApiError, errorMessage } from "@/lib/api";
import { clearFactCache, isCacheUsable, readFactCache, writeFactCache } from "@/lib/fact-cache";

export type FactState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      data: FactResponse;
      /** Served from the 30s browser cache without a request. */
      fromClientCache: boolean;
      /** A "new fact" request is in flight; keep showing the current one. */
      refreshing: boolean;
      /** The last explicit refresh failed; the current fact is still shown. */
      refreshError?: string;
      /** The last explicit refresh returned the same fact (server's 60s window). */
      unchanged?: boolean;
    };

/**
 * Owns the dashboard's fact: client cache, loading/error states, explicit
 * refresh, and invalidation when the confirmed movie changes.
 *
 * `movie` must be the server-confirmed movie, not the optimistic one, so we
 * never fetch a fact for a title the server hasn't accepted yet.
 */
export function useFact(userId: string, movie: string) {
  const router = useRouter();
  const [state, setState] = useState<FactState>({ status: "loading" });
  const inFlight = useRef<AbortController | null>(null);
  const previousMovie = useRef<string | null>(null);

  const load = useCallback(
    async ({ force }: { force: boolean }) => {
      if (!force) {
        const cached = readFactCache(userId);
        if (isCacheUsable(cached, movie, Date.now())) {
          setState({ status: "success", data: cached.data, fromClientCache: true, refreshing: false });
          return;
        }
      }

      // Only the latest request may update state: abort whatever came before.
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setState((prev) =>
        prev.status === "success" && prev.data.fact.movie === movie
          ? { ...prev, refreshing: true, refreshError: undefined, unchanged: undefined }
          : { status: "loading" },
      );

      try {
        const data = await api.getFact(controller.signal);
        if (controller.signal.aborted) return;
        writeFactCache(userId, { movie: data.fact.movie, fetchedAt: Date.now(), data });
        setState((prev) => ({
          status: "success",
          data,
          fromClientCache: false,
          refreshing: false,
          unchanged: force && prev.status === "success" && prev.data.fact.id === data.fact.id,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.isUnauthorized) {
          router.replace("/");
          return;
        }
        const message = errorMessage(error);
        setState((prev) =>
          prev.status === "success" && prev.data.fact.movie === movie
            ? { ...prev, refreshing: false, refreshError: message }
            : { status: "error", message },
        );
      }
    },
    [userId, movie, router],
  );

  useEffect(() => {
    // Invalidate on movie change: a cached fact for the old title must never be shown.
    if (previousMovie.current !== null && previousMovie.current !== movie) clearFactCache(userId);
    previousMovie.current = movie;

    // Syncing with external systems (sessionStorage, then the network) is what
    // this effect is for; the cache-hit path sets state synchronously by design.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ force: false });
    return () => inFlight.current?.abort();
  }, [userId, movie, load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  return { state, refresh };
}
