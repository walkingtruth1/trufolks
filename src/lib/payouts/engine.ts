// Ticket 8 — payout ledger engine (BRD v1.6 FR-20, FR-22, FR-27, HON-09,
// MER-06, RES-01(c)). Server-only. Takes an Sql argument so tests run it on
// PGlite. The rules live in migration 0010: payouts are created by the
// database when a review is posted (never reading the rating), and every
// change is logged. This file only reads and calls those functions.
import type { Sql } from "../db.ts";
import type { PayoutOutcome, PayoutStatus } from "./messages.ts";

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Release every payout whose return window has passed (no scheduler; runs on page loads). */
export async function releaseDuePayouts(sql: Sql): Promise<number> {
  const rows = await sql.query<{ n: number }>(`select trufolks_release_due_payouts() as n`);
  return Number(rows[0]?.n ?? 0);
}

export interface Payout {
  payoutId: string;
  reviewId: string;
  purchaseId: string;
  merchantName: string;
  campaignName: string;
  productLabel: string;
  orderValueCents: number;
  amountCents: number;
  currency: string;
  formula: { percentBp: number; floorCents: number; capCents: number };
  status: PayoutStatus;
  holdUntil: string;
  flagged: boolean;
  flagReason: string | null;
  forfeitKind: "returned" | "policy_breach" | null;
  forfeitReason: string | null;
  paidAt: string | null;
  paidMethod: string | null;
  paidReference: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  review_id: string;
  verified_purchase_id: string;
  merchant_name: string;
  campaign_name: string;
  product_label: string;
  order_value_cents: number;
  amount_cents: number;
  currency: string;
  percent_bp: number;
  floor_cents: number;
  cap_cents: number;
  status: PayoutStatus;
  hold_until: unknown;
  flagged: boolean;
  flag_reason: string | null;
  forfeit_kind: "returned" | "policy_breach" | null;
  forfeit_reason: string | null;
  paid_at: unknown;
  paid_method: string | null;
  paid_reference: string | null;
  created_at: unknown;
};

const SELECT = `
  select p.*, m.name as merchant_name, c.name as campaign_name, vp.product_label
    from payouts p
    join merchants m on m.id = p.merchant_id
    join campaigns c on c.id = p.campaign_id
    join verified_purchases vp on vp.id = p.verified_purchase_id`;

function toPayout(r: Row): Payout {
  return {
    payoutId: r.id,
    reviewId: r.review_id,
    purchaseId: r.verified_purchase_id,
    merchantName: r.merchant_name,
    campaignName: r.campaign_name,
    productLabel: r.product_label,
    orderValueCents: Number(r.order_value_cents),
    amountCents: Number(r.amount_cents),
    currency: r.currency,
    formula: { percentBp: Number(r.percent_bp), floorCents: Number(r.floor_cents), capCents: Number(r.cap_cents) },
    status: r.status,
    holdUntil: iso(r.hold_until) ?? "",
    flagged: r.flagged,
    flagReason: r.flag_reason,
    forfeitKind: r.forfeit_kind,
    forfeitReason: r.forfeit_reason,
    paidAt: iso(r.paid_at),
    paidMethod: r.paid_method,
    paidReference: r.paid_reference,
    createdAt: iso(r.created_at) ?? "",
  };
}

/** FR-20: every payout of this person, newest first. Releases any that are due first. */
export async function myPayouts(sql: Sql, input: { userId: string }): Promise<Payout[]> {
  if (!input.userId) return [];
  await releaseDuePayouts(sql);
  const rows = await sql.query<Row>(`${SELECT} where p.user_id = $1 order by p.created_at desc, p.id desc`, [input.userId]);
  return rows.map(toPayout);
}

export interface AdminPayout extends Payout {
  personName: string;
  personEmail: string | null;
}

/** Every payout, for the TruFolks team (who pay people by hand in the pilot). */
export async function adminPayouts(sql: Sql): Promise<AdminPayout[]> {
  await releaseDuePayouts(sql);
  const rows = await sql.query<Row & { person_name: string; person_email: string | null }>(
    `select x.*, u.display_name as person_name, a."email" as person_email
       from (${SELECT}) x
       join users u on u.id = x.user_id
       left join "user" a on a."id" = x.user_id
      order by x.created_at desc, x.id desc
      limit 500`,
  );
  return rows.map((r) => ({ ...toPayout(r), personName: r.person_name, personEmail: r.person_email }));
}

export interface AdminOffer {
  campaignId: string;
  name: string;
  merchantName: string;
  endsAt: string;
  status: string;
  poolSettingCents: number | null;
  depositedCents: number;
  committedCents: number;
  claims: number;
  maxReviews: number | null;
  deposits: { amountCents: number; note: string; at: string; byName: string }[];
}

/** Offers with their deposits and budget use (MER-06). */
export async function adminOffers(sql: Sql): Promise<AdminOffer[]> {
  const offers = await sql.query<{
    id: string;
    name: string;
    merchant_name: string;
    ends_at: unknown;
    status: string;
    pool: number | null;
    deposited: number;
    r_committed_cents: number;
    r_claims: number;
    r_max_reviews: number | null;
  }>(
    `select c.id, c.name, m.name as merchant_name, c.ends_at, c.status,
            (cfg.settings -> 'campaign' ->> 'pool_cents')::int as pool,
            trufolks_offer_deposited_cents(c.id) as deposited,
            room.r_committed_cents, room.r_claims, room.r_max_reviews
       from campaigns c
       join merchants m on m.id = c.merchant_id
       cross join lateral trufolks_campaign_config(c.id) cfg
       cross join lateral trufolks_campaign_room(c.id, 0) room
      order by c.starts_at desc, c.id`,
  );
  const deposits = await sql.query<{ campaign_id: string; amount_cents: number; note: string; at: unknown; by_name: string }>(
    `select d.campaign_id, d.amount_cents, d.note, d.at, u.display_name as by_name
       from offer_deposits d join users u on u.id = d.received_by order by d.at`,
  );
  return offers.map((o) => ({
    campaignId: o.id,
    name: o.name,
    merchantName: o.merchant_name,
    endsAt: iso(o.ends_at) ?? "",
    status: o.status,
    poolSettingCents: o.pool === null ? null : Number(o.pool),
    depositedCents: Number(o.deposited),
    committedCents: Number(o.r_committed_cents ?? 0),
    claims: Number(o.r_claims ?? 0),
    maxReviews: o.r_max_reviews === null ? null : Number(o.r_max_reviews),
    deposits: deposits
      .filter((d) => d.campaign_id === o.id)
      .map((d) => ({ amountCents: Number(d.amount_cents), note: d.note, at: iso(d.at) ?? "", byName: d.by_name })),
  }));
}

/** How much has been deposited for an offer (MER-06). */
export async function offerDepositedCents(sql: Sql, campaignId: string): Promise<number> {
  const rows = await sql.query<{ n: number }>(`select trufolks_offer_deposited_cents($1) as n`, [campaignId]);
  return Number(rows[0]?.n ?? 0);
}

type ActionOutcome = Extract<PayoutOutcome, "ok" | "not_found" | "wrong_status" | "invalid" | "window_passed" | "needs_flag" | "over_pool">;
const KNOWN: ActionOutcome[] = ["ok", "not_found", "wrong_status", "invalid", "window_passed", "needs_flag", "over_pool"];

function outcome(v: unknown): ActionOutcome {
  return KNOWN.find((k) => k === v) ?? "invalid";
}

export async function recordDeposit(
  sql: Sql,
  input: { actorId: string; campaignId: string; amountCents: number; note: string },
): Promise<ActionOutcome> {
  if (!Number.isInteger(input.amountCents)) return "invalid";
  const rows = await sql.query<{ r: string }>(`select trufolks_record_deposit($1, $2, $3, $4) as r`, [
    input.actorId,
    input.campaignId,
    input.amountCents,
    input.note,
  ]);
  return outcome(rows[0]?.r);
}

export type PayoutAction =
  | { kind: "flag"; reason: string }
  | { kind: "clear_flag"; reason: string }
  | { kind: "forfeit"; forfeitKind: "returned" | "policy_breach"; reason: string }
  | { kind: "paid"; method: string; reference: string };

/** An admin action on one payout. Every one is logged with the admin and the reason. */
export async function actOnPayout(sql: Sql, input: { actorId: string; payoutId: string; action: PayoutAction }): Promise<ActionOutcome> {
  const a = input.action;
  const call =
    a.kind === "flag"
      ? sql.query<{ r: string }>(`select trufolks_flag_payout($1, $2, $3) as r`, [input.actorId, input.payoutId, a.reason])
      : a.kind === "clear_flag"
        ? sql.query<{ r: string }>(`select trufolks_clear_payout_flag($1, $2, $3) as r`, [input.actorId, input.payoutId, a.reason])
        : a.kind === "forfeit"
          ? sql.query<{ r: string }>(`select trufolks_forfeit_payout($1, $2, $3, $4) as r`, [input.actorId, input.payoutId, a.forfeitKind, a.reason])
          : sql.query<{ r: string }>(`select trufolks_mark_payout_paid($1, $2, $3, $4) as r`, [input.actorId, input.payoutId, a.method, a.reference]);
  return outcome((await call)[0]?.r);
}

export interface OfferPayoutTotals {
  depositedCents: number;
  heldCents: number;
  releasedCents: number;
  paidCents: number;
  forfeitedCents: number;
}

/** Owner-only totals per offer, for the merchant dashboard. */
export async function ownerPayoutTotals(sql: Sql, input: { userId: string }): Promise<Map<string, OfferPayoutTotals>> {
  await releaseDuePayouts(sql);
  const rows = await sql.query<{
    campaign_id: string;
    deposited_cents: number;
    held_cents: number;
    released_cents: number;
    paid_cents: number;
    forfeited_cents: number;
  }>(`select * from trufolks_owner_payout_totals($1)`, [input.userId]);
  return new Map(
    rows.map((r) => [
      r.campaign_id,
      {
        depositedCents: Number(r.deposited_cents),
        heldCents: Number(r.held_cents),
        releasedCents: Number(r.released_cents),
        paidCents: Number(r.paid_cents),
        forfeitedCents: Number(r.forfeited_cents),
      },
    ]),
  );
}
