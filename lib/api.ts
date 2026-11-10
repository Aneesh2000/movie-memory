import type { z } from "zod";
import {
  apiErrorBodySchema,
  factResponseSchema,
  meResponseSchema,
  updateMovieResponseSchema,
  type ApiErrorCode,
  type FactResponse,
  type MeResponse,
  type UpdateMovieRequest,
  type UpdateMovieResponse,
} from "@/lib/api-types";

/**
 * Typed client for our own API. Every call either resolves with a body that
 * has been validated against the contract, or rejects with an ApiError. Callers
 * never see a raw Response, a JSON parse error or a fetch TypeError.
 */
export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never got a response. */
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthorized() {
    return this.code === "UNAUTHORIZED";
  }
}

const FALLBACK_MESSAGES: Record<number, { code: ApiErrorCode; message: string }> = {
  401: { code: "UNAUTHORIZED", message: "Your session has expired. Please sign in again." },
  400: { code: "VALIDATION_ERROR", message: "That request wasn't valid." },
};
const SERVER_FALLBACK = { code: "INTERNAL" as const, message: "Something went wrong on our side. Please try again." };

type RequestOptions = { method?: "GET" | "PUT"; body?: unknown; signal?: AbortSignal };

async function request<S extends z.ZodType>(path: string, schema: S, options: RequestOptions = {}): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error; // let callers ignore aborts
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");
  }

  const data: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    // Prefer the server's envelope; otherwise derive a sensible error from the status.
    const envelope = apiErrorBodySchema.safeParse(data);
    if (envelope.success) throw new ApiError(response.status, envelope.data.error.code, envelope.data.error.message);
    const fallback = FALLBACK_MESSAGES[response.status] ?? SERVER_FALLBACK;
    throw new ApiError(response.status, fallback.code, fallback.message);
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(response.status, "BAD_RESPONSE", "The server sent an unexpected response. Please refresh.");
  }
  return parsed.data;
}

export const api = {
  getMe(signal?: AbortSignal): Promise<MeResponse> {
    return request("/api/me", meResponseSchema, { signal });
  },
  updateMovie(movie: string, signal?: AbortSignal): Promise<UpdateMovieResponse> {
    const body: UpdateMovieRequest = { movie };
    return request("/api/me/movie", updateMovieResponseSchema, { method: "PUT", body, signal });
  },
  getFact(signal?: AbortSignal): Promise<FactResponse> {
    return request("/api/fact", factResponseSchema, { signal });
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}
