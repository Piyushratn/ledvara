import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { FormAlert, Field, SubmitButton } from "../components/Field";
import { messageFor } from "../lib/errors";
import {
  loginSchema,
  twoFactorSchema,
  type LoginValues,
  type TwoFactorValues,
} from "../lib/schemas";

/** Only same-site paths: never redirect to a value like //evil.example. */
function safeDestination(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/app";
}

function PasswordStep({ onChallenge }: { onChallenge: (token: string) => void }) {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const outcome = await login(values.email, values.password);
      if (outcome.kind === "twoFactor") onChallenge(outcome.challengeToken);
    } catch (error) {
      setFormError(messageFor(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormAlert message={formError} />
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <SubmitButton busy={isSubmitting}>Sign in</SubmitButton>
    </form>
  );
}

function TwoFactorStep({
  challengeToken,
  onRestart,
}: {
  challengeToken: string;
  onRestart: () => void;
}) {
  const { completeTwoFactor } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorValues>({
    resolver: zodResolver(twoFactorSchema),
    defaultValues: { code: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await completeTwoFactor(challengeToken, values.code);
    } catch (error) {
      setFormError(messageFor(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Enter the code from your authenticator app, or one of your backup codes.
      </p>
      <FormAlert message={formError} />
      <Field
        label="Authentication code"
        inputMode="text"
        autoComplete="one-time-code"
        error={errors.code?.message}
        {...register("code")}
      />
      <SubmitButton busy={isSubmitting}>Verify</SubmitButton>
      <button type="button" onClick={onRestart} className="text-sm text-accent hover:underline">
        Use a different account
      </button>
    </form>
  );
}

export function LoginPage() {
  const { status } = useAuth();
  const location = useLocation();
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  if (status === "signedIn") {
    const from = (location.state as { from?: unknown } | null)?.from;
    return <Navigate to={safeDestination(from)} replace />;
  }

  return (
    <section className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {challengeToken ? (
        <TwoFactorStep challengeToken={challengeToken} onRestart={() => setChallengeToken(null)} />
      ) : (
        <PasswordStep onChallenge={setChallengeToken} />
      )}
      <p className="text-sm">
        New here?{" "}
        <Link className="text-accent hover:underline" to="/signup">
          Create an account
        </Link>
      </p>
    </section>
  );
}
