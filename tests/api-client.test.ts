import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";

function mockFetch(response: Response | Error) {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected the call to reject");
}

afterEach(() => vi.unstubAllGlobals());

describe("api client error handling", () => {
  it("maps a 401 with our envelope to an UNAUTHORIZED ApiError", async () => {
    mockFetch(json({ error: { code: "UNAUTHORIZED", message: "Please sign in." } }, 401));
    const error = await captureError(api.getFact());
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED", message: "Please sign in." });
    expect(error.isUnauthorized).toBe(true);
  });

  it("maps a bare 401 (no JSON body) to UNAUTHORIZED with a friendly message", async () => {
    mockFetch(new Response("Unauthorized", { status: 401 }));
    const error = await captureError(api.getMe());
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(error.message).toMatch(/sign in/i);
  });

  it("maps a 500 HTML error page to INTERNAL without leaking the body", async () => {
    mockFetch(new Response("<html>Internal Server Error: stack trace…</html>", { status: 500 }));
    const error = await captureError(api.getFact());
    expect(error).toMatchObject({ status: 500, code: "INTERNAL" });
    expect(error.message).not.toMatch(/stack/);
  });

  it("keeps the server's code and message for known errors (e.g. 503 FACT_UNAVAILABLE)", async () => {
    mockFetch(json({ error: { code: "FACT_UNAVAILABLE", message: "Try again shortly." } }, 503));
    const error = await captureError(api.getFact());
    expect(error).toMatchObject({ status: 503, code: "FACT_UNAVAILABLE", message: "Try again shortly." });
  });

  it("maps a network failure to NETWORK_ERROR with status 0", async () => {
    mockFetch(new TypeError("Failed to fetch"));
    const error = await captureError(api.updateMovie("Alien"));
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("rejects a 200 whose body doesn't match the contract with BAD_RESPONSE", async () => {
    mockFetch(json({ fact: "not an object" }));
    const error = await captureError(api.getFact());
    expect(error).toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("re-throws aborts untouched so callers can ignore them", async () => {
    mockFetch(new DOMException("aborted", "AbortError"));
    await expect(api.getFact()).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("api client success path", () => {
  it("sends PUT /api/me/movie with a JSON body and returns the parsed response", async () => {
    const fetchMock = mockFetch(json({ favoriteMovie: "Alien" }));
    await expect(api.updateMovie("Alien")).resolves.toEqual({ favoriteMovie: "Alien" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/movie",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ movie: "Alien" }) }),
    );
  });

  it("parses a valid fact response", async () => {
    const body = {
      fact: { id: "f1", movie: "Alien", content: "Fun!", createdAt: "2026-01-01T00:00:00.000Z" },
      source: "fresh",
      freshUntil: "2026-01-01T00:01:00.000Z",
    };
    mockFetch(json(body));
    await expect(api.getFact()).resolves.toEqual(body);
  });
});
