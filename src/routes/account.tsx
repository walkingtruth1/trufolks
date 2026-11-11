// Ticket 2b — account page: who is signed in, and sign-out. Plain on purpose.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { signOut } from "@/lib/auth/client";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/account")({ component: Account });

function Account() {
  const { user, isPending } = useCurrentUserState();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await signOut("/sign-in");
    } catch {
      setError("Couldn't sign you out. Please try again.");
      setSigningOut(false);
    }
  }

  // Wait for the session to resolve before deciding the visitor is signed out.
  if (isPending) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!user) return <RedirectToSignIn />;

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Your account</h1>
      <p>Name: {user.displayName ?? "—"}</p>
      <p>Email: {user.primaryEmail ?? "—"}</p>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="mt-4 rounded border px-4 py-2"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
