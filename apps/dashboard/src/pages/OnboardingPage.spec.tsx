// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/http";
import type { OrgApi } from "../lib/org-api";
import { fakeOrgApi, TEST_ORG } from "../test-org-utils";
import { OnboardingPage } from "./OnboardingPage";

function renderPage(api: OrgApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/orgs/${TEST_ORG.id}/onboarding`]}>
        <Routes>
          <Route path="/orgs/:orgId/onboarding" element={<OnboardingPage api={api} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("OnboardingPage", () => {
  it("walks from no accounts to a ready-to-run transfer command", async () => {
    const api = fakeOrgApi();
    renderPage(api);

    expect(await screen.findByText("Get started with Acme")).toBeTruthy();
    expect(screen.getByText("Finish steps 2 and 3 to get a ready-to-run command.")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Create demo accounts" }));
    expect(await screen.findByText("Platform funds and Demo wallet are ready.")).toBeTruthy();
    expect(api.created).toEqual(["platform_funds", "wallet_demo"]);

    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    expect(await screen.findByText("lv_test_secretvalue")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("shown only once");

    await waitFor(() => expect(screen.getAllByText(/Bearer lv_test_secretvalue/u)).toHaveLength(2));
  });

  it("shows the server's message when creating accounts is not allowed", async () => {
    const api = fakeOrgApi({
      createAccount: () =>
        Promise.reject(new ApiError(403, "forbidden", "You do not have permission to do that.")),
    });
    renderPage(api);

    const button = await screen.findByRole("button", { name: "Create demo accounts" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    const alert = await screen.findByRole("alert", undefined, { timeout: 4000 });
    expect(alert.textContent).toContain("You do not have permission to do that.");
  });
});
