// Ticket 3b-2 — DEV ONLY: make local test data for the manual run-through.
// The server refuses unless NODE_ENV is "development" (or "test") and the
// caller is on the local admin list (TRUFOLKS_ADMIN_EMAILS_DEV). Remove or
// replace once the merchant screens exist (Ticket 6).
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { runDevSeed } from "@/lib/dev/seed-server-fn";

export const Route = createFileRoute("/dev/seed")({ component: DevSeed });

type Result = { merchantName: string; campaignName: string; codes: { printed: string; path: string }[] };

function DevSeed() {
  const { user, isPending } = useCurrentUserState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onMake() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runDevSeed().catch(() => null);
      if (!r) return setError("Couldn't make test data. Check the dev server window.");
      if (!r.ok) return setError(r.message);
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Test data (developer tool)</h1>
      <p>Makes a test business, a live offer and a few receipt codes on this computer only.</p>
      {!user ? (
        <p className="mt-4">
          <Link to="/sign-in" search={{ next: "/dev/seed" }} className="underline">
            Sign in
          </Link>{" "}
          with your local admin account first.
        </p>
      ) : (
        <button type="button" onClick={() => void onMake()} disabled={busy} className="mt-4 rounded border px-4 py-2">
          {busy ? "Making…" : "Make test data"}
        </button>
      )}
      {error ? <p role="alert" className="mt-4">{error}</p> : null}
      {result ? (
        <>
          <p className="mt-4">
            {result.merchantName} — {result.campaignName}. Each code works once, on one phone or browser. Open one
            while signed in as your buyer account, not this admin account:
          </p>
          <ul className="mt-2 list-disc pl-6">
            {result.codes.map((c) => (
              <li key={c.printed}>
                <a href={c.path} className="underline">
                  {c.printed}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
