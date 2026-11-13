// Ticket 2b — sign-up page. Plain, unstyled on purpose: visual design is not
// decided yet (STITCH-UI-01). Email + password only.
import { useEffect, useState, type FormEvent } from "react";
import { AppPage, btnPrimary, inputClass, linkClass } from "@/components/ui";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import {
  friendlyAuthError,
  hasErrors,
  MIN_PASSWORD_LENGTH,
  validateSignUp,
  type FieldErrors,
} from "@/lib/auth/forms";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { safeNextPath } from "@/lib/auth/safe-next";

// Ticket 3b-2: `?next=` returns people to the page they came from (e.g. a
// scanned receipt code). Only same-site paths are honoured (safeNextPath).
export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search.next === "string" ? { next: search.next } : {},
  component: SignUp,
});

function SignUp() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const target = safeNextPath(next);
  const { user, isPending } = useCurrentUserState();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in: go straight on. (`<Navigate>` needs a typed route, and
  // `next` is a plain path string, so navigate by href instead.)
  const alreadySignedIn = !isPending && Boolean(user);
  useEffect(() => {
    if (alreadySignedIn) void navigate({ href: target, replace: true });
  }, [alreadySignedIn, navigate, target]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const fieldErrors = validateSignUp({ name, email, password });
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) return;
    setSubmitting(true);
    try {
      const { error } = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (error) {
        setFormError(friendlyAuthError(error, "sign-up"));
        return;
      }
      await navigate({ href: target });
    } catch {
      setFormError(friendlyAuthError(null, "sign-up"));
    } finally {
      setSubmitting(false);
    }
  }

  if (alreadySignedIn) return null;

  return (
    <AppPage>
      <div className="border border-neutral/30 bg-surface p-5 sm:p-8">
        <h1 className="mb-5 text-3xl font-black tracking-tight">Create your account</h1>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 font-semibold">
            Your name
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name ? (
              <span role="alert" className="text-sm font-normal text-crimson">
                {errors.name}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5 font-semibold">
            Email
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email ? (
              <span role="alert" className="text-sm font-normal text-crimson">
                {errors.email}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5 font-semibold">
            Password (at least {MIN_PASSWORD_LENGTH} characters)
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <span role="alert" className="text-sm font-normal text-crimson">
                {errors.password}
              </span>
            ) : null}
          </label>
          {formError ? (
            <p role="alert" className="text-sm text-crimson">
              {formError}
            </p>
          ) : null}
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="mt-4">
          Already have an account?{" "}
          <Link to="/sign-in" search={next ? { next } : {}} className={linkClass}>
            Sign in
          </Link>
        </p>
      </div>
    </AppPage>
  );
}
