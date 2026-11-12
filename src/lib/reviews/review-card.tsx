// Ticket 4 — one review as contacts see it (BRD v1.6 FR-16, LEG-01, P4).
// Used for the preview before posting (FR-14) and the posted review; the
// contacts feed (Ticket 5) should reuse it. Plain, unstyled (STITCH-UI-01).
// The disclosure always shows with the review and can't be edited or removed.
import { disclosureLines, type Disclosure } from "./disclosure";
import { ratingText } from "./review-input";

export interface ReviewCardProps {
  reviewerName: string;
  merchantName: string;
  productLabel: string;
  rating: number;
  whatUsed: string;
  howLong: string;
  honestThought: string;
  verifiedPurchase: boolean;
  disclosure: Disclosure | null;
  /** ISO time; null in a preview (shown as "today"). */
  createdAt: string | null;
}

export function ReviewCard(p: ReviewCardProps) {
  const date = p.createdAt ? new Date(p.createdAt) : new Date();
  return (
    <article className="mt-4 border p-4">
      <p className="font-semibold">{p.reviewerName}</p>
      <p>
        {p.merchantName} — {p.productLabel}
      </p>
      <p aria-label={`${p.rating} out of 5 stars`}>{ratingText(p.rating)}</p>
      <dl className="mt-2">
        <dt className="font-semibold">What they used or bought</dt>
        <dd>{p.whatUsed}</dd>
        <dt className="mt-1 font-semibold">How long, or how much</dt>
        <dd>{p.howLong}</dd>
        <dt className="mt-1 font-semibold">One honest thought</dt>
        <dd className="whitespace-pre-wrap">{p.honestThought}</dd>
      </dl>
      {p.verifiedPurchase ? <p className="mt-2">Verified purchase</p> : null}
      <div className="mt-2 border-t pt-2">
        {p.disclosure ? (
          disclosureLines(p.disclosure).map((line) => <p key={line}>{line}</p>)
        ) : (
          <p>Disclosure missing.</p>
        )}
      </div>
      <p className="mt-2">
        {p.createdAt ? date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "Today"}
      </p>
    </article>
  );
}
