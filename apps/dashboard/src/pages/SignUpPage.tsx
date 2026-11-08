import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { FormAlert, Field, SubmitButton } from "../components/Field";
import { signUp } from "../lib/account-api";
import { messageFor } from "../lib/errors";
import { ApiError } from "../lib/http";
import { signUpSchema, type SignUpValues } from "../lib/schemas";

const FIELDS = ["fullName", "email", "password"] as const;

export function SignUpPage() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signUp({
        email: values.email,
        password: values.password,
        ...(values.fullName ? { fullName: values.fullName } : {}),
      });
      setSentTo(values.email);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.details.length > 0) {
        for (const detail of error.details) {
          const field = FIELDS.find((name) => name === detail.path);
          if (field) setError(field, { message: detail.message });
        }
        return;
      }
      setFormError(messageFor(error));
    }
  });

  if (sentTo) {
    return (
      <section className="mx-auto max-w-sm space-y-3">
        <h1 className="text-2xl font-semibold">Check your inbox</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          If {sentTo} can be registered, we sent a link to verify it. The link expires in 24 hours.
        </p>
        {import.meta.env.DEV ? (
          <p className="text-xs text-neutral-500">
            Development: emails go to Mailpit at http://localhost:8025.
          </p>
        ) : null}
        <Link className="text-sm text-accent hover:underline" to="/login">
          Go to sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert message={formError} />
        <Field
          label="Full name (optional)"
          autoComplete="name"
          error={errors.fullName?.message}
          {...register("fullName")}
        />
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
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <SubmitButton busy={isSubmitting}>Create account</SubmitButton>
      </form>
      <p className="text-sm">
        Already have an account?{" "}
        <Link className="text-accent hover:underline" to="/login">
          Sign in
        </Link>
      </p>
    </section>
  );
}
