// Ticket 6 — merchant dashboard and concierge set-up engine (BRD v1.6 FR-24,
// MER-01, MER-02, MER-05, MER-07, §13, P5). Server-only. Takes an Sql argument
// so tests run it on PGlite. Every dashboard read goes through a migration-0008
// function that takes the owner's user id, so an owner only ever sees their
// own businesses. Admin functions trust the caller's admin check (done in
// server-fns.ts with isAdminCaller) and record the admin as the actor.
import type { Sql } from "../db.ts";
import { parseDisclosure } from "../reviews/disclosure.ts";
import type { MerchantLimits } from "./limits.ts";
import type { MerchantOutcome } from "./messages.ts";
import { ownerPayoutTotals } from "../payouts/engine.ts";

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface OfferStats {
  campaignId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: string;
  /** MER-05 scan-to-review funnel. */
  codesMade: number;
  codesOpened: number;
  codesClaimed: number;
  purchasesPending: number;
  purchasesVerified: number;
  purchasesRejected: number;
  reviews: number;
  /** FR-24: every rating; index 0 = 1 star. */
  starCounts: [number, number, number, number, number];
  /** Ticket 7 (CFG-04): the offer's cap and how much of it is used. Null if its settings can't be read. */
  room: { claims: number; maxReviews: number; committedCents: number; poolCents: number } | null;
  /** Ticket 8: money deposited and paid back for this offer (MER-06, HON-09). */
  money: { depositedCents: number; heldCents: number; releasedCents: number; paidCents: number; forfeitedCents: number };
}

/** A review as the business sees it: no reviewer name or id (P5). */
export interface MerchantReview {
  reviewId: string;
  campaignId: string | null;
  productLabel: string;
  rating: number;
  whatUsed: string;
  howLong: string;
  honestThought: string;
  /** False until the disclosure is complete and contacts can see it (gap 19). */
  shownToContacts: boolean;
  createdAt: string;
}

export interface Business {
  merchantId: string;
  name: string;
  businessType: string | null;
  verificationStatus: string;
  termsAcceptedAt: string | null;
  walkthroughAcceptedAt: string | null;
  offers: OfferStats[];
  reviews: MerchantReview[];
}

/** Everything on the owner's dashboard, for every business they own. */
export async function getDashboard(sql: Sql, input: { userId: string; limits: MerchantLimits }): Promise<Business[]> {
  if (!input.userId) return [];
  const merchants = await sql.query<{
    id: string;
    name: string;
    business_type: string | null;
    verification_status: string;
    terms_accepted_at: unknown;
    walkthrough_accepted_at: unknown;
  }>(
    `select id, name, business_type, verification_status, terms_accepted_at, walkthrough_accepted_at
       from merchants where owner_user_id = $1 order by created_at, id`,
    [input.userId],
  );
  if (merchants.length === 0) return [];
  const stats = await sql.query<Record<string, unknown> & { merchant_id: string }>(
    `select * from trufolks_owner_offer_stats($1) order by starts_at desc, campaign_id`,
    [input.userId],
  );
  const reviews = await sql.query<{
    merchant_id: string;
    campaign_id: string | null;
    review_id: string;
    product_label: string;
    rating: number;
    what_used: string;
    how_long: string;
    honest_thought: string;
    disclosure: unknown;
    created_at: unknown;
  }>(`select * from trufolks_owner_reviews($1, $2)`, [input.userId, input.limits.dashboardReviewsMax]);

  const n = (v: unknown) => Number(v ?? 0);
  const totals = await ownerPayoutTotals(sql, { userId: input.userId });
  const noMoney = { depositedCents: 0, heldCents: 0, releasedCents: 0, paidCents: 0, forfeitedCents: 0 };
  // Ticket 7: cap usage per offer, from the offer's pinned settings (CFG-04).
  const rooms = new Map<string, OfferStats["room"]>();
  for (const s of stats) {
    const r = await sql.query<{ r_claims: number; r_max_reviews: number | null; r_committed_cents: number; r_pool_cents: number | null }>(
      `select * from trufolks_campaign_room($1, 0)`,
      [String(s.campaign_id)],
    );
    const x = r[0];
    rooms.set(
      String(s.campaign_id),
      x && x.r_max_reviews !== null && x.r_pool_cents !== null
        ? { claims: n(x.r_claims), maxReviews: n(x.r_max_reviews), committedCents: n(x.r_committed_cents), poolCents: n(x.r_pool_cents) }
        : null,
    );
  }
  return merchants.map((m) => ({
    merchantId: m.id,
    name: m.name,
    businessType: m.business_type,
    verificationStatus: m.verification_status,
    termsAcceptedAt: iso(m.terms_accepted_at),
    walkthroughAcceptedAt: iso(m.walkthrough_accepted_at),
    offers: stats
      .filter((s) => s.merchant_id === m.id)
      .map((s) => ({
        campaignId: String(s.campaign_id),
        name: String(s.campaign_name),
        startsAt: iso(s.starts_at) ?? "",
        endsAt: iso(s.ends_at) ?? "",
        status: String(s.status),
        codesMade: n(s.codes_made),
        codesOpened: n(s.codes_opened),
        codesClaimed: n(s.codes_claimed),
        purchasesPending: n(s.purchases_pending),
        purchasesVerified: n(s.purchases_verified),
        purchasesRejected: n(s.purchases_rejected),
        reviews: n(s.reviews),
        starCounts: [n(s.stars_1), n(s.stars_2), n(s.stars_3), n(s.stars_4), n(s.stars_5)] as OfferStats["starCounts"],
        room: rooms.get(String(s.campaign_id)) ?? null,
        money: totals.get(String(s.campaign_id)) ?? noMoney,
      })),
    reviews: reviews
      .filter((r) => r.merchant_id === m.id)
      .map((r) => {
        const d = parseDisclosure(r.disclosure);
        return {
          reviewId: r.review_id,
          campaignId: r.campaign_id,
          productLabel: r.product_label,
          rating: r.rating,
          whatUsed: r.what_used,
          howLong: r.how_long,
          honestThought: r.honest_thought,
          shownToContacts: Boolean(d?.complete),
          createdAt: iso(r.created_at) ?? "",
        };
      }),
  }));
}

/** The owner accepts the MER-02 statement or the MER-07 walkthrough. Logged; can't be undone. */
export async function acceptMerchant(
  sql: Sql,
  input: { userId: string; merchantId: string; what: "terms" | "walkthrough" },
): Promise<Extract<MerchantOutcome, "ok" | "already" | "not_found" | "invalid">> {
  if (!input.userId || !input.merchantId) return "not_found";
  const rows = await sql.query<{ r: string }>(`select trufolks_merchant_accept($1, $2, $3) as r`, [
    input.userId,
    input.merchantId,
    input.what,
  ]);
  const r = rows[0]?.r;
  return r === "ok" || r === "already" || r === "invalid" ? r : "not_found";
}

// ------------------------------------------------------------------ concierge set-up (admin only)

export interface AdminBusiness {
  merchantId: string;
  name: string;
  businessType: string | null;
  ownerName: string;
  ownerEmail: string | null;
  termsAccepted: boolean;
  walkthroughAccepted: boolean;
  createdAt: string;
  offers: { campaignId: string; name: string; startsAt: string; endsAt: string; status: string }[];
}

/** Every business, for the TruFolks team. */
export async function listBusinessesForAdmin(sql: Sql): Promise<AdminBusiness[]> {
  const merchants = await sql.query<{
    id: string;
    name: string;
    business_type: string | null;
    owner_name: string;
    owner_email: string | null;
    terms_accepted_at: unknown;
    walkthrough_accepted_at: unknown;
    created_at: unknown;
  }>(
    `select m.id, m.name, m.business_type, u.display_name as owner_name, a."email" as owner_email,
            m.terms_accepted_at, m.walkthrough_accepted_at, m.created_at
       from merchants m
       join users u on u.id = m.owner_user_id
       left join "user" a on a."id" = m.owner_user_id
      order by m.created_at desc, m.id`,
  );
  const offers = await sql.query<{
    id: string;
    merchant_id: string;
    name: string;
    starts_at: unknown;
    ends_at: unknown;
    status: string;
  }>(`select id, merchant_id, name, starts_at, ends_at, status from campaigns order by starts_at desc, id`);
  return merchants.map((m) => ({
    merchantId: m.id,
    name: m.name,
    businessType: m.business_type,
    ownerName: m.owner_name,
    ownerEmail: m.owner_email,
    termsAccepted: m.terms_accepted_at !== null,
    walkthroughAccepted: m.walkthrough_accepted_at !== null,
    createdAt: iso(m.created_at) ?? "",
    offers: offers
      .filter((o) => o.merchant_id === m.id)
      .map((o) => ({
        campaignId: o.id,
        name: o.name,
        startsAt: iso(o.starts_at) ?? "",
        endsAt: iso(o.ends_at) ?? "",
        status: o.status,
      })),
  }));
}

/** Add a business for an existing account, found by its login email. */
export async function adminCreateBusiness(
  sql: Sql,
  input: { adminId: string; ownerEmail: string; name: string; businessType: string },
): Promise<{ outcome: "ok"; merchantId: string } | { outcome: "owner_not_found" | "invalid" }> {
  const email = input.ownerEmail.trim().toLowerCase();
  if (!email || email.length > 320) return { outcome: "owner_not_found" };
  const owner = await sql.query<{ id: string }>(`select "id" from "user" where lower("email") = $1 limit 1`, [email]);
  if (!owner[0]) return { outcome: "owner_not_found" };
  const rows = await sql.query<{ r_outcome: string; r_merchant_id: string | null }>(
    `select * from trufolks_admin_create_merchant($1, $2, $3, $4)`,
    [input.adminId, owner[0].id, input.name, input.businessType],
  );
  const r = rows[0];
  if (r?.r_outcome === "ok" && r.r_merchant_id) return { outcome: "ok", merchantId: r.r_merchant_id };
  return { outcome: r?.r_outcome === "owner_not_found" ? "owner_not_found" : "invalid" };
}

/** Create a live offer for a business. Type and most days come from settings (CFG-05, CFG-04). */
export async function adminCreateOffer(
  sql: Sql,
  input: { adminId: string; merchantId: string; name: string; startsAt: string | null; endsAt: string | null },
): Promise<{ outcome: "ok"; campaignId: string } | { outcome: "not_found" | "invalid" | "too_long" }> {
  if (!input.startsAt || !input.endsAt || !iso(input.startsAt) || !iso(input.endsAt)) return { outcome: "invalid" };
  const rows = await sql.query<{ r_outcome: string; r_campaign_id: string | null }>(
    `select * from trufolks_admin_create_offer($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
    [input.adminId, input.merchantId, input.name, input.startsAt, input.endsAt],
  );
  const r = rows[0];
  if (r?.r_outcome === "ok" && r.r_campaign_id) return { outcome: "ok", campaignId: r.r_campaign_id };
  if (r?.r_outcome === "not_found" || r?.r_outcome === "too_long") return { outcome: r.r_outcome };
  return { outcome: "invalid" };
}
