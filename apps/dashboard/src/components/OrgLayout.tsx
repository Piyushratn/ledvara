import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";
import { orgApi, type OrgApi } from "../lib/org-api";

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  `block rounded px-3 py-2 text-sm ${
    isActive
      ? "bg-accent/10 font-medium text-accent"
      : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
  }`;

export function OrgLayout({ api = orgApi }: { api?: OrgApi }) {
  const { orgId = "" } = useParams();
  const navigate = useNavigate();
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: () => api.listOrgs() });

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="shrink-0 space-y-4 md:w-56">
        <div className="space-y-1">
          <label
            htmlFor="org-switcher"
            className="block text-xs font-medium uppercase text-neutral-500"
          >
            Organization
          </label>
          <select
            id="org-switcher"
            value={orgId}
            onChange={(event) => void navigate(`/orgs/${event.target.value}`)}
            className="block w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {(orgs.data ?? []).map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Sections" className="space-y-1">
          <NavLink end to={`/orgs/${orgId}`} className={linkClass}>
            Overview
          </NavLink>
          <NavLink to={`/orgs/${orgId}/onboarding`} className={linkClass}>
            Onboarding
          </NavLink>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
