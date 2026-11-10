export interface TransferCsvRow {
  id: string;
  status: string;
  createdAt: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: string;
  currency: string;
  reference: string | null;
}

/** Quotes a cell when needed, and defuses spreadsheet formulas. */
export function csvCell(value: string): string {
  // A leading = + - @ tab or CR makes Excel and Sheets evaluate the cell as a formula.
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\n\r]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** Paise as plain rupees, e.g. "10000" -> "100.00". BigInt only, never a JS number. */
export function plainInr(minor: string): string {
  if (!/^\d+$/u.test(minor)) return "";
  const value = BigInt(minor);
  return `${(value / 100n).toString()}.${(value % 100n).toString().padStart(2, "0")}`;
}

const HEADER = [
  "id",
  "status",
  "created_at",
  "from_account_id",
  "to_account_id",
  "amount_minor",
  "amount_inr",
  "currency",
  "reference",
];

export function transfersToCsv(rows: readonly TransferCsvRow[]): string {
  const lines = rows.map((row) =>
    [
      row.id,
      row.status,
      row.createdAt,
      row.fromAccountId,
      row.toAccountId,
      row.amountMinor,
      plainInr(row.amountMinor),
      row.currency,
      row.reference ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[HEADER.join(","), ...lines].join("\r\n")}\r\n`;
}
