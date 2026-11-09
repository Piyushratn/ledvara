// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { fakeOrgApi, TEST_ORG } from "../test-org-utils";
import { OrgLayout } from "./OrgLayout";

function Where() {
  const { orgId } = useParams();
  return <p>Viewing {orgId}</p>;
}

afterEach(cleanup);

describe("OrgLayout", () => {
  it("switches organization by changing the URL", async () => {
    const other = { ...TEST_ORG, id: "other-org-id", name: "Beta" };
    const api = fakeOrgApi({ listOrgs: () => Promise.resolve([TEST_ORG, other]) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/orgs/${TEST_ORG.id}`]}>
          <Routes>
            <Route path="/orgs/:orgId" element={<OrgLayout api={api} />}>
              <Route index element={<Where />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(`Viewing ${TEST_ORG.id}`)).toBeTruthy();
    await screen.findByRole("option", { name: "Beta" });
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "other-org-id" } });
    expect(await screen.findByText("Viewing other-org-id")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
  });
});
