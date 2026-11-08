// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the home page", () => {
    renderAt("/");
    expect(screen.getByText("Ledvara dashboard")).toBeTruthy();
  });

  it("shows both API checks as reachable when the API answers", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response('{"status":"ok"}', { status: 200 })));
    renderAt("/status");
    await waitFor(() => expect(screen.getAllByText("Reachable")).toHaveLength(2));
  });

  it("shows them as unreachable when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Failed to fetch")));
    renderAt("/status");
    await waitFor(() => expect(screen.getAllByText("Unreachable")).toHaveLength(2));
  });

  it("renders a not-found message for unknown routes", () => {
    renderAt("/nope");
    expect(screen.getByText("Page not found.")).toBeTruthy();
  });
});
