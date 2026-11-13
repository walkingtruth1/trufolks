// Ticket 4 — review submission engine (BRD v1.6 FR-08, FR-11, FR-14, FR-15,
// HON-01, HON-04, LEG-01). Server-only. Takes an Sql argument (like the
// receipt-code engine) so tests run it on PGlite. The atomic rules live in
// migration 0006 (trufolks_submit_review).
import type { Sql } from "../db.ts";
import { parseDisclosure, type Disclosure } from "./disclosure.ts";
import type { ReviewLimits } from "./limits.ts";
import type { ReviewOutcome } from "./messages.ts";
import { checkReviewInput, type ReviewField } from "./review-input.ts";

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A review as contacts see it (FR-16). */
export interface ReviewView {
  reviewId: string;
  reviewerName: string;
  merchantName: string;
  productLabel: string;
  rating: number;
  whatUsed: string;
  howLong: string;
  honestThought: string;
  verifiedPurchase: boolean;
  disclosure: Disclosure | null;
  createdAt: string;
}

export interface ReviewStart {
  purchaseId: string;
  status: "pending" | "verified" | "rejected";
  merchantName: string;
  campaignName: string | null;
  productLabel: string;
  purchasedAt: string;
  reviewerName: string;
  /** The disclosure exactly as it will be attached (FR-14). */
  disclosure: Disclosure | null;
  review: ReviewView | null;
}

type ReviewRow = {
  review_id: string;
  reviewer_name: string;
  merchant_name: string;
  product_label: string;
  rating: number;
  what_used: string;
  how_long: string;
  honest_thought: string;
  verification_status: string;
  disclosure: unknown;
  created_at: unknown;
};

// v1.8: a receipt-only purchase has no business; its place is the store name the
// member typed (migration 0012). Read through to_jsonb so these queries also run on
// schemas from before 0012 (the narrower test suites load only early migrations).
const REVIEW_SQL = `
  select r.id as review_id, u.display_name as reviewer_name, coalesce(m.name, to_jsonb(vp) ->> 'store_name', '') as merchant_name,
         vp.product_label, r.rating, r.what_used, r.how_long, r.honest_thought,
         vp.verification_status, r.disclosure, r.created_at
    from reviews r
    join users u on u.id = r.user_id
    join verified_purchases vp on vp.id = r.verified_purchase_id
    left join merchants m on m.id = vp.merchant_id`;

function toView(r: ReviewRow): ReviewView {
  return {
    reviewId: r.review_id,
    reviewerName: r.reviewer_name,
    merchantName: r.merchant_name,
    productLabel: r.product_label,
    rating: r.rating,
    whatUsed: r.what_used,
    howLong: r.how_long,
    honestThought: r.honest_thought,
    verifiedPurchase: r.verification_status === "verified",
    disclosure: parseDisclosure(r.disclosure),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

/** The person's own purchase, ready to review (or their posted review). Nobody else's. */
export async function getReviewStart(
  sql: Sql,
  input: { purchaseId: string; userId: string },
): Promise<{ outcome: "ok"; start: ReviewStart } | { outcome: "not_found" }> {
  if (!input.purchaseId || !input.userId) return { outcome: "not_found" };
  const rows = await sql.query<{
    id: string;
    verification_status: "pending" | "verified" | "rejected";
    merchant_name: string;
    campaign_name: string | null;
    product_label: string;
    purchased_at: unknown;
    reviewer_name: string;
    disclosure: unknown;
  }>(
    `select vp.id, vp.verification_status, coalesce(m.name, to_jsonb(vp) ->> 'store_name', '') as merchant_name, c.name as campaign_name,
            vp.product_label, vp.purchased_at, u.display_name as reviewer_name,
            trufolks_review_disclosure(vp.id) as disclosure
       from verified_purchases vp
       left join merchants m on m.id = vp.merchant_id
       join users u on u.id = vp.user_id
       left join campaigns c on c.id = vp.campaign_id
      where vp.id = $1 and vp.user_id = $2`,
    [input.purchaseId, input.userId],
  );
  const p = rows[0];
  if (!p) return { outcome: "not_found" };
  const reviews = await sql.query<ReviewRow>(`${REVIEW_SQL} where r.verified_purchase_id = $1 and r.user_id = $2`, [
    input.purchaseId,
    input.userId,
  ]);
  return {
    outcome: "ok",
    start: {
      purchaseId: p.id,
      status: p.verification_status,
      merchantName: p.merchant_name,
      campaignName: p.campaign_name,
      productLabel: p.product_label,
      purchasedAt: iso(p.purchased_at) ?? new Date(0).toISOString(),
      reviewerName: p.reviewer_name,
      disclosure: parseDisclosure(p.disclosure),
      review: reviews[0] ? toView(reviews[0]) : null,
    },
  };
}

export type SubmitResult =
  | { outcome: "ok"; review: ReviewView }
  | { outcome: Exclude<ReviewOutcome, "ok">; errors?: Partial<Record<ReviewField, string>> };

/** Post the person's review of their own verified purchase. One per purchase (HON-04). */
export async function submitReview(
  sql: Sql,
  input: {
    purchaseId: string;
    userId: string;
    fields: Partial<Record<ReviewField, unknown>>;
    limits: ReviewLimits;
  },
): Promise<SubmitResult> {
  if (!input.purchaseId || !input.userId) return { outcome: "not_found" };
  const check = checkReviewInput(input.fields, input.limits);
  if (!check.ok) return { outcome: "invalid", errors: check.errors };
  const v = check.value;
  const rows = await sql.query<{ r_outcome: ReviewOutcome; r_review_id: string | null }>(
    `select * from trufolks_submit_review($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.purchaseId,
      input.userId,
      v.rating,
      v.whatUsed,
      v.howLong,
      v.honestThought,
      input.limits.maxShortFieldChars,
      input.limits.maxThoughtChars,
    ],
  );
  const outcome = rows[0]?.r_outcome ?? "unavailable";
  if (outcome !== "ok" || !rows[0]?.r_review_id) return { outcome: outcome === "ok" ? "unavailable" : outcome };
  const posted = await sql.query<ReviewRow>(`${REVIEW_SQL} where r.id = $1`, [rows[0].r_review_id]);
  if (!posted[0]) return { outcome: "unavailable" };
  return { outcome: "ok", review: toView(posted[0]) };
}
