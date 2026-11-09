// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import type { AuthApi } from "./lib/auth-api";
import { fakeAuthApi, TEST_USER } from "./test-utils";

function renderAt(path: string, api: AuthApi = fakeAuthApi()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider api={api}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
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

  it("sends a signed-out visitor from /app to the sign-in page", async () => {
    renderAt("/app");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  });

  it("shows the account page to a restored session", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response('{"data":[]}', { status: 200 })));
    renderAt("/app", fakeAuthApi({ restore: () => Promise.resolve(TEST_USER) }));
    expect(await screen.findByText(TEST_USER.email)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
