import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { CopyButton } from "../components/CopyButton";
import { FormAlert } from "../components/Field";
import { API_URL } from "../lib/config";
import { messageFor } from "../lib/errors";
import {
  buildTransferCommands,
  missingDemoAccounts,
  PLATFORM_CODE,
  WALLET_CODE,
} from "../lib/onboarding";
import { orgApi, type OrgApi } from "../lib/org-api";

function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <li className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          {number}. {title}
        </h2>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium text-white ${done ? "bg-accent" : "bg-neutral-400"}`}
        >
          {done ? "Done" : "To do"}
        </span>
      </div>
      {children}
    </li>
  );
}

function Command({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
        {text}
      </pre>
    </div>
  );
}

export function OnboardingPage({ api = orgApi }: { api?: OrgApi }) {
  const { orgId = "" } = useParams();
  const queryClient = useQueryClient();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const orgs = useQuery({ queryKey: ["orgs"], queryFn: () => api.listOrgs() });
  const accounts = useQuery({
    queryKey: ["accounts", orgId],
    queryFn: () => api.listAccounts(orgId),
  });

  const createAccounts = useMutation({
    mutationFn: async () => {
      for (const account of missingDemoAccounts(accounts.data ?? [])) {
        await api.createAccount(orgId, account);
      }
    },
    // Refresh even after a partial failure, so the next click only creates what is missing.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["accounts", orgId] }),
  });

  // The key lives only in this mutation's state: it is never stored and is gone on leaving the page.
  const createKey = useMutation({ mutationFn: () => api.createApiKey(orgId, "sandbox") });

  const orgName = orgs.data?.find((org) => org.id === orgId)?.name ?? "your organization";
  const platform = accounts.data?.find((account) => account.code === PLATFORM_CODE);
  const wallet = accounts.data?.find((account) => account.code === WALLET_CODE);
  const accountsReady = Boolean(platform && wallet);
  const key = createKey.data;

  const commands =
    key && platform && wallet
      ? buildTransferCommands({
          apiUrl: API_URL,
          apiKey: key.key,
          fromAccountId: platform.id,
          toAccountId: wallet.id,
          idempotencyKey,
        })
      : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Get started with {orgName}</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Four steps to your first sandbox transfer. Simulated money only.
        </p>
      </div>

      <ol className="space-y-3">
        <Step number={1} title="Create an organization" done>
          <p className="text-sm">{orgName} exists.</p>
        </Step>

        <Step number={2} title="Create the demo accounts" done={accountsReady}>
          {accounts.isError ? <FormAlert message={messageFor(accounts.error)} /> : null}
          <FormAlert message={createAccounts.isError ? messageFor(createAccounts.error) : null} />
          {accountsReady ? (
            <p className="text-sm">Platform funds and Demo wallet are ready.</p>
          ) : (
            <button
              type="button"
              disabled={accounts.isPending || createAccounts.isPending}
              onClick={() => createAccounts.mutate()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              Create demo accounts
            </button>
          )}
        </Step>

        <Step number={3} title="Create a sandbox API key" done={Boolean(key)}>
          <FormAlert message={createKey.isError ? messageFor(createKey.error) : null} />
          {key ? (
            <div className="space-y-2">
              <p role="note" className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Copy this key now. It is shown only once and cannot be recovered.
              </p>
              <div className="flex items-center gap-2">
                <code className="break-all rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-900">
                  {key.key}
                </code>
                <CopyButton text={key.key} />
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={createKey.isPending}
              onClick={() => createKey.mutate()}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              Create API key
            </button>
          )}
        </Step>

        <Step number={4} title="Make your first transfer" done={false}>
          {commands ? (
            <div className="space-y-3">
              <p className="text-sm">
                This moves INR 100.00 from Platform funds to the Demo wallet. Run it in a terminal.
                Running it again with the same Idempotency-Key does not move money twice.
              </p>
              <Command title="macOS / Linux" text={commands.bash} />
              <Command title="Windows PowerShell" text={commands.powershell} />
            </div>
          ) : (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Finish steps 2 and 3 to get a ready-to-run command.
            </p>
          )}
        </Step>
      </ol>

      <Link className="text-sm text-accent hover:underline" to="/app">
        Back to your account
      </Link>
    </section>
  );
}
