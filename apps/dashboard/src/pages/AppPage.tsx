import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { Field, FormAlert, SubmitButton } from "../components/Field";
import { messageFor } from "../lib/errors";
import { createOrgSchema, type CreateOrgValues } from "../lib/org-schemas";
import { orgApi, type OrgApi } from "../lib/org-api";

export function AppPage({ api = orgApi }: { api?: OrgApi }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: () => api.listOrgs() });
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const org = await api.createOrg(values.name);
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      void navigate(`/orgs/${org.id}/onboarding`);
    } catch (error) {
      setFormError(messageFor(error));
    }
  });

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p>
          Signed in as <strong>{user?.email}</strong>
          {user?.fullName ? ` (${user.fullName})` : ""}.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Organizations</h2>
        {orgs.isPending ? <p className="text-sm">Loading…</p> : null}
        {orgs.isError ? <FormAlert message={messageFor(orgs.error)} /> : null}
        {orgs.data && orgs.data.length > 0 ? (
          <ul className="space-y-2">
            {orgs.data.map((org) => (
              <li
                key={org.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <span>
                  {org.name} <span className="text-xs text-neutral-500">({org.role})</span>
                </span>
                <Link
                  className="text-sm text-accent hover:underline"
                  to={`/orgs/${org.id}/onboarding`}
                >
                  Get started
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {orgs.data && orgs.data.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            You are not in an organization yet. Create one to get a sandbox.
          </p>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="max-w-sm space-y-3" noValidate>
        <h2 className="text-lg font-semibold">Create an organization</h2>
        <FormAlert message={formError} />
        <Field label="Name" error={errors.name?.message} {...register("name")} />
        <SubmitButton busy={isSubmitting}>Create organization</SubmitButton>
      </form>
    </section>
  );
}
