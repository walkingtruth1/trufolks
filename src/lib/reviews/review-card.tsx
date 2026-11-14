// Ticket 4 — one review as friends see it (BRD v1.6 FR-16, LEG-01, P4;
// APP-17-04). Used for the preview before posting (FR-14), the posted review,
// the friends feed and a person's history. Layout ported from the Stitch
// Contacts review card (UI-17-01): header strip, purchased item, the three
// answers, then the disclosure.
// The disclosure always shows with the review, at full size, and can't be
// edited, collapsed or removed. Ratings are never colour-coded.
import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
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
  /** Optional line under the card (e.g. a link to the person's reviews). */
  footer?: ReactNode;
}

const label = "text-xs leading-4 font-semibold tracking-[0.06em] text-neutral uppercase";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function ReviewCard(p: ReviewCardProps) {
  const date = p.createdAt ? new Date(p.createdAt) : new Date();
  const r = Math.max(0, Math.min(5, Math.round(p.rating)));
  return (
    <article className="mt-4 border-t-[3px] border-primary bg-surface p-4 shadow-sm md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 bg-tint p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center bg-primary text-base font-bold text-white"
          >
            {initials(p.reviewerName)}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{p.reviewerName}</span>
              {p.verifiedPurchase ? (
                <span className="bg-tint-strong px-1.5 py-0.5 text-[11px] leading-[14px] font-semibold tracking-[0.05em] uppercase">
                  ✓ Verified purchase
                </span>
              ) : null}
            </p>
            <p className="text-[13px] leading-5 text-neutral">
              {p.createdAt
                ? date.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "Today"}{" "}
              · {p.merchantName}
            </p>
          </div>
        </div>
        <p className="font-semibold whitespace-nowrap">
          <span aria-hidden="true">{ratingText(r)}</span>
          <span className="sr-only">Rated {r} out of 5</span>
        </p>
      </div>

      <p className={`${label} mt-5`}>Purchased item</p>
      <p className="mt-1 text-xl leading-7 font-semibold tracking-[-0.01em]">{p.productLabel}</p>

      <dl className="mt-4 space-y-4 bg-tint p-4 text-[15px] leading-6">
        <div>
          <dt className={label}>1. What they used or bought</dt>
          <dd className="mt-1">{p.whatUsed}</dd>
        </div>
        <div>
          <dt className={label}>2. How long, or how much</dt>
          <dd className="mt-1">{p.howLong}</dd>
        </div>
        <div>
          <dt className={label}>3. In their own words</dt>
          <dd className="mt-1 bg-tint-strong p-3 text-base leading-7 whitespace-pre-wrap md:text-lg">
            {p.honestThought}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex gap-3 bg-tint-strong p-4 text-sm leading-relaxed text-primary">
        <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-secondary" />
        <div>
          {p.disclosure ? (
            disclosureLines(p.disclosure).map((line) => <p key={line}>{line}</p>)
          ) : (
            <p>Disclosure missing.</p>
          )}
        </div>
      </div>
      {p.footer ? <div className="mt-4 text-sm">{p.footer}</div> : null}
    </article>
  );
}
