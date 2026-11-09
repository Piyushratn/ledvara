// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import type { OrgApi } from "../lib/org-api";
import { fakeAuthApi, TEST_USER } from "../test-utils";
import { fakeOrgApi, TEST_ORG } from "../test-org-utils";
import { AppPage } from "./AppPage";

function renderPage(api: OrgApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider api={fakeAuthApi({ restore: () => Promise.resolve(TEST_USER) })}>
        <MemoryRouter initialEntries={["/app"]}>
          <Routes>
            <Route path="/app" element={<AppPage api={api} />} />
            <Route path="/orgs/:orgId/onboarding" element={<p>Onboarding page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("AppPage", () => {
  it("lists the user's organizations with a link to get started", async () => {
    renderPage(fakeOrgApi());
    expect(await screen.findByText(/Acme/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get started" })).toBeTruthy();
  });

  it("validates the name, creates an organization and opens its onboarding", async () => {
    let createdName = "";
    renderPage(
      fakeOrgApi({
        listOrgs: () => Promise.resolve([]),
        createOrg: (name) => {
          createdName = name;
          return Promise.resolve(TEST_ORG);
        },
      }),
    );

    expect(await screen.findByText(/not in an organization yet/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("Enter a name.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("Onboarding page")).toBeTruthy();
    expect(createdName).toBe("Acme");
  });
});
