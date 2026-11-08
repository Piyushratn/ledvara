import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { verifyEmail } from "../lib/account-api";
import { messageFor } from "../lib/errors";

type Result = { state: "working" } | { state: "done" } | { state: "failed"; message: string };

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [result, setResult] = useState<Result>(
    token ? { state: "working" } : { state: "failed", message: "This link is missing its token." },
  );
  // The token works once. StrictMode runs effects twice in development, so guard the call.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verifyEmail(token).then(
      () => setResult({ state: "done" }),
      (error: unknown) => setResult({ state: "failed", message: messageFor(error) }),
    );
  }, [token]);

  return (
    <section className="mx-auto max-w-sm space-y-3">
      <h1 className="text-2xl font-semibold">Verify your email</h1>
      {result.state === "working" ? <p>Verifying…</p> : null}
      {result.state === "done" ? (
        <>
          <p>Your email is verified. You can sign in now.</p>
          <Link className="text-sm text-accent hover:underline" to="/login">
            Go to sign in
          </Link>
        </>
      ) : null}
      {result.state === "failed" ? (
        <p role="alert" className="text-red-600">
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
