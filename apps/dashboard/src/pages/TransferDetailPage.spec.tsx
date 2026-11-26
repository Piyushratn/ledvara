// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { DetailApi, TransferDetail } from "../lib/detail-api";
import { ApiError } from "../lib/http";
import { TransferDetailPage } from "./TransferDetailPage";

const base: TransferDetail = {
  transfer: {
    id: "t1",
    status: "settled",
    reference: "rent",
    createdAt: "2026-11-09T10:00:00.000Z",
    amountMinor: "12500",
    currency: "INR",
    from: { id: "a", code: "platform", name: "Platform funds" },
    to: { id: "b", code: "wallet", name: "Demo wallet" },
  },
  timeline: [
    { status: "created", at: "2026-11-09T10:00:00.000Z", approximate: true },
    { status: "settled", at: "2026-11-09T10:00:01.000Z", approximate: false },
  ],
  entries: [
    {
      id: "e1",
      accountId: "a",
      accountName: "Platform funds",
      direction: "debit",
      amountMinor: "12500",
    },
    {
      id: "e2",
      accountId: "b",
      accountName: "Demo wallet",
      direction: "credit",
      amountMinor: "12500",
    },
  ],
  related: [],
  risk: null,
  deliveries: [],
  audit: null,
};

function renderPage(api: DetailApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/orgs/o1/transactions/t1"]}>
        <Routes>
          <Route
            path="/orgs/:orgId/transactions/:transferId"
            element={<TransferDetailPage api={api} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fake = (detail: TransferDetail, overrides: Partial<DetailApi> = {}): DetailApi => ({
  get: () => Promise.resolve(detail),
  resend: () => Promise.resolve(),
  ...overrides,
});

afterEach(cleanup);

describe("TransferDetailPage", () => {
  it("shows the amount, accounts, timeline and entries, marking approximate times", async () => {
    renderPage(fake(base));
    expect(await screen.findByText("₹125.00", { selector: "h1" })).toBeTruthy();
    expect(screen.getByText(/Platform funds → Demo wallet/u)).toBeTruthy();
    expect(screen.getByText("approx.")).toBeTruthy();
    expect(screen.getAllByText("Platform funds").length).toBeGreaterThan(0);
    expect(screen.getByText("Not scored.")).toBeTruthy();
    expect(screen.queryByText("Audit trail")).toBeNull();
  });

  it("shows risk reasons, the review state and the audit trail when present", async () => {
    renderPage(
      fake({
        ...base,
        risk: {
          score: 70,
          level: "high",
          flagged: true,
          rulesVersion: "v",
          reasons: [{ rule: "velocity_count", points: 40, reason: "9 transfers in 10 minutes." }],
          review: { id: "r1", status: "approved", note: "Called customer", decidedAt: null },
        },
        audit: [
          {
            action: "review.approved",
            actorType: "user",
            actorId: null,
            at: "2026-11-09T11:00:00.000Z",
          },
        ],
      }),
    );
    expect(await screen.findByText("9 transfers in 10 minutes.")).toBeTruthy();
    expect(screen.getByText(/Called customer/u)).toBeTruthy();
    expect(screen.getByText("Audit trail")).toBeTruthy();
    expect(screen.getByText(/review.approved by user/u)).toBeTruthy();
  });

  it("retries a delivery, and shows the server's message when that is refused", async () => {
    const withDelivery: TransferDetail = {
      ...base,
      deliveries: [
        {
          id: "d1",
          endpointId: "ep",
          eventType: "transfer.settled",
          status: "failed",
          attempts: 8,
          lastStatusCode: 500,
          lastError: "HTTP 500",
          lastAttemptAt: null,
        },
      ],
    };
    let resent = "";
    const api = fake(withDelivery, {
      resend: (_org, id) => {
        resent = id;
        return Promise.reject(
          new ApiError(409, "endpoint_disabled", "This webhook endpoint is disabled."),
        );
      },
    });
    renderPage(api);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This webhook endpoint is disabled.");
    expect(resent).toBe("d1");
  });

  it("shows an error when the transfer cannot be loaded", async () => {
    renderPage(
      fake(base, {
        get: () => Promise.reject(new ApiError(404, "not_found", "Transfer not found.")),
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Transfer not found.");
  });
});
