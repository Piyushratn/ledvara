import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { FormAlert } from "../components/Field";
import { detailApi, type DetailApi } from "../lib/detail-api";
import { messageFor } from "../lib/errors";
import { formatInr } from "../lib/money";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

const when = (iso: string): string => new Date(iso).toLocaleString();

export function TransferDetailPage({ api = detailApi }: { api?: DetailApi }) {
  const { orgId = "", transferId = "" } = useParams();
  const queryClient = useQueryClient();
  const key = ["transfer-detail", orgId, transferId];
  const detail = useQuery({ queryKey: key, queryFn: () => api.get(orgId, transferId) });

  const resend = useMutation({
    mutationFn: (deliveryId: string) => api.resend(orgId, deliveryId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (detail.isPending) return <p role="status">Loading…</p>;
  if (detail.isError) return <FormAlert message={messageFor(detail.error)} />;

  const d = detail.data;
  const t = d.transfer;

  return (
    <section className="space-y-4">
      <Link className="text-sm text-accent hover:underline" to={`/orgs/${orgId}/transactions`}>
        Back to transactions
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {t.amountMinor ? formatInr(t.amountMinor) : "Transfer"}
        </h1>
        <p className="text-sm">
          <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
            {t.status}
          </span>{" "}
          {when(t.createdAt)}
          {t.reference ? ` · ${t.reference}` : ""}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {t.from?.name ?? "Unknown"} → {t.to?.name ?? "Unknown"}
        </p>
      </div>

      <Card title="Timeline">
        <ol className="space-y-1 text-sm">
          {d.timeline.map((step, index) => (
            <li key={`${step.status}-${index}`}>
              <strong>{step.status}</strong> at {when(step.at)}
              {step.approximate ? (
                <span className="ml-2 text-xs text-neutral-500">approx.</span>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Ledger entries">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-neutral-500">
            <tr>
              <th className="py-1 pr-4">Account</th>
              <th className="py-1 pr-4">Side</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.entries.map((entry) => (
              <tr key={entry.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-1 pr-4">{entry.accountName}</td>
                <td className="py-1 pr-4">{entry.direction}</td>
                <td className="py-1 text-right tabular-nums">{formatInr(entry.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {d.related.length > 0 ? (
        <Card title="Related transactions">
          <ul className="space-y-1 text-sm">
            {d.related.map((r) => (
              <li key={r.id}>
                {r.relation === "reversed_by" ? "Reversed by" : "Reverses"} a {r.kind} ({r.status}),{" "}
                {when(r.createdAt)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Risk">
        {d.risk ? (
          <div className="space-y-2 text-sm">
            <p>
              Score <strong>{d.risk.score}</strong> ({d.risk.level})
              {d.risk.flagged ? " · flagged for review" : ""}
            </p>
            {d.risk.reasons.length > 0 ? (
              <ul className="list-disc pl-5">
                {d.risk.reasons.map((reason) => (
                  <li key={reason.rule}>{reason.reason}</li>
                ))}
              </ul>
            ) : (
              <p className="text-neutral-600 dark:text-neutral-400">No rules fired.</p>
            )}
            {d.risk.review ? (
              <p>
                Review: <strong>{d.risk.review.status}</strong>
                {d.risk.review.note ? ` (${d.risk.review.note})` : ""}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Not scored.</p>
        )}
      </Card>

      <Card title="Webhook deliveries">
        <FormAlert message={resend.isError ? messageFor(resend.error) : null} />
        {d.deliveries.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">No deliveries.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {d.deliveries.map((delivery) => (
              <li key={delivery.id} className="flex items-center justify-between gap-3">
                <span>
                  {delivery.eventType}: <strong>{delivery.status}</strong> after {delivery.attempts}{" "}
                  attempt(s)
                  {delivery.lastError ? ` · ${delivery.lastError}` : ""}
                </span>
                <button
                  type="button"
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(delivery.id)}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-60 dark:border-neutral-700"
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {d.audit !== null ? (
        <Card title="Audit trail">
          {d.audit.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No audit events.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.audit.map((event, index) => (
                <li key={`${event.action}-${index}`}>
                  {event.action} by {event.actorType} at {when(event.at)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </section>
  );
}
