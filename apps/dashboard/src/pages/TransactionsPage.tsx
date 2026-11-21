import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { TransferFilters } from "../components/TransferFilters";
import { FormAlert } from "../components/Field";
import { saveBlob } from "../lib/csv-download";
import { messageFor } from "../lib/errors";
import { formatInr } from "../lib/money";
import { rupeesToPaise } from "../lib/amounts";
import {
  transfersApi,
  type Transfer,
  type TransfersApi,
  type TransferFilters as Filters,
} from "../lib/transfers-api";

const column = createColumnHelper<Transfer>();

/** The URL is the only source of truth for filters, so a view can be shared and reloaded. */
export function filtersFromParams(params: URLSearchParams): Filters {
  const pick = (key: string): string | undefined => params.get(key) || undefined;
  return {
    status: pick("status"),
    from: pick("from"),
    to: pick("to"),
    minAmount: pick("minAmount"),
    maxAmount: pick("maxAmount"),
    accountId: pick("accountId"),
    search: pick("search"),
  };
}

export function TransactionsPage({ api = transfersApi }: { api?: TransfersApi }) {
  const { orgId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [minRupees, setMinRupees] = useState(() => {
    const paise = params.get("minAmount");
    return paise ? (Number(paise) / 100).toFixed(2) : "";
  });
  const [maxRupees, setMaxRupees] = useState(() => {
    const paise = params.get("maxAmount");
    return paise ? (Number(paise) / 100).toFixed(2) : "";
  });
  const [amountError, setAmountError] = useState<string | null>(null);

  const updateFilters = (next: Filters): void => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
    }
    setParams(sp, { replace: true });
  };

  const onRupeesChange = (min: string, max: string): void => {
    setMinRupees(min);
    setMaxRupees(max);
    const minPaise = min.trim() === "" ? undefined : (rupeesToPaise(min) ?? undefined);
    const maxPaise = max.trim() === "" ? undefined : (rupeesToPaise(max) ?? undefined);
    const invalid = (min.trim() !== "" && !minPaise) || (max.trim() !== "" && !maxPaise);
    setAmountError(invalid ? "Enter amounts in rupees, such as 250 or 99.50." : null);
    if (!invalid) updateFilters({ ...filters, minAmount: minPaise, maxAmount: maxPaise });
  };

  const transfers = useInfiniteQuery({
    queryKey: ["transfers", orgId, filters],
    queryFn: ({ pageParam }) => api.list(orgId, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = useMemo(
    () => transfers.data?.pages.flatMap((page) => page.data) ?? [],
    [transfers.data],
  );

  const columns = useMemo(
    () => [
      column.accessor("createdAt", {
        header: "When",
        cell: (info) => new Date(info.getValue()).toLocaleString(),
      }),
      column.accessor("status", { header: "Status" }),
      column.accessor("fromAccountId", {
        header: "From",
        cell: (info) => info.getValue().slice(0, 8),
      }),
      column.accessor("toAccountId", { header: "To", cell: (info) => info.getValue().slice(0, 8) }),
      column.accessor("amountMinor", {
        header: () => <span className="block text-right">Amount</span>,
        cell: (info) => (
          <span className="block text-right tabular-nums">{formatInr(info.getValue())}</span>
        ),
      }),
      column.accessor("reference", { header: "Reference", cell: (info) => info.getValue() ?? "—" }),
    ],
    [],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  const download = useMutation({
    mutationFn: () => api.downloadCsv(orgId, filters),
    onSuccess: (blob) => saveBlob(blob, "transfers.csv"),
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <button
          type="button"
          disabled={download.isPending}
          onClick={() => download.mutate()}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-60 dark:border-neutral-700"
        >
          {download.isPending ? "Preparing…" : "Download CSV"}
        </button>
      </div>

      <TransferFilters
        filters={filters}
        onChange={updateFilters}
        minRupees={minRupees}
        maxRupees={maxRupees}
        onRupeesChange={onRupeesChange}
      />
      {amountError ? <FormAlert message={amountError} /> : null}
      {transfers.isError ? <FormAlert message={messageFor(transfers.error)} /> : null}
      {download.isError ? <FormAlert message={messageFor(download.error)} /> : null}

      {transfers.isPending ? <p className="text-sm">Loading…</p> : null}

      {transfers.isSuccess && rows.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          No transactions match these filters.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-neutral-500">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id} className="py-2 pr-4">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="py-2 pr-4 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {transfers.hasNextPage ? (
        <button
          type="button"
          disabled={transfers.isFetchingNextPage}
          onClick={() => void transfers.fetchNextPage()}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-60 dark:border-neutral-700"
        >
          {transfers.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
