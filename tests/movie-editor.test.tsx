// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";

const updateMovie = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { updateMovie: (movie: string) => updateMovie(movie) },
}));

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const { MovieEditor } = await import("@/components/movie-editor");

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function editTo(value: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const input = screen.getByRole("textbox");
  await user.clear(input);
  if (value) await user.type(input, value);
  return user;
}

const shownMovie = () => screen.getByTestId("favorite-movie").textContent;

beforeEach(() => {
  updateMovie.mockReset();
  replace.mockReset();
});

describe("MovieEditor inline edit flow", () => {
  it("shows the new title optimistically, then confirms it and notifies the parent", async () => {
    const pending = deferred<{ favoriteMovie: string }>();
    updateMovie.mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    render(<MovieEditor initialMovie="Alien" onSaved={onSaved} />);

    const user = await editTo("Arrival");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Optimistic: visible before the server answers.
    expect(shownMovie()).toBe("Arrival");
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    expect(onSaved).not.toHaveBeenCalled();

    pending.resolve({ favoriteMovie: "Arrival" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Arrival"));
    expect(shownMovie()).toBe("Arrival");
    expect(updateMovie).toHaveBeenCalledWith("Arrival");
  });

  it("reverts to the previous title and shows an error when the server fails", async () => {
    const pending = deferred<{ favoriteMovie: string }>();
    updateMovie.mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    render(<MovieEditor initialMovie="Alien" onSaved={onSaved} />);

    const user = await editTo("Arrival");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(shownMovie()).toBe("Arrival");

    pending.reject(new ApiError(500, "INTERNAL", "Something went wrong on our side."));

    // Editor reopens with the user's draft so they can retry, plus the error.
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");
    expect(screen.getByRole("textbox")).toHaveValue("Arrival");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(shownMovie()).toBe("Alien"); // reverted
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Cancel discards the draft without calling the API", async () => {
    render(<MovieEditor initialMovie="Alien" onSaved={vi.fn()} />);
    const user = await editTo("Something else");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(shownMovie()).toBe("Alien");
    expect(updateMovie).not.toHaveBeenCalled();
  });

  it("blocks an empty title client-side without calling the API", async () => {
    render(<MovieEditor initialMovie="Alien" onSaved={vi.fn()} />);
    const user = await editTo("");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/enter a movie title/i);
    expect(updateMovie).not.toHaveBeenCalled();
  });

  it("uses the server's normalised value", async () => {
    updateMovie.mockResolvedValue({ favoriteMovie: "Arrival" });
    const onSaved = vi.fn();
    render(<MovieEditor initialMovie="Alien" onSaved={onSaved} />);
    const user = await editTo("Arrival   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Arrival"));
  });

  it("redirects to sign-in when the session has expired", async () => {
    updateMovie.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "expired"));
    render(<MovieEditor initialMovie="Alien" onSaved={vi.fn()} />);
    const user = await editTo("Arrival");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
