import { useQuery } from "@tanstack/react-query";
import { probe } from "../lib/api";
import { API_URL } from "../lib/config";

const PATHS = ["/healthz", "/readyz"] as const;

function ProbeRow({ path }: { path: (typeof PATHS)[number] }) {
  const { data, isPending } = useQuery({
    queryKey: ["probe", path],
    queryFn: () => probe(API_URL, path),
    refetchInterval: 15_000,
  });

  const label = isPending ? "Checking" : data?.ok ? "Reachable" : "Unreachable";
  const colour = isPending ? "bg-neutral-400" : data?.ok ? "bg-accent" : "bg-red-600";

  return (
    <li className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <code className="text-sm">{path}</code>
        <span className={`rounded px-2 py-0.5 text-xs font-medium text-white ${colour}`}>
          {label}
        </span>
      </div>
      {data ? (
        <p className="mt-2 break-all text-xs text-neutral-600 dark:text-neutral-400">
          {data.status ?? "no response"} in {data.ms} ms: {data.body}
        </p>
      ) : null}
    </li>
  );
}

export function StatusPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">API status</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Checked from your browser against <code>{API_URL}</code>. A failure here that works in curl
        usually means CORS: the API only allows the origins in <code>CORS_ORIGINS</code>.
      </p>
      <ul className="mt-4 space-y-3">
        {PATHS.map((path) => (
          <ProbeRow key={path} path={path} />
        ))}
      </ul>
    </section>
  );
}
