// Ticket 2b — sign-in page. Plain, unstyled on purpose (STITCH-UI-01).
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import { friendlyAuthError, hasErrors, validateSignIn, type FieldErrors } from "@/lib/auth/forms";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { safeNextPath } from "@/lib/auth/safe-next";

// Ticket 3b-2: `?next=` returns people to the page they came from (e.g. a
// scanned receipt code). Only same-site paths are honoured (safeNextPath).
export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search.next === "string" ? { next: search.next } : {},
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const target = safeNextPath(next);
  const { user, isPending } = useCurrentUserState();
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
    const fieldErrors = validateSignIn({ email, password });
    setErrors(fieldErrors);
    setFormError(null);
    if (hasErrors(fieldErrors)) return;
    setSubmitting(true);
    try {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) {
        setFormError(friendlyAuthError(error, "sign-in"));
        return;
      }
      await navigate({ href: target });
    } catch {
      setFormError(friendlyAuthError(null, "sign-in"));
    } finally {
      setSubmitting(false);
    }
  }

  if (alreadySignedIn) return null;

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Sign in</h1>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          Email
          <input
            className="rounded border px-3 py-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? <span role="alert">{errors.email}</span> : null}
        </label>
        <label className="flex flex-col gap-1">
          Password
          <input
            className="rounded border px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
          />
          {errors.password ? <span role="alert">{errors.password}</span> : null}
        </label>
        {formError ? <p role="alert">{formError}</p> : null}
        <button type="submit" disabled={submitting} className="rounded border px-4 py-2">
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4">
        No account yet? <Link to="/sign-up" search={next ? { next } : {}} className="underline">Sign up</Link>
      </p>
    </main>
  );
}
