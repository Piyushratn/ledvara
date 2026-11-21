import { useEffect, useState } from "react";
import type { TransferFilters as Filters } from "../lib/transfers-api";

const STATUSES = ["", "settled", "pending", "failed", "reversed", "created"] as const;

interface Props {
  filters: Filters;
  /** Receives the new filters. Rupee amounts are converted by the caller. */
  onChange: (next: Filters) => void;
  /** Rupee input for the amount filters, shown as typed. */
  minRupees: string;
  maxRupees: string;
  onRupeesChange: (min: string, max: string) => void;
}

export function TransferFilters({
  filters,
  onChange,
  minRupees,
  maxRupees,
  onRupeesChange,
}: Props) {
  // The search box keeps its own text and applies it after a short pause, so typing is not
  // a request per keystroke.
  const [searchText, setSearchText] = useState(filters.search ?? "");
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.search ?? "") !== searchText.trim()) {
        onChange({ ...filters, search: searchText.trim() || undefined });
      }
    }, 300);
    return () => clearTimeout(timer);
    // Only the typed text drives this; `filters` is read when the timer fires.
  }, [searchText]);

  const field =
    "rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      onSubmit={(event) => event.preventDefault()}
      aria-label="Transfer filters"
    >
      <label className="space-y-1 text-xs font-medium">
        Status
        <select
          className={`block w-full ${field}`}
          value={filters.status ?? ""}
          onChange={(event) => onChange({ ...filters, status: event.target.value || undefined })}
        >
          {STATUSES.map((status) => (
            <option key={status || "any"} value={status}>
              {status === "" ? "Any status" : status}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs font-medium">
        From (date)
        <input
          type="date"
          className={`block w-full ${field}`}
          value={filters.from?.slice(0, 10) ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              from: event.target.value ? `${event.target.value}T00:00:00Z` : undefined,
            })
          }
        />
      </label>
      <label className="space-y-1 text-xs font-medium">
        To (date)
        <input
          type="date"
          className={`block w-full ${field}`}
          value={filters.to?.slice(0, 10) ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              to: event.target.value ? `${event.target.value}T23:59:59Z` : undefined,
            })
          }
        />
      </label>
      <label className="space-y-1 text-xs font-medium">
        Min amount (₹)
        <input
          inputMode="decimal"
          className={`block w-full ${field}`}
          value={minRupees}
          onChange={(event) => onRupeesChange(event.target.value, maxRupees)}
        />
      </label>
      <label className="space-y-1 text-xs font-medium">
        Max amount (₹)
        <input
          inputMode="decimal"
          className={`block w-full ${field}`}
          value={maxRupees}
          onChange={(event) => onRupeesChange(minRupees, event.target.value)}
        />
      </label>
      <label className="space-y-1 text-xs font-medium">
        Reference contains
        <input
          type="search"
          className={`block w-full ${field}`}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </label>
    </form>
  );
}
