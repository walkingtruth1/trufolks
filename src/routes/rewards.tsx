// Ticket 8 — what you get back, at /rewards (BRD v1.6 FR-20, HON-09, PAY-01).
// Plain, unstyled (STITCH-UI-01). Every payout of the signed-in person with its
// amount and status at all times: qualified and held / ready / paid / not paid.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { Payout } from "@/lib/payouts/engine";
import { payoutMessage, payoutStatusText } from "@/lib/payouts/messages";
import { getMyPayouts } from "@/lib/payouts/server-fns";

export const Route = createFileRoute("/rewards")({ component: RewardsPage });

type Page = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; payouts: Payout[] };

function RewardsPage() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    if (isPending || !userId) return;
    let alive = true;
    getMyPayouts()
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r || !r.ok) setPage({ kind: "error", message: r?.message ?? payoutMessage("unavailable") ?? "" });
        else setPage({ kind: "ok", payouts: r.payouts });
      });
    return () => {
      alive = false;
    };
  }, [isPending, userId]);

  if (isPending || (userId && page.kind === "loading")) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!userId) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">What you get back</h1>
        <p>Please sign in to see what you get back.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: "/rewards" }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }
  if (page.kind === "error") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">What you get back</h1>
        <p role="alert">{page.message}</p>
      </main>
    );
  }
  if (page.kind !== "ok") return null;

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">What you get back</h1>
      <p>
        You get the same whatever rating you give. Each amount is held for the return window after you buy, then the
        TruFolks team pays you.
      </p>
      {page.payouts.length === 0 ? <p className="mt-4">Nothing yet. Once you post a review of a purchase from an offer, it shows here.</p> : null}
      {page.payouts.map((p) => (
        <article key={p.payoutId} className="mt-4 border p-4">
          <p className="font-semibold">
            {p.merchantName} — {p.productLabel}
          </p>
          <p>{p.campaignName}</p>
          <p className="mt-2">{payoutStatusText(p)}</p>
        </article>
      ))}
    </main>
  );
}
