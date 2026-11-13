// Ticket 5 — contacts and the contacts feed engine (BRD v1.6 FR-02, FR-05,
// FR-16–FR-18, P1, P4, P6, LEG-01). Server-only. Takes an Sql argument so tests
// run it on PGlite. The atomic rules and THE visibility rule live in migration
// 0007 (trufolks_contact_reviews). Order is always newest first: no follower
// counts or other ranking signals (FR-05, P6).
import type { Sql } from "../db.ts";
import { parseDisclosure } from "../reviews/disclosure.ts";
import type { ReviewView } from "../reviews/engine.ts";
import type { ContactLimits } from "./limits.ts";
import type { ContactOutcome } from "./messages.ts";
import { hashInviteToken, isInviteTokenShape, newInviteToken } from "./invite-token.ts";

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A review shown to a contact, with who wrote it (for the FR-17 history link). */
export interface ContactReview extends ReviewView {
  authorId: string;
}

type ContactReviewRow = {
  review_id: string;
  author_id: string;
  reviewer_name: string;
  merchant_id: string | null;
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

function toView(r: ContactReviewRow): ContactReview {
  return {
    reviewId: r.review_id,
    authorId: r.author_id,
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

/** Second lock on LEG-01 / gap 19: never hand a contact a review whose disclosure isn't complete. */
function showableToContacts(v: ContactReview): boolean {
  return v.verifiedPurchase && v.disclosure !== null && v.disclosure.complete;
}

// ------------------------------------------------------------------ feed cursor

export function encodeFeedCursor(createdAt: string, reviewId: string): string {
  return `${createdAt}~${reviewId}`;
}

export function parseFeedCursor(raw: unknown): { createdAt: string; reviewId: string } | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const at = raw.indexOf("~");
  if (at <= 0) return null;
  const createdAt = iso(raw.slice(0, at));
  const reviewId = raw.slice(at + 1);
  if (!createdAt || !reviewId) return null;
  return { createdAt, reviewId };
}

// ------------------------------------------------------------------ invite links

export interface InviteState {
  createdAt: string;
  expiresAt: string;
}

/** The person's working invite link, if any (dates only — the raw link is never stored). */
export async function getInviteState(sql: Sql, input: { userId: string }): Promise<InviteState | null> {
  const rows = await sql.query<{ created_at: unknown; expires_at: unknown }>(
    `select created_at, expires_at from contact_invites
      where user_id = $1 and revoked_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [input.userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { createdAt: iso(r.created_at) ?? "", expiresAt: iso(r.expires_at) ?? "" };
}

/** Make a new invite link; the old one stops working. Returns the raw token once. */
export async function createInvite(
  sql: Sql,
  input: { userId: string; limits: ContactLimits; token?: string },
): Promise<{ outcome: "ok"; token: string; expiresAt: string } | { outcome: "not_found" | "unavailable" }> {
  if (!input.userId) return { outcome: "not_found" };
  const token = input.token ?? newInviteToken();
  const rows = await sql.query<{ r_outcome: string; r_expires_at: unknown }>(
    `select * from trufolks_create_contact_invite($1, $2, $3)`,
    [input.userId, hashInviteToken(token), input.limits.inviteLifetimeSeconds],
  );
  const r = rows[0];
  if (!r) return { outcome: "unavailable" };
  if (r.r_outcome !== "ok") return { outcome: "not_found" };
  return { outcome: "ok", token, expiresAt: iso(r.r_expires_at) ?? "" };
}

/** Turn the person's invite link off. */
export async function revokeInvite(sql: Sql, input: { userId: string }): Promise<"ok" | "not_found"> {
  const rows = await sql.query<{ r: string }>(`select trufolks_revoke_contact_invite($1) as r`, [input.userId]);
  return rows[0]?.r === "ok" ? "ok" : "not_found";
}

export type InviteLookup =
  | { outcome: "ok" | "already_contacts" | "you_blocked" | "own_invite"; inviterName: string }
  | { outcome: "not_found" };

/** What an invite link would do for this signed-in person. Changes nothing. */
export async function lookupInvite(sql: Sql, input: { token: unknown; userId: string }): Promise<InviteLookup> {
  if (!isInviteTokenShape(input.token) || !input.userId) return { outcome: "not_found" };
  const rows = await sql.query<{ r_outcome: string; r_inviter_name: string | null }>(
    `select * from trufolks_contact_invite_status($1, $2)`,
    [hashInviteToken(input.token), input.userId],
  );
  const r = rows[0];
  if (!r || r.r_outcome === "not_found" || !r.r_inviter_name) return { outcome: "not_found" };
  const outcome = r.r_outcome as "ok" | "already_contacts" | "you_blocked" | "own_invite";
  return { outcome, inviterName: r.r_inviter_name };
}

/** Accept an invite: both people become contacts of each other. */
export async function acceptInvite(
  sql: Sql,
  input: { token: unknown; userId: string },
): Promise<{ outcome: Exclude<ContactOutcome, "not_contact" | "unavailable">; inviterId: string | null }> {
  if (!isInviteTokenShape(input.token) || !input.userId) return { outcome: "not_found", inviterId: null };
  const rows = await sql.query<{ r_outcome: string; r_inviter_id: string | null }>(
    `select * from trufolks_accept_contact_invite($1, $2)`,
    [hashInviteToken(input.token), input.userId],
  );
  const r = rows[0];
  const known = ["ok", "not_found", "own_invite", "you_blocked", "already_contacts"] as const;
  const outcome = known.find((k) => k === r?.r_outcome) ?? "not_found";
  return { outcome, inviterId: outcome === "not_found" ? null : (r?.r_inviter_id ?? null) };
}

// ------------------------------------------------------------------ contact list

export interface ContactPerson {
  userId: string;
  name: string;
}

export interface ContactList {
  contacts: (ContactPerson & { since: string })[];
  blocked: ContactPerson[];
}

/** The person's contacts (alphabetical — not a ranking) and the people they blocked. */
export async function listContacts(sql: Sql, input: { userId: string }): Promise<ContactList> {
  const contacts = await sql.query<{ contact_id: string; display_name: string; since: unknown }>(
    `select * from trufolks_mutual_contacts($1) order by lower(display_name), contact_id`,
    [input.userId],
  );
  const blocked = await sql.query<{ id: string; display_name: string }>(
    `select u.id, u.display_name from contacts c join users u on u.id = c.contact_user_id
      where c.owner_user_id = $1 and c.status = 'blocked'
      order by lower(u.display_name), u.id`,
    [input.userId],
  );
  return {
    contacts: contacts.map((c) => ({ userId: c.contact_id, name: c.display_name, since: iso(c.since) ?? "" })),
    blocked: blocked.map((b) => ({ userId: b.id, name: b.display_name })),
  };
}

export type ContactAction = "remove" | "block" | "unblock";

/** Remove, block or unblock someone. Only acts on the person's own rows. */
export async function changeContact(
  sql: Sql,
  input: { userId: string; otherId: string; action: ContactAction },
): Promise<"ok" | "not_found"> {
  if (!input.userId || !input.otherId || input.userId === input.otherId) return "not_found";
  const fn = { remove: "trufolks_remove_contact", block: "trufolks_block_contact", unblock: "trufolks_unblock_contact" }[
    input.action
  ];
  const rows = await sql.query<{ r: string }>(`select ${fn}($1, $2) as r`, [input.userId, input.otherId]);
  return rows[0]?.r === "ok" ? "ok" : "not_found";
}

// ------------------------------------------------------------------ feed (FR-16) and places (FR-18)

export interface FeedPage {
  reviews: ContactReview[];
  nextCursor: string | null;
}

/** Contacts' reviews, newest first. Optionally only one business (from the places list). */
export async function contactFeed(
  sql: Sql,
  input: { viewerId: string; before?: string | null; merchantId?: string | null; limits: ContactLimits },
): Promise<FeedPage> {
  const cursor = input.before ? parseFeedCursor(input.before) : null;
  const size = input.limits.feedPageSize;
  const rows = await sql.query<ContactReviewRow>(
    `select * from trufolks_contact_reviews($1)
      where ($2::text is null or merchant_id = $2)
        and ($3::timestamptz is null or (created_at, review_id) < ($3::timestamptz, $4::text))
      order by created_at desc, review_id desc
      limit $5`,
    [input.viewerId, input.merchantId ?? null, cursor?.createdAt ?? null, cursor?.reviewId ?? "", size + 1],
  );
  const page = rows.slice(0, size).map(toView);
  const last = rows.length > size ? rows[size - 1] : undefined;
  return {
    reviews: page.filter(showableToContacts),
    nextCursor: last ? encodeFeedCursor(iso(last.created_at) ?? "", last.review_id) : null,
  };
}

export interface ContactPlace {
  merchantId: string;
  merchantName: string;
  reviewCount: number;
  contactCount: number;
  latestAt: string;
}

/** Businesses the person's contacts reviewed, most recently reviewed first (FR-18). */
export async function contactPlaces(sql: Sql, input: { viewerId: string }): Promise<ContactPlace[]> {
  const rows = await sql.query<{
    merchant_id: string;
    merchant_name: string;
    review_count: number | string;
    contact_count: number | string;
    latest_at: unknown;
  }>(
    `select merchant_id, max(merchant_name) as merchant_name, count(*) as review_count,
            count(distinct author_id) as contact_count, max(created_at) as latest_at
       from trufolks_contact_reviews($1)
      where merchant_id is not null
      group by merchant_id
      order by max(created_at) desc, merchant_id
      limit 100`,
    [input.viewerId],
  );
  return rows.map((r) => ({
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    reviewCount: Number(r.review_count),
    contactCount: Number(r.contact_count),
    latestAt: iso(r.latest_at) ?? "",
  }));
}

// ------------------------------------------------------------------ one person's history (FR-17)

export interface HistoryReview extends ContactReview {
  /** False only on your own page, for a review contacts can't see yet (gap 19). */
  shownToContacts: boolean;
}

export interface PersonHistory {
  person: { userId: string; name: string; isSelf: boolean };
  reviews: HistoryReview[];
  /** How many of the shown reviews gave 1..5 stars (index 0 = 1 star). All ratings, so a pattern stands out (HON-08). */
  ratingCounts: [number, number, number, number, number];
}

/** A person's full review history: your own, or a contact's. Nobody else's. */
export async function personHistory(
  sql: Sql,
  input: { viewerId: string; personId: string; limits: ContactLimits },
): Promise<{ outcome: "ok"; history: PersonHistory } | { outcome: "not_contact" }> {
  if (!input.viewerId || !input.personId) return { outcome: "not_contact" };
  const isSelf = input.viewerId === input.personId;
  let name: string | undefined;
  let rows: ContactReviewRow[];

  if (isSelf) {
    const me = await sql.query<{ display_name: string }>(
      `select display_name from users where id = $1 and deleted_at is null`,
      [input.viewerId],
    );
    name = me[0]?.display_name;
    rows = await sql.query<ContactReviewRow>(
      `select r.id as review_id, r.user_id as author_id, u.display_name as reviewer_name, m.id as merchant_id,
              coalesce(m.name, to_jsonb(vp) ->> 'store_name', '') as merchant_name, vp.product_label, r.rating, r.what_used, r.how_long, r.honest_thought,
              vp.verification_status, r.disclosure, r.created_at
         from reviews r
         join users u on u.id = r.user_id
         join verified_purchases vp on vp.id = r.verified_purchase_id
         left join merchants m on m.id = vp.merchant_id
        where r.user_id = $1
        order by r.created_at desc, r.id desc
        limit $2`,
      [input.viewerId, input.limits.historyMax],
    );
  } else {
    const contact = await sql.query<{ display_name: string }>(
      `select display_name from trufolks_mutual_contacts($1) where contact_id = $2`,
      [input.viewerId, input.personId],
    );
    name = contact[0]?.display_name;
    rows = name
      ? await sql.query<ContactReviewRow>(
          `select * from trufolks_contact_reviews($1) where author_id = $2
            order by created_at desc, review_id desc limit $3`,
          [input.viewerId, input.personId, input.limits.historyMax],
        )
      : [];
  }
  if (!name) return { outcome: "not_contact" };

  const reviews: HistoryReview[] = [];
  for (const row of rows) {
    const v = toView(row);
    const shown = showableToContacts(v);
    if (!isSelf && !shown) continue;
    reviews.push({ ...v, shownToContacts: shown });
  }
  const ratingCounts: PersonHistory["ratingCounts"] = [0, 0, 0, 0, 0];
  for (const r of reviews) if (r.rating >= 1 && r.rating <= 5) ratingCounts[r.rating - 1] += 1;
  return { outcome: "ok", history: { person: { userId: input.personId, name, isSelf }, reviews, ratingCounts } };
}
