// Ticket 8 — what you get back, at /rewards (BRD v1.6 FR-20, HON-09, PAY-01;
// APP-17-03). Styled from the Stitch Rewards pair (visual reference only):
// the shopper's actual payout records, amounts and dates, with a text status
// for held, on hold (flagged), ready, paid and not paid. There is no transfer
// or payment-method control: the TruFolks team pays through the existing
// operational flow (D6 open).
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Megaphone, ShieldCheck } from "lucide-react";
import {
  Alert,
  AppPage,
  btnPrimary,
  Card,
  labelClass,
  Loading,
  Note,
  PageTitle,
  SignInPrompt,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { Payout } from "@/lib/payouts/engine";
import { payoutMessage, payoutStatusText } from "@/lib/payouts/messages";
import { getMyPayouts } from "@/lib/payouts/server-fns";
import { formatCents } from "@/lib/receipt-codes/form-input";

export const Route = createFileRoute("/rewards")({ component: RewardsPage });

type Page =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; payouts: Payout[] };

const INTRO =
  "You get the same whatever rating you give. Each amount is held for the return window after you buy, then the TruFolks team pays you.";

function tone(p: Payout): { tone: StatusTone; label: string } {
  if (p.status === "paid") return { tone: "paid", label: "Paid" };
  if (p.status === "released") return { tone: "ready", label: "Ready to pay" };
  if (p.status === "forfeited") return { tone: "forfeited", label: "Not paid" };
  if (p.flagged) return { tone: "flagged", label: "On hold" };
  return { tone: "held", label: "Held" };
}

/** Totals per status from the shopper's own records (single currency in the pilot). */
function totals(payouts: Payout[]) {
  const sum = (f: (p: Payout) => boolean) =>
    payouts.filter(f).reduce((n, p) => n + p.amountCents, 0);
  const currency = payouts[0]?.currency ?? "USD";
  return {
    currency,
    held: sum((p) => p.status === "held"),
    ready: sum((p) => p.status === "released"),
    paid: sum((p) => p.status === "paid"),
  };
}

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
        if (!r || !r.ok)
          setPage({ kind: "error", message: r?.message ?? payoutMessage("unavailable") ?? "" });
        else setPage({ kind: "ok", payouts: r.payouts });
      });
    return () => {
      alive = false;
    };
  }, [isPending, userId]);

  if (isPending || (userId && page.kind === "loading")) {
    return (
      <AppPage>
        <Loading />
      </AppPage>
    );
  }
  if (!userId) {
    return (
      <SignInPrompt
        title="What you get back"
        body="Please sign in to see what you get back."
        next="/rewards"
      />
    );
  }
  if (page.kind === "error") {
    return (
      <AppPage>
        <PageTitle title="What you get back" />
        <Alert>{page.message}</Alert>
      </AppPage>
    );
  }
  if (page.kind !== "ok") return null;
  const t = totals(page.payouts);

  return (
    <AppPage>
      <PageTitle eyebrow="Rewards" title="What you get back" />
      <Note tone="rule" icon={<ShieldCheck size={18} />}>
        <p className="text-[15px] leading-6">{INTRO}</p>
      </Note>

      {page.payouts.length > 0 ? (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-px border border-secondary/20 bg-secondary/20">
            <Total label="Held" value={formatCents(t.held, t.currency)} />
            <Total label="Ready to pay" value={formatCents(t.ready, t.currency)} accent />
            <Total label="Paid so far" value={formatCents(t.paid, t.currency)} />
          </dl>
          <div className="mt-4 mb-6 border-b-2 border-primary" aria-hidden="true" />
        </>
      ) : (
        <Card className="mt-6">
          <p>Nothing yet. Once you post a review of a purchase from an offer, it shows here.</p>
          <p className="mt-2 text-sm text-neutral">
            Got a receipt with a TruFolks code? Scan it or open its link to start.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Link to="/add-review" hash="claim" className={btnPrimary}>
              Claim a receipt
            </Link>
            <Link to="/how-it-works" hash="rewards" className="text-sm font-semibold text-secondary underline">
              How rewards work
            </Link>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {page.payouts.map((p) => {
          const s = tone(p);
          const ready = s.tone === "ready";
          return (
            <article
              key={p.payoutId}
              className={`bg-surface p-5 md:p-6 ${
                ready
                  ? "border-2 border-secondary shadow-[4px_4px_0_0_var(--color-secondary)]"
                  : "border border-neutral/20 shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-neutral/20 pb-4">
                <div className="min-w-0">
                  <p className={`${labelClass} ${ready ? "text-secondary" : "text-neutral"}`}>
                    {EYEBROW[s.tone]}
                  </p>
                  <p className="mt-1 text-base leading-6 font-semibold">{p.merchantName}</p>
                  <p className="text-[13px] leading-5 text-neutral">{p.productLabel}</p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  <p
                    className={`mt-2 text-xl leading-7 font-bold tracking-[-0.01em] uppercase ${
                      ready ? "text-secondary" : ""
                    } ${s.tone === "forfeited" ? "text-neutral line-through" : ""}`}
                  >
                    {formatCents(p.amountCents, p.currency)}
                  </p>
                </div>
              </div>
              <p className={`${labelClass} mt-4 flex items-center gap-1.5 text-neutral`}>
                <Megaphone aria-hidden="true" size={14} />
                Offer: {p.campaignName}
              </p>
              <p className={`mt-2 border-l-[3px] p-3 text-[15px] leading-6 ${PANEL[s.tone]}`}>
                {payoutStatusText(p)}
              </p>
            </article>
          );
        })}
      </div>
    </AppPage>
  );
}

const EYEBROW: Record<StatusTone, string> = {
  pending: "Participating business",
  held: "Participating business",
  flagged: "Participating business",
  ready: "Ready to pay",
  paid: "Paid",
  forfeited: "Returned",
};

const PANEL: Record<StatusTone, string> = {
  pending: "border-status-pending bg-tint",
  held: "border-status-held bg-tint",
  ready: "border-status-ready bg-tint",
  paid: "border-status-paid bg-status-paid/5",
  flagged: "border-status-flagged bg-status-flagged/5",
  forfeited: "border-status-forfeited bg-status-forfeited/5",
};

function Total({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-tint p-3 md:p-4">
      <dt className={`${labelClass} text-neutral`}>{label}</dt>
      <dd
        className={`mt-1 text-xl leading-7 font-bold tracking-[-0.01em] md:text-[28px] md:leading-9 ${
          accent ? "text-secondary" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
