// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, OrgApi } from "../lib/org-api";
import type { OverviewApi } from "../lib/overview-api";
import { fakeOrgApi, TEST_ORG } from "../test-org-utils";
import { fakeOverviewApi } from "../test-overview-utils";
import { OverviewPage } from "./OverviewPage";

// Recharts needs ResizeObserver, which jsdom lacks. The chart is exercised in the browser.
vi.mock("../components/VolumeChart", () => ({ VolumeChart: () => null }));

function renderPage(api: OverviewApi, orgs: OrgApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/orgs/${TEST_ORG.id}`]}>
        <Routes>
          <Route path="/orgs/:orgId" element={<OverviewPage api={api} orgs={orgs} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const wallet: Account = {
  id: "acc-1",
  code: "wallet_demo",
  name: "Demo wallet",
  type: "wallet",
  balanceMinor: "10000",
};

afterEach(cleanup);

describe("OverviewPage", () => {
  it("shows the totals, the reconciliation status and the account balances in rupees", async () => {
    renderPage(fakeOverviewApi(), fakeOrgApi({ listAccounts: () => Promise.resolve([wallet]) }));

    expect(await screen.findByText("₹4,200.00")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(/Drift found/u)).toBeTruthy();
    expect(await screen.findByText("Demo wallet")).toBeTruthy();
    expect(screen.getByText("₹100.00")).toBeTruthy();
  });

  it("explains an empty organization and links to onboarding", async () => {
    renderPage(fakeOverviewApi(), fakeOrgApi());
    expect(await screen.findByText(/No accounts yet/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create the demo accounts" })).toBeTruthy();
  });
});
