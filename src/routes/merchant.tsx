// Ticket 6 — the merchant dashboard at /merchant (BRD v1.6 FR-24, MER-02,
// MER-05, MER-07, Journey C, §13, P5, FR-27). Plain, unstyled (STITCH-UI-01).
//
// * The owner first reads and accepts the mixed-ratings walkthrough (MER-07)
//   and the pay-for-any-rating statement (MER-02). Codes can't be made before.
// * Per offer: scan-to-review numbers (MER-05) and every rating (FR-24).
//   Reward cost to date and cap remaining show "Not set yet" until Tickets 7/8.
// * Reviews with no reviewer name (P5), every rating, newest first. The
//   business can't approve, hide or remove a review.
// * Make receipt codes (existing generateReceiptCodes): shown once as
//   printable short codes and links. No QR image yet (gap 29).
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { Business, OfferStats } from "@/lib/merchants/engine";
import { MERCHANT_LIMITS } from "@/lib/merchants/limits";
import { merchantMessage, NOT_SET_YET, PAY_FOR_ANY_RATING_STATEMENT, WALKTHROUGH } from "@/lib/merchants/messages";
import { acceptMerchantStatement, getMerchantDashboard } from "@/lib/merchants/server-fns";
import { RECEIPT_CODE_LIMITS } from "@/lib/receipt-codes/limits";
import { generateReceiptCodes } from "@/lib/receipt-codes/server-fns";
import { ratingText } from "@/lib/reviews/review-input";

export const Route = createFileRoute("/merchant")({ component: MerchantPage });

const UNAVAILABLE = merchantMessage("unavailable") ?? "";

function longDate(isoTime: string): string {
  const d = new Date(isoTime);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

type Page = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; businesses: Business[] };

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
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!userId) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">Your business</h1>
        <p>Please sign in to see your business.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: "/merchant" }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }
  if (page.kind === "error") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">Your business</h1>
        <p role="alert">{page.message}</p>
      </main>
    );
  }
  if (page.kind !== "ok") return null;

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Your business</h1>
      {page.businesses.length === 0 ? (
        <p>
          There's no business on this account yet. The TruFolks team sets up pilot businesses with you in person — get in
          touch with us and we'll add yours.
        </p>
      ) : null}
      {page.businesses.map((b) => (
        <BusinessView key={b.merchantId} business={b} onChange={load} />
      ))}
    </main>
  );
}

function BusinessView({ business: b, onChange }: { business: Business; onChange: () => Promise<void> }) {
  const ready = Boolean(b.termsAcceptedAt && b.walkthroughAcceptedAt);
  return (
    <section className="mt-6 border-t pt-4">
      <h2 className="text-xl font-semibold">{b.name}</h2>
      {b.businessType ? <p>{b.businessType}</p> : null}
      {!b.walkthroughAcceptedAt ? (
        <Walkthrough merchantId={b.merchantId} onChange={onChange} />
      ) : !b.termsAcceptedAt ? (
        <Statement merchantId={b.merchantId} onChange={onChange} />
      ) : (
        <p className="mt-2">
          You accepted how TruFolks works on {longDate(b.termsAcceptedAt)}: every honest review is paid back the same,
          whatever the rating.
        </p>
      )}
      {b.offers.length === 0 ? <p className="mt-4">No offers yet. The TruFolks team will set one up with you.</p> : null}
      {b.offers.map((o) => (
        <OfferView key={o.campaignId} offer={o} canMakeCodes={ready} onChange={onChange} />
      ))}
      <Reviews business={b} />
    </section>
  );
}

function useAccept(merchantId: string, what: "terms" | "walkthrough", onChange: () => Promise<void>) {
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

function Walkthrough({ merchantId, onChange }: { merchantId: string; onChange: () => Promise<void> }) {
  const { busy, error, accept } = useAccept(merchantId, "walkthrough", onChange);
  return (
    <div className="mt-4 border p-4">
      <h3 className="font-semibold">Step 1 of 2: what reviews look like</h3>
      <p className="mt-1">{WALKTHROUGH.intro}</p>
      <ul className="mt-2">
        {WALKTHROUGH.examples.map((e) => (
          <li key={e.rating} className="mt-1">
            <span aria-label={`${e.rating} out of 5 stars`}>{ratingText(e.rating)}</span> — "{e.thought}"
          </li>
        ))}
      </ul>
      <ul className="mt-2 list-disc pl-6">
        {WALKTHROUGH.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <button type="button" onClick={() => void accept()} disabled={busy} className="mt-4 rounded border px-4 py-2">
        {busy ? "Saving…" : "I understand"}
      </button>
      {error ? <p role="alert" className="mt-2">{error}</p> : null}
    </div>
  );
}

function Statement({ merchantId, onChange }: { merchantId: string; onChange: () => Promise<void> }) {
  const { busy, error, accept } = useAccept(merchantId, "terms", onChange);
  return (
    <div className="mt-4 border p-4">
      <h3 className="font-semibold">Step 2 of 2: what you agree to</h3>
      {PAY_FOR_ANY_RATING_STATEMENT.map((line) => (
        <p key={line} className="mt-1">
          {line}
        </p>
      ))}
      <p className="mt-2">You need to accept this before you can make receipt codes.</p>
      <button type="button" onClick={() => void accept()} disabled={busy} className="mt-4 rounded border px-4 py-2">
        {busy ? "Saving…" : "I accept"}
      </button>
      {error ? <p role="alert" className="mt-2">{error}</p> : null}
    </div>
  );
}

function OfferView({ offer: o, canMakeCodes, onChange }: { offer: OfferStats; canMakeCodes: boolean; onChange: () => Promise<void> }) {
  const ended = new Date(o.endsAt).getTime() <= Date.now() || o.status !== "live";
  return (
    <div className="mt-4 border p-4">
      <h3 className="font-semibold">{o.name}</h3>
      <p>
        {longDate(o.startsAt)} to {longDate(o.endsAt)}
        {ended ? " (ended)" : ""}
      </p>
      <h4 className="mt-2 font-semibold">From code to review</h4>
      <dl>
        <Row label="Codes made" value={o.codesMade} />
        <Row label="Codes opened by a customer" value={o.codesOpened} />
        <Row label="Purchases claimed" value={o.codesClaimed} />
        <Row label="Receipts being checked" value={o.purchasesPending} />
        <Row label="Purchases confirmed" value={o.purchasesVerified} />
        <Row label="Purchases turned down" value={o.purchasesRejected} />
        <Row label="Reviews posted" value={o.reviews} />
      </dl>
      <h4 className="mt-2 font-semibold">Every rating</h4>
      <ul aria-label="Reviews by star rating">
        {[5, 4, 3, 2, 1].map((stars) => (
          <li key={stars}>
            {stars} {stars === 1 ? "star" : "stars"}: {o.starCounts[stars - 1]}
          </li>
        ))}
      </ul>
      <dl className="mt-2">
        <Row label="Paid back so far" value={NOT_SET_YET} />
        <Row label="Left in your offer's budget" value={NOT_SET_YET} />
      </dl>
      {canMakeCodes && !ended ? <MakeCodes campaignId={o.campaignId} onChange={onChange} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MakeCodes({ campaignId, onChange }: { campaignId: string; onChange: () => Promise<void> }) {
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
    const r = await generateReceiptCodes({ data: { campaignId, count: n, issueMode: "handout_batch" } }).catch(() => null);
    if (!r || !r.ok) setError(r?.message ?? UNAVAILABLE);
    else {
      setCodes(r.codes);
      await onChange();
    }
    setBusy(false);
  }

  return (
    <div className="mt-4">
      <h4 className="font-semibold">Make receipt codes</h4>
      <p>
        Hand one code to each customer with their receipt. Each code works once, on one phone. The customer also sends a
        photo of their receipt.
      </p>
      <form onSubmit={onSubmit} className="mt-2" noValidate>
        <label className="block">
          How many
          <input
            type="number"
            min={1}
            max={max}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="mt-1 block w-24 border px-2 py-1"
          />
        </label>
        <button type="submit" disabled={busy} className="mt-2 rounded border px-4 py-2">
          {busy ? "Making…" : "Make codes"}
        </button>
      </form>
      {error ? <p role="alert" className="mt-2">{error}</p> : null}
      {codes ? (
        <div className="mt-2">
          <p>Print or copy these now — we only show them once.</p>
          <ul className="mt-1">
            {codes.map((c) => (
              <li key={c} className="mt-1 font-mono">
                {c} — {typeof window === "undefined" ? "" : window.location.origin}/r/{c}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => window.print()} className="mt-2 rounded border px-4 py-2">
            Print
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Reviews({ business: b }: { business: Business }) {
  const offerName = (id: string | null) => b.offers.find((o) => o.campaignId === id)?.name ?? null;
  return (
    <div className="mt-6">
      <h3 className="font-semibold">Reviews</h3>
      <p>
        Every rating, newest first. We don't show who wrote them. You can't approve, hide or remove a review. Replying is
        coming later.
      </p>
      {b.reviews.length === 0 ? <p className="mt-2">No reviews yet.</p> : null}
      {b.reviews.map((r) => (
        <article key={r.reviewId} className="mt-4 border p-4">
          <p aria-label={`${r.rating} out of 5 stars`}>{ratingText(r.rating)}</p>
          <p>
            {r.productLabel}
            {offerName(r.campaignId) ? ` — ${offerName(r.campaignId)}` : ""}
          </p>
          <dl className="mt-2">
            <dt className="font-semibold">What they used or bought</dt>
            <dd>{r.whatUsed}</dd>
            <dt className="mt-1 font-semibold">How long, or how much</dt>
            <dd>{r.howLong}</dd>
            <dt className="mt-1 font-semibold">One honest thought</dt>
            <dd className="whitespace-pre-wrap">{r.honestThought}</dd>
          </dl>
          <p className="mt-2">Verified purchase · {longDate(r.createdAt)}</p>
          {!r.shownToContacts ? (
            <p className="mt-1">Not shown to the customer's contacts yet — it will be once the amount paid back is set.</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
