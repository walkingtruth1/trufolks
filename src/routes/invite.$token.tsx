// Ticket 5 — accept an invite link at /invite/<token> (BRD v1.6 FR-02, P5).
// Plain, unstyled on purpose (STITCH-UI-01). Opening the link changes nothing;
// the person sees who invited them and what it means, then taps Accept.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { contactMessage, inviteExplanation } from "@/lib/contacts/messages";
import { acceptInvite, getInvite } from "@/lib/contacts/server-fns";

export const Route = createFileRoute("/invite/$token")({ component: InvitePage });

type Page =
  | { kind: "loading" }
  | { kind: "message"; message: string }
  | { kind: "ready"; inviterName: string }
  | { kind: "done"; inviterName: string };

function InvitePage() {
  const { token } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isPending || !userId) return;
    let alive = true;
    getInvite({ data: { token } })
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r) setPage({ kind: "message", message: contactMessage("unavailable") ?? "" });
        else if (!r.ok) setPage({ kind: "message", message: r.message });
        else if (r.status === "ok") setPage({ kind: "ready", inviterName: r.inviterName });
        else setPage({ kind: "message", message: contactMessage(r.status) ?? "" });
      });
    return () => {
      alive = false;
    };
  }, [token, isPending, userId]);

  async function onAccept(inviterName: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await acceptInvite({ data: { token } }).catch(() => null);
    if (r?.ok) setPage({ kind: "done", inviterName });
    else setError(r?.message ?? contactMessage("unavailable"));
    setBusy(false);
  }

  if (isPending || (userId && page.kind === "loading")) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }

  const next = `/invite/${encodeURIComponent(token)}`;
  if (!userId) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">You've been invited</h1>
        <p>Someone you know invited you to be contacts on TruFolks. Sign in or create an account to see who.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next }} className="underline">
            Sign in
          </Link>{" "}
          ·{" "}
          <Link to="/sign-up" search={{ next }} className="underline">
            Create account
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Invite</h1>
      {page.kind === "message" ? <p role="alert">{page.message}</p> : null}
      {page.kind === "ready" ? (
        <>
          <p>{inviteExplanation(page.inviterName)}</p>
          <button
            type="button"
            onClick={() => void onAccept(page.inviterName)}
            disabled={busy}
            className="mt-4 rounded border px-4 py-2"
          >
            {busy ? "Accepting…" : "Accept"}
          </button>
          {error ? <p role="alert" className="mt-2">{error}</p> : null}
        </>
      ) : null}
      {page.kind === "done" ? <p>You and {page.inviterName} are now contacts.</p> : null}
      <p className="mt-4">
        <Link to="/contacts" className="underline">
          Go to your contacts
        </Link>
      </p>
    </main>
  );
}
