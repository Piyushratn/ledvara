import type { Account, NewAccount } from "./org-api";

export const PLATFORM_CODE = "platform_funds";
export const WALLET_CODE = "wallet_demo";

export const DEMO_ACCOUNTS: readonly NewAccount[] = [
  { code: PLATFORM_CODE, name: "Platform funds", type: "asset", allowNegative: true },
  { code: WALLET_CODE, name: "Demo wallet", type: "wallet", allowNegative: false },
];

/** The demo accounts that do not exist yet, so a retry never hits a duplicate-code error. */
export function missingDemoAccounts(existing: readonly Account[]): NewAccount[] {
  const have = new Set(existing.map((account) => account.code));
  return DEMO_ACCOUNTS.filter((account) => !have.has(account.code));
}

export interface TransferCommandInput {
  apiUrl: string;
  apiKey: string;
  fromAccountId: string;
  toAccountId: string;
  idempotencyKey: string;
  /** Minor units (paise). */
  amountMinor?: number;
}

export interface TransferCommands {
  bash: string;
  powershell: string;
}

// Only characters that cannot end a single-quoted shell string.
const SAFE_VALUE = /^[A-Za-z0-9_\-.:/]+$/u;

function assertSafe(name: string, value: string): void {
  if (!SAFE_VALUE.test(value)) throw new Error(`Unsafe value for ${name}`);
}

export function buildTransferCommands(input: TransferCommandInput): TransferCommands {
  for (const [name, value] of Object.entries({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    idempotencyKey: input.idempotencyKey,
  })) {
    assertSafe(name, value);
  }

  const url = `${input.apiUrl}/v1/transfers`;
  const body = JSON.stringify({
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amountMinor: input.amountMinor ?? 10_000,
    reference: "first transfer",
  });

  const bash = [
    `curl -X POST '${url}' \\`,
    `  -H 'Authorization: Bearer ${input.apiKey}' \\`,
    `  -H 'Idempotency-Key: ${input.idempotencyKey}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${body}'`,
  ].join("\n");

  const powershell = [
    `Invoke-RestMethod -Method Post -Uri '${url}' \``,
    `  -Headers @{ Authorization = 'Bearer ${input.apiKey}'; 'Idempotency-Key' = '${input.idempotencyKey}' } \``,
    `  -ContentType 'application/json' \``,
    `  -Body '${body}'`,
  ].join("\n");

  return { bash, powershell };
}
