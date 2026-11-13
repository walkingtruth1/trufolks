// Ticket 2b — account page: who is signed in, and sign-out. Plain on purpose.
import { useState } from "react";
import { AppPage, btnSecondary } from "@/components/ui";
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
      <AppPage>
        <div className="border border-neutral/30 bg-surface p-5 sm:p-8">
          <p>Loading…</p>
        </div>
      </AppPage>
    );
  }
  if (!user) return <RedirectToSignIn />;

  return (
    <AppPage>
      <div className="border border-neutral/30 bg-surface p-5 sm:p-8">
        <h1 className="mb-5 text-3xl font-black tracking-tight">Your account</h1>
        <p>Name: {user.displayName ?? "—"}</p>
        <p>Email: {user.primaryEmail ?? "—"}</p>
        {error ? (
          <p role="alert" className="text-sm text-crimson">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className={btnSecondary + " mt-4"}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </AppPage>
  );
}
