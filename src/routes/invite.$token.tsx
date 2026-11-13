// Ticket 5 — accept an invite link at /invite/<token> (BRD v1.6 FR-02, P5;
// APP-17-04). Opening the link changes nothing; the person sees who invited
// them and what it means, then taps Accept (mutual acceptance). No Stitch
// frame exists for this route; it reuses the shared app components.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Alert,
  AppPage,
  btnPrimary,
  Card,
  linkClass,
  Loading,
  PageTitle,
  SignInPrompt,
  StatusBadge,
} from "@/components/ui";
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
      <AppPage>
        <Loading />
      </AppPage>
    );
  }

  const next = `/invite/${encodeURIComponent(token)}`;
  if (!userId) {
    return (
      <SignInPrompt
        title="A friend invited you"
        body="Someone you know invited you to be friends on TruFolks. Sign in or create an account to see who."
        next={next}
        signUp
      />
    );
  }

  return (
    <AppPage>
      <PageTitle eyebrow="Invite a friend" title="Friend invite" />
      <Card>
        {page.kind === "message" ? <Alert>{page.message}</Alert> : null}
        {page.kind === "ready" ? (
          <>
            <p className="leading-relaxed">{inviteExplanation(page.inviterName)}</p>
            <button
              type="button"
              onClick={() => void onAccept(page.inviterName)}
              disabled={busy}
              className={btnPrimary + " mt-5"}
            >
              {busy ? "Accepting…" : "Accept"}
            </button>
            {error ? (
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
            ) : null}
          </>
        ) : null}
        {page.kind === "done" ? (
          <>
            <StatusBadge tone="paid">Friends</StatusBadge>
            <p className="mt-3 font-semibold">You and {page.inviterName} are now friends.</p>
          </>
        ) : null}
        <p className="mt-5 border-t border-neutral/20 pt-4 text-sm">
          <Link to="/contacts" className={linkClass}>
            Go to your friends
          </Link>
        </p>
      </Card>
    </AppPage>
  );
}
