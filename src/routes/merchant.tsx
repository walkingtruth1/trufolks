// Ticket 6 — the merchant dashboard at /merchant (BRD v1.6 FR-24, MER-02,
// MER-05, MER-07, Journey C, §13, P5, FR-27; MER-17-01). Styled from the
// Stitch Merchant Dashboard pair (visual reference only). Leads with what the
// budget funded, from the offer's actual values. Not built from the frame:
// per-review payout status, a fixed per-shopper amount, POS sync, escrow
// "vault" details and the state simulator (no data or not supported).
//
// * The owner first reads and accepts the mixed-ratings walkthrough (MER-07)
//   and the pay-for-any-rating statement (MER-02). Codes can't be made before.
// * Per offer: scan-to-review numbers (MER-05) and every rating (FR-24).
//   Reviews left and pool left come from the offer's settings (CFG-04, Ticket
//   7). Deposits and paid-back / held / forfeited totals come from the payout
//   ledger (Ticket 8). Codes can be made only once the offer is funded (MER-06).
// * Reviews with no reviewer name (P5), every rating, newest first. The
//   business can't approve, hide or remove a review.
// * Make receipt codes (existing generateReceiptCodes): shown once as
//   printable short codes and links. No QR image yet (gap 29).
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Scale, ShieldCheck } from "lucide-react";
import {
  Alert,
  AppPage,
  btnPrimary,
  btnSecondary,
  Card,
  Chip,
  Eyebrow,
  inputClass,
  labelClass,
  Loading,
  Note,
  PageTitle,
  SectionTitle,
  SignInPrompt,
  StatusBadge,
} from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { Business, OfferStats } from "@/lib/merchants/engine";
import { MERCHANT_LIMITS } from "@/lib/merchants/limits";
import {
  merchantMessage,
  NOT_SET_YET,
  PAY_FOR_ANY_RATING_STATEMENT,
  WALKTHROUGH,
} from "@/lib/merchants/messages";
import { acceptMerchantStatement, getMerchantDashboard } from "@/lib/merchants/server-fns";
import { RECEIPT_CODE_LIMITS } from "@/lib/receipt-codes/limits";
import { generateReceiptCodes } from "@/lib/receipt-codes/server-fns";
import { ratingText } from "@/lib/reviews/review-input";
import { formatCents } from "@/lib/receipt-codes/form-input";

export const Route = createFileRoute("/merchant")({ component: MerchantPage });

const UNAVAILABLE = merchantMessage("unavailable") ?? "";

function longDate(isoTime: string): string {
  const d = new Date(isoTime);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

type Page =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; businesses: Business[] };

function MerchantPage() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });

  const load = useCallback(async () => {
    const r = await getMerchantDashboard().catch(() => null);
    if (!r || !r.ok) setPage({ kind: "error", message: r?.message ?? UNAVAILABLE });
    else setPage({ kind: "ok", businesses: r.businesses });
  }, []);

  useEffect(() => {
    if (!isPending && userId) void load();
  }, [isPending, userId, load]);

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
        title="Your business"
        body="Please sign in to see your business."
        next="/merchant"
      />
    );
  }
  if (page.kind === "error") {
    return (
      <AppPage>
        <PageTitle title="Your business" />
        <Alert>{page.message}</Alert>
      </AppPage>
    );
  }
  if (page.kind !== "ok") return null;

  return (
    <AppPage width="wide">
      {page.businesses.length === 0 ? (
        <>
          <PageTitle eyebrow="Merchant" title="Your business" />
          <Card>
            <p>
              There's no business on this account yet. The TruFolks team sets up your first campaign
              with you in person — get in touch with us and we'll add your business.
            </p>
          </Card>
        </>
      ) : null}
      {page.businesses.map((b) => (
        <BusinessView key={b.merchantId} business={b} onChange={load} />
      ))}
    </AppPage>
  );
}

function BusinessView({
  business: b,
  onChange,
}: {
  business: Business;
  onChange: () => Promise<void>;
}) {
  const ready = Boolean(b.termsAcceptedAt && b.walkthroughAcceptedAt);
  const orphanReviews = b.reviews.filter(
    (r) => !b.offers.some((o) => o.campaignId === r.campaignId),
  );
  return (
    <section className="mb-12">
      <div className="border border-neutral/20 bg-surface shadow-sm">
        <div className="p-5 md:px-6 md:py-6">
          <p className={`${labelClass} text-secondary`}>
            Participating business
            {b.businessType ? <span className="text-neutral"> / {b.businessType}</span> : null}
          </p>
          <h1 className="mt-2 text-[28px] leading-9 font-bold tracking-[-0.02em] md:text-[32px] md:leading-10">
            {b.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-tint px-5 py-3 text-xs font-semibold tracking-[0.04em] uppercase md:px-6">
          <span className="flex items-center gap-1.5">
            <Scale aria-hidden="true" size={14} className="text-secondary" />
            Same pay-back at any rating
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck aria-hidden="true" size={14} className="text-secondary" />
            {b.termsAcceptedAt
              ? `Terms accepted ${longDate(b.termsAcceptedAt)}`
              : "Terms not accepted yet"}
          </span>
        </div>
      </div>

      {!b.walkthroughAcceptedAt ? (
        <div className="mt-6">
          <Walkthrough merchantId={b.merchantId} onChange={onChange} />
        </div>
      ) : !b.termsAcceptedAt ? (
        <div className="mt-6">
          <Statement merchantId={b.merchantId} onChange={onChange} />
        </div>
      ) : (
        <div className="mt-6">
          <Note icon={<Scale size={18} />}>
            You accepted how TruFolks works on {longDate(b.termsAcceptedAt)}: every honest review is
            paid back the same, whatever the rating.
          </Note>
        </div>
      )}
      {b.offers.length === 0 ? (
        <Card className="mt-6">
          <p>No offers yet. The TruFolks team will set one up with you.</p>
        </Card>
      ) : null}
      {b.offers.map((o) => (
        <OfferView
          key={o.campaignId}
          offer={o}
          reviews={b.reviews.filter((r) => r.campaignId === o.campaignId)}
          canMakeCodes={ready}
          onChange={onChange}
        />
      ))}
      {b.offers.length === 0 || orphanReviews.length > 0 ? (
        <Reviews reviews={orphanReviews} className="mt-8" />
      ) : null}
    </section>
  );
}

function useAccept(
  merchantId: string,
  what: "terms" | "walkthrough",
  onChange: () => Promise<void>,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await acceptMerchantStatement({ data: { merchantId, what } }).catch(() => null);
    if (!r || !r.ok) setError(r?.message ?? UNAVAILABLE);
    else await onChange();
    setBusy(false);
  }
  return { busy, error, accept };
}

function Walkthrough({
  merchantId,
  onChange,
}: {
  merchantId: string;
  onChange: () => Promise<void>;
}) {
  const { busy, error, accept } = useAccept(merchantId, "walkthrough", onChange);
  return (
    <Card>
      <Eyebrow>Step 1 of 2</Eyebrow>
      <h2 className="mt-1 text-xl font-bold">What reviews look like</h2>
      <p className="mt-2 leading-relaxed">{WALKTHROUGH.intro}</p>
      <ul className="mt-3 divide-y divide-neutral/20 border-y border-neutral/20">
        {WALKTHROUGH.examples.map((e) => (
          <li key={e.rating} className="py-2">
            <span className="font-semibold" aria-label={`${e.rating} out of 5 stars`}>
              {ratingText(e.rating)}
            </span>{" "}
            — "{e.thought}"
          </li>
        ))}
      </ul>
      <ul className="mt-3 list-disc space-y-1 pl-6">
        {WALKTHROUGH.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void accept()}
        disabled={busy}
        className={btnPrimary + " mt-5"}
      >
        {busy ? "Saving…" : "I understand"}
      </button>
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}

function Statement({
  merchantId,
  onChange,
}: {
  merchantId: string;
  onChange: () => Promise<void>;
}) {
  const { busy, error, accept } = useAccept(merchantId, "terms", onChange);
  return (
    <Card>
      <Eyebrow>Step 2 of 2</Eyebrow>
      <h2 className="mt-1 text-xl font-bold">What you agree to</h2>
      {PAY_FOR_ANY_RATING_STATEMENT.map((line) => (
        <p key={line} className="mt-2 leading-relaxed">
          {line}
        </p>
      ))}
      <p className="mt-3 text-sm text-neutral">
        You need to accept this before you can make receipt codes.
      </p>
      <button
        type="button"
        onClick={() => void accept()}
        disabled={busy}
        className={btnPrimary + " mt-5"}
      >
        {busy ? "Saving…" : "I accept"}
      </button>
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}

function OfferView({
  offer: o,
  reviews,
  canMakeCodes,
  onChange,
}: {
  offer: OfferStats;
  reviews: Business["reviews"];
  canMakeCodes: boolean;
  onChange: () => Promise<void>;
}) {
  const ended = new Date(o.endsAt).getTime() <= Date.now() || o.status !== "live";
  const funded = o.money.depositedCents > 0;
  const totalRatings = o.starCounts.reduce((n, c) => n + c, 0);
  const reviewedPct =
    o.purchasesVerified > 0
      ? Math.min(100, Math.round((o.reviews / o.purchasesVerified) * 100))
      : 0;
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={`${labelClass} text-neutral`}>Campaign</p>
          <h2 className="mt-1 text-2xl leading-8 font-semibold tracking-[-0.01em]">{o.name}</h2>
          <p className="text-[13px] leading-5 text-neutral">
            {longDate(o.startsAt)} to {longDate(o.endsAt)}
          </p>
        </div>
        {ended ? (
          <Chip>Ended</Chip>
        ) : funded ? (
          <Chip tone="dark">
            <ShieldCheck aria-hidden="true" size={14} />
            Funded
          </Chip>
        ) : (
          <StatusBadge tone="flagged">Not funded yet</StatusBadge>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:items-start">
        {canMakeCodes && !ended ? (
          <div className="lg:col-span-4 lg:col-start-9 lg:row-start-1">
            {funded ? (
              <MakeCodes campaignId={o.campaignId} onChange={onChange} />
            ) : (
              <Note>
                You can make codes once your deposit for this offer is in. You fund every review's
                pay-back upfront; the TruFolks team records it.
              </Note>
            )}
          </div>
        ) : null}
        <div className="flex flex-col gap-6 lg:col-span-8 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Card>
            <p className={`${labelClass} text-secondary`}>Budget</p>
            <h3 className="mt-1 text-xl leading-7 font-semibold tracking-[-0.01em] md:text-2xl md:leading-8">
              What your budget paid for
            </h3>
            <div className="mt-5 bg-tint p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={labelClass}>Confirmed purchase → review posted</p>
                <p className="text-sm font-semibold">
                  {o.reviews} / {o.purchasesVerified} ({reviewedPct}%)
                </p>
              </div>
              <div className="mt-2 h-3 bg-secondary/15" aria-hidden="true">
                <div className="h-3 bg-secondary" style={{ width: `${reviewedPct}%` }} />
              </div>
              <p className="mt-2 text-[13px] leading-5 text-neutral">
                {o.purchasesPending} {o.purchasesPending === 1 ? "receipt" : "receipts"} being
                checked
              </p>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Purchases confirmed" value={o.purchasesVerified} />
              <Tile label="Reviews posted" value={o.reviews} accent />
              <Tile label="Deposited by you" value={formatCents(o.money.depositedCents)} />
              <Tile label="Paid back so far" value={formatCents(o.money.paidCents)} />
              <Tile label="Ready to be paid" value={formatCents(o.money.releasedCents)} />
              <Tile label="Held (return window)" value={formatCents(o.money.heldCents)} />
              <Tile
                label="Not paid (returned or rule breach)"
                value={formatCents(o.money.forfeitedCents)}
              />
              {o.room ? (
                <Tile
                  label="Budget left"
                  value={formatCents(Math.max(0, o.room.poolCents - o.room.committedCents))}
                  note={`${Math.max(0, o.room.maxReviews - o.room.claims)} reviews left · owed and pending taken off`}
                  highlight
                />
              ) : (
                <Tile label="Left in your offer's budget" value={NOT_SET_YET} highlight />
              )}
            </dl>
          </Card>
          <Reviews reviews={reviews} />
        </div>

        <div
          className={`flex flex-col gap-6 lg:col-span-4 lg:col-start-9 ${canMakeCodes && !ended ? "lg:row-start-2" : "lg:row-span-2 lg:row-start-1"}`}
        >
          <Card>
            <p className={`${labelClass} text-secondary`}>Ratings</p>
            <h3 className="mt-1 text-xl leading-7 font-semibold">Every rating</h3>
            <p className="mt-2 text-[13px] leading-5 text-neutral">
              Every rating is paid back the same. They're all shown alike.
            </p>
            <ul className="mt-4 space-y-3 text-sm" aria-label="Reviews by star rating">
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = o.starCounts[stars - 1];
                const pct = totalRatings > 0 ? Math.round((n / totalRatings) * 100) : 0;
                return (
                  <li key={stars}>
                    <div className="flex justify-between gap-3 font-semibold">
                      <span>
                        {stars} {stars === 1 ? "star" : "stars"}
                      </span>
                      <span>
                        {n} {n === 1 ? "review" : "reviews"}
                        {totalRatings > 0 ? ` (${pct}%)` : ""}
                      </span>
                    </div>
                    <span className="mt-1 block h-2 bg-tint-strong" aria-hidden="true">
                      <span className="block h-2 bg-primary" style={{ width: `${pct}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <p className={`${labelClass} text-secondary`}>Codes</p>
            <h3 className="mt-1 text-xl leading-7 font-semibold">From code to review</h3>
            <dl className="mt-4 flex flex-col gap-1.5 text-sm">
              <Row label="Codes made" value={o.codesMade} />
              <Row label="Codes opened by a customer" value={o.codesOpened} />
              <Row label="Purchases claimed" value={o.codesClaimed} />
              <Row label="Receipts being checked" value={o.purchasesPending} />
              <Row label="Purchases confirmed" value={o.purchasesVerified} />
              <Row label="Purchases turned down" value={o.purchasesRejected} />
              <Row label="Reviews posted" value={o.reviews} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  accent = false,
  highlight = false,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  accent?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "col-span-2 bg-tertiary p-4 text-white md:col-span-1 md:bg-secondary/15 md:text-primary"
          : "bg-tint p-4"
      }
    >
      <dt
        className={`${labelClass} ${highlight ? "text-canvas/80 md:text-secondary" : "text-neutral"}`}
      >
        {label}
      </dt>
      <dd
        className={`mt-1 text-2xl leading-8 font-bold tracking-[-0.01em] ${accent ? "text-secondary" : ""} ${highlight ? "md:text-secondary" : ""}`}
      >
        {value}
      </dd>
      {note ? (
        <dd
          className={`mt-1 text-xs ${highlight ? "text-canvas/80 md:text-primary" : "text-neutral"}`}
        >
          {note}
        </dd>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 bg-tint px-3 py-2">
      <dt>{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function MakeCodes({
  campaignId,
  onChange,
}: {
  campaignId: string;
  onChange: () => Promise<void>;
}) {
  const [count, setCount] = useState(String(MERCHANT_LIMITS.defaultCodeBatch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const max = RECEIPT_CODE_LIMITS.maxCodesPerBatch;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      setError(`Choose a number from 1 to ${max}.`);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await generateReceiptCodes({
      data: { campaignId, count: n, issueMode: "handout_batch" },
    }).catch(() => null);
    if (!r || !r.ok) setError(r?.message ?? UNAVAILABLE);
    else {
      setCodes(r.codes);
      await onChange();
    }
    setBusy(false);
  }

  return (
    <Card className="border-2 !border-secondary">
      <SectionTitle>Make receipt codes</SectionTitle>
      <p className="mt-2 text-sm leading-relaxed">
        Hand one code to each customer with their receipt. Each code works once, on one phone. The
        customer also sends a photo of their receipt.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-3" noValidate>
        <label className="flex flex-col gap-1.5 font-semibold">
          How many
          <input
            type="number"
            min={1}
            max={max}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className={inputClass + " w-28"}
          />
        </label>
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "Making…" : "Make codes"}
        </button>
      </form>
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {codes ? (
        <div className="mt-4">
          <p className="font-semibold">Print or copy these now — we only show them once.</p>
          <ul className="mt-2 divide-y divide-neutral/20 text-sm">
            {codes.map((c) => (
              <li key={c} className="py-1.5 font-mono break-all">
                {c} — {typeof window === "undefined" ? "" : window.location.origin}/r/{c}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => window.print()} className={btnSecondary + " mt-3"}>
            Print
          </button>
        </div>
      ) : null}
    </Card>
  );
}

function Reviews({
  reviews,
  className = "",
}: {
  reviews: Business["reviews"];
  className?: string;
}) {
  return (
    <Card className={className}>
      <p className={`${labelClass} text-secondary`}>Reviews</p>
      <h2 className="mt-1 text-xl leading-7 font-semibold md:text-2xl md:leading-8">
        Verified customer reviews
      </h2>
      <p className="mt-2 text-[13px] leading-5 text-neutral">
        Every rating, newest first. We don't show who wrote them. You can't approve, hide or remove
        a review. Replying is coming later.
      </p>
      {reviews.length === 0 ? <p className="mt-4">No reviews yet.</p> : null}
      <div className="mt-4 flex flex-col gap-3">
        {reviews.map((r) => (
          <article key={r.reviewId} className="bg-tint p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="bg-tint-strong px-2 py-0.5 text-[13px] font-semibold">
                {r.productLabel}
              </span>
              <span
                className="font-semibold whitespace-nowrap"
                aria-label={`${r.rating} out of 5 stars`}
              >
                <span aria-hidden="true">{ratingText(r.rating)}</span>
              </span>
            </div>
            <p className="mt-3 text-base leading-7 whitespace-pre-wrap italic">
              "{r.honestThought}"
            </p>
            <dl className="mt-3 grid gap-2 text-[13px] leading-5 sm:grid-cols-2">
              <div>
                <dt className={`${labelClass} text-neutral`}>What they used or bought</dt>
                <dd>{r.whatUsed}</dd>
              </div>
              <div>
                <dt className={`${labelClass} text-neutral`}>How long, or how much</dt>
                <dd>{r.howLong}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[13px] text-neutral">
              ✓ Verified purchase · {longDate(r.createdAt)}
            </p>
            {!r.shownToContacts ? (
              <p className="mt-1 text-[13px] text-neutral">
                Not shown to the customer's friends yet — it will be once the amount paid back is
                set.
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </Card>
  );
}
