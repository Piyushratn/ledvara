import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { VolumeChart } from "../components/VolumeChart";
import { FormAlert } from "../components/Field";
import { messageFor } from "../lib/errors";
import { formatInr } from "../lib/money";
import { orgApi, type OrgApi } from "../lib/org-api";
import { overviewApi, type OverviewApi } from "../lib/overview-api";

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="text-xs font-medium uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note ? <p className="mt-1 text-xs text-neutral-500">{note}</p> : null}
    </div>
  );
}

const RECON_LABEL = { ok: "Balanced", drift: "Drift found", none: "Not run yet" } as const;

export function OverviewPage({
  api = overviewApi,
  orgs = orgApi,
}: {
  api?: OverviewApi;
  orgs?: OrgApi;
}) {
  const { orgId = "" } = useParams();
  const overview = useQuery({ queryKey: ["overview", orgId], queryFn: () => api.get(orgId) });
  const accounts = useQuery({
    queryKey: ["accounts", orgId],
    queryFn: () => orgs.listAccounts(orgId),
  });

  const data = overview.data;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Overview</h1>

      {overview.isPending ? (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          Loading…
        </p>
      ) : null}
      {overview.isError ? <FormAlert message={messageFor(overview.error)} /> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={`Volume, ${data.windowDays} days`}
              value={formatInr(data.volumeMinor)}
              note="Settled transfers"
            />
            <Stat label="Accepted" value={data.accepted} note="Settled or reversed" />
            <Stat label="Refused" value={data.refused} note="Overdrafts and closed accounts" />
            <Stat label="Pending reviews" value={data.pendingReviews} />
          </div>

          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 font-medium">Daily volume</h2>
            <VolumeChart days={data.daily} />
          </div>

          <p
            className={`text-sm ${data.reconciliation.status === "drift" ? "font-medium text-red-600" : ""}`}
          >
            Ledger reconciliation: {RECON_LABEL[data.reconciliation.status]}
            {data.reconciliation.checkedAt
              ? ` (checked ${new Date(data.reconciliation.checkedAt).toLocaleString()})`
              : ""}
          </p>
        </>
      ) : null}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Accounts</h2>
        {accounts.isError ? <FormAlert message={messageFor(accounts.error)} /> : null}
        {accounts.data && accounts.data.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            No accounts yet.{" "}
            <Link className="text-accent hover:underline" to={`/orgs/${orgId}/onboarding`}>
              Create the demo accounts
            </Link>
            .
          </p>
        ) : null}
        {accounts.data && accounts.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">Account</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data.map((account) => (
                  <tr
                    key={account.id}
                    className="border-t border-neutral-200 dark:border-neutral-800"
                  >
                    <td className="py-2 pr-4">{account.name}</td>
                    <td className="py-2 pr-4">{account.type}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatInr(account.balanceMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
