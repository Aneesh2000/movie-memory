import { unstable_rethrow } from "next/navigation";
import type { ApiErrorBody, ApiErrorCode } from "@/lib/api-types";

/** Every route returns either its typed body or this one error envelope. */
export function apiError(
  status: number,
  code: Exclude<ApiErrorCode, "NETWORK_ERROR" | "BAD_RESPONSE">,
  message: string,
  headers?: HeadersInit,
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status, headers });
}

export const unauthorized = () =>
  apiError(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.");

/** Wraps a handler so an unexpected throw becomes a clean 500, not a stack trace. */
export function withErrorHandling<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      // Let Next.js handle its own control-flow errors (redirects, dynamic
      // rendering bailouts); only real application errors become a 500.
      unstable_rethrow(error);
      console.error("[api] unhandled error", error);
      return apiError(500, "INTERNAL", "Something went wrong. Please try again.");
    }
  };
}
