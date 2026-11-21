// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Transfer, TransfersApi } from "../lib/transfers-api";
import { filtersFromParams, TransactionsPage } from "./TransactionsPage";

const transfer = (id: string, amount: string, reference: string | null): Transfer => ({
  id,
  status: "settled",
  fromAccountId: "aaaaaaaa-1111",
  toAccountId: "bbbbbbbb-2222",
  amountMinor: amount,
  currency: "INR",
  reference,
  createdAt: "2026-11-09T10:00:00.000Z",
});

function fakeApi(
  pages: { data: Transfer[]; nextCursor: string | null }[],
): TransfersApi & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    list: (_orgId, _filters, cursor) => {
      calls += 1;
      const index = cursor ? 1 : 0;
      return Promise.resolve(pages[index] ?? { data: [], nextCursor: null });
    },
    downloadCsv: () => Promise.resolve(new Blob(["id\n"], { type: "text/csv" })),
  };
}

function renderPage(api: TransfersApi, url = "/orgs/org-1/transactions") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/orgs/:orgId/transactions" element={<TransactionsPage api={api} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("filtersFromParams", () => {
  it("reads filters from the URL and ignores empty values", () => {
    const filters = filtersFromParams(new URLSearchParams("status=failed&search=&minAmount=500"));
    expect(filters).toMatchObject({ status: "failed", minAmount: "500" });
    expect(filters.search).toBeUndefined();
  });
});

describe("TransactionsPage", () => {
  it("shows rows with rupee amounts and offers to load more", async () => {
    renderPage(
      fakeApi([
        { data: [transfer("t1", "10000", "rent")], nextCursor: "next" },
        { data: [transfer("t2", "250", null)], nextCursor: null },
      ]),
    );

    expect(await screen.findByText("₹100.00")).toBeTruthy();
    expect(screen.getByText("rent")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("₹2.50")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says so when nothing matches", async () => {
    renderPage(fakeApi([{ data: [], nextCursor: null }]));
    expect(await screen.findByText("No transactions match these filters.")).toBeTruthy();
  });

  it("rejects an invalid amount without changing the URL filters", async () => {
    renderPage(fakeApi([{ data: [], nextCursor: null }]));
    fireEvent.change(screen.getByLabelText("Min amount (₹)"), { target: { value: "1.234" } });
    expect(await screen.findByText(/Enter amounts in rupees/u)).toBeTruthy();
  });
});
