import { useAuth } from "../auth/AuthContext";

export function AppPage() {
  const { user } = useAuth();
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p>
        Signed in as <strong>{user?.email}</strong>
        {user?.fullName ? ` (${user.fullName})` : ""}.
      </p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Organizations, transactions and the rest of the dashboard arrive in the next steps.
      </p>
    </section>
  );
}
