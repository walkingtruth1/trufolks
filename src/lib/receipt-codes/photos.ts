// Ticket 3b-1 — receipt photo check and human verification (BRD v1.6 FR-08a,
// FR-09, HON-04, RES-01, AI-06, NFR-04, NFR-05, §20C). Server-only.
//
// Takes an Sql client as an argument (like engine.ts) so tests can run it on
// PGlite. Atomic rules live in the 0005 migration's functions. Automatic
// checks only FLAG for the admin; a person approves or turns down every
// purchase. No reward or payout logic here (Ticket 8).
import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";
import { hashCode, normalizeCode, type HashKeys } from "./codes.ts";
import { readExifTakenAt, sniffImageType } from "./exif.ts";
import type { ReceiptPhotoLimits } from "./limits.ts";
import type { DecideOutcome, PhotoOutcome } from "./messages.ts";

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------- the person's side

export type MyClaimResult =
  | { outcome: "ok"; purchaseId: string; status: "pending" | "verified" | "rejected"; hasPhoto: boolean }
  | { outcome: "not_found" };

/** The signed-in person's own claim on this code, if any (lets the page offer the photo step again). */
export async function findMyClaim(
  sql: Sql,
  input: { rawCode: string; userId: string; keys: HashKeys },
): Promise<MyClaimResult> {
  const code = normalizeCode(input.rawCode);
  if (!code) return { outcome: "not_found" };
  const rows = await sql.query<{ id: string; verification_status: "pending" | "verified" | "rejected"; has_photo: boolean }>(
    `select vp.id, vp.verification_status,
            exists (select 1 from receipt_photos rp where rp.verified_purchase_id = vp.id and rp.photo is not null) as has_photo
       from receipt_codes rc
       join verified_purchases vp on vp.receipt_code_id = rc.id
      where rc.code_hash = $1 and rc.claimed_by_user_id = $2 and vp.user_id = $2`,
    [hashCode(code, input.keys), input.userId],
  );
  const r = rows[0];
  return r ? { outcome: "ok", purchaseId: r.id, status: r.verification_status, hasPhoto: r.has_photo } : { outcome: "not_found" };
}

/**
 * Store the receipt photo for the person's own pending purchase. The type is
 * read from the bytes, not the browser. The "photo taken" time is read from
 * the original file's header slice when sent (the compressed photo has none).
 */
export async function storePhoto(
  sql: Sql,
  input: {
    purchaseId: string;
    userId: string;
    photo: Uint8Array;
    header: Uint8Array | null;
    limits: ReceiptPhotoLimits;
  },
): Promise<{ outcome: PhotoOutcome }> {
  if (!input.purchaseId || input.photo.length === 0) return { outcome: "bad_photo" };
  if (input.photo.length > input.limits.maxPhotoBytes) return { outcome: "too_big" };
  const mimeType = sniffImageType(input.photo);
  if (!mimeType) return { outcome: "bad_photo" };
  const header = input.header && input.header.length > 0
    ? input.header.subarray(0, input.limits.maxHeaderBytes)
    : null;
  const exif = readExifTakenAt(header ?? input.photo);
  const sha256 = createHash("sha256").update(input.photo).digest("hex");
  const rows = await sql.query<{ r_outcome: PhotoOutcome }>(
    `select * from trufolks_store_receipt_photo($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
    [
      input.purchaseId,
      input.userId,
      mimeType,
      Buffer.from(input.photo),
      sha256,
      exif ? exif.takenAt.toISOString() : null,
      exif ? exif.hasOffset : false,
      input.limits.retentionSeconds,
    ],
  );
  return { outcome: rows[0]?.r_outcome ?? "unavailable" };
}

// ---------------------------------------------------------------- automatic checks (flags only)

export interface CheckInput {
  hasPhoto: boolean;
  exifTakenAt: string | null;
  exifHasOffset: boolean;
  campaignStartsAt: string | null;
  campaignEndsAt: string | null;
  purchasedAt: string;
  claimsInCampaign: number;
  issueMode: string | null;
}

export interface Check {
  code: string;
  label: string;
}

/**
 * Flags for the person reviewing. They never approve or reject anything on
 * their own (RES-01 f, AI-06). Plain words, for the admin page.
 */
export function computeChecks(input: CheckInput, slackSeconds: number): Check[] {
  const flags: Check[] = [];
  const slack = slackSeconds * 1000;
  if (!input.hasPhoto) flags.push({ code: "no_photo", label: "No receipt photo yet." });
  if (input.issueMode === "handout_batch") {
    flags.push({ code: "handout_code", label: "Handout code: check the receipt itself, not just the code." });
  }
  if (input.hasPhoto && !input.exifTakenAt) {
    flags.push({ code: "no_photo_time", label: "The photo has no 'taken at' time. Check the date printed on the receipt." });
  }
  if (input.exifTakenAt) {
    const taken = Date.parse(input.exifTakenAt);
    if (!input.exifHasOffset) {
      flags.push({ code: "photo_time_zone_unknown", label: "The photo's time has no time zone, so it may be off by some hours." });
    }
    const starts = input.campaignStartsAt ? Date.parse(input.campaignStartsAt) : null;
    const ends = input.campaignEndsAt ? Date.parse(input.campaignEndsAt) : null;
    if ((starts !== null && taken < starts - slack) || (ends !== null && taken > ends + slack)) {
      flags.push({ code: "photo_outside_campaign", label: "The photo was taken outside this offer's dates." });
    }
    if (Math.abs(taken - Date.parse(input.purchasedAt)) > slack) {
      flags.push({ code: "photo_time_differs", label: "The photo time is far from the purchase time the person typed." });
    }
  }
  if (input.claimsInCampaign > 1) {
    flags.push({
      code: "several_claims",
      label: `This person has claimed ${input.claimsInCampaign} codes in this offer.`,
    });
  }
  return flags;
}

// ---------------------------------------------------------------- admin side

export interface PendingPurchase {
  purchaseId: string;
  merchantName: string;
  campaignName: string | null;
  productLabel: string;
  typedOrderValueCents: number;
  currency: string;
  purchasedAt: string;
  claimedAt: string | null;
  hasPhoto: boolean;
  photoUploadedAt: string | null;
  exifTakenAt: string | null;
  checks: Check[];
}

const PENDING_SQL = `
  select vp.id as purchase_id, vp.product_label, vp.order_value_cents, vp.currency, vp.purchased_at,
         c.name as campaign_name, c.starts_at, c.ends_at, m.name as merchant_name,
         rc.issue_mode, rc.claimed_at,
         (rp.photo is not null) as has_photo, rp.uploaded_at, rp.exif_taken_at, rp.exif_has_offset,
         (select count(*)::int from receipt_codes x
           where x.campaign_id = vp.campaign_id and x.claimed_by_user_id = vp.user_id) as claims_in_campaign
    from verified_purchases vp
    join merchants m on m.id = vp.merchant_id
    left join campaigns c on c.id = vp.campaign_id
    left join receipt_codes rc on rc.id = vp.receipt_code_id
    left join receipt_photos rp on rp.verified_purchase_id = vp.id
   where vp.verification_status = 'pending'`;

type PendingRow = {
  purchase_id: string;
  product_label: string;
  order_value_cents: number;
  currency: string;
  purchased_at: unknown;
  campaign_name: string | null;
  starts_at: unknown;
  ends_at: unknown;
  merchant_name: string;
  issue_mode: string | null;
  claimed_at: unknown;
  has_photo: boolean | null;
  uploaded_at: unknown;
  exif_taken_at: unknown;
  exif_has_offset: boolean | null;
  claims_in_campaign: number;
};

function toPending(r: PendingRow, slackSeconds: number): PendingPurchase {
  const purchasedAt = iso(r.purchased_at) ?? new Date(0).toISOString();
  const exifTakenAt = iso(r.exif_taken_at);
  const hasPhoto = Boolean(r.has_photo);
  return {
    purchaseId: r.purchase_id,
    merchantName: r.merchant_name,
    campaignName: r.campaign_name,
    productLabel: r.product_label,
    typedOrderValueCents: r.order_value_cents,
    currency: r.currency,
    purchasedAt,
    claimedAt: iso(r.claimed_at),
    hasPhoto,
    photoUploadedAt: iso(r.uploaded_at),
    exifTakenAt,
    checks: computeChecks(
      {
        hasPhoto,
        exifTakenAt,
        exifHasOffset: Boolean(r.exif_has_offset),
        campaignStartsAt: iso(r.starts_at),
        campaignEndsAt: iso(r.ends_at),
        purchasedAt,
        claimsInCampaign: r.claims_in_campaign,
        issueMode: r.issue_mode,
      },
      slackSeconds,
    ),
  };
}

/** Delete photo bytes past their retention date. Returns how many were deleted. */
export async function purgeExpiredPhotos(sql: Sql): Promise<number> {
  const rows = await sql.query<{ n: number }>(`select trufolks_purge_receipt_photos() as n`);
  return rows[0]?.n ?? 0;
}

/** Pending purchases, oldest first, with their flags. Deletes expired photos first. */
export async function listPendingPurchases(
  sql: Sql,
  input: { limits: ReceiptPhotoLimits; max?: number },
): Promise<PendingPurchase[]> {
  await purgeExpiredPhotos(sql);
  const rows = await sql.query<PendingRow>(`${PENDING_SQL} order by vp.created_at, vp.id limit $1`, [input.max ?? 200]);
  return rows.map((r) => toPending(r, input.limits.exifSlackSeconds));
}

/** The stored photo of a purchase, for the admin page. Null if none / deleted. */
export async function getPhoto(sql: Sql, purchaseId: string): Promise<{ mimeType: string; bytes: Uint8Array } | null> {
  const rows = await sql.query<{ mime_type: string; photo: Uint8Array | null }>(
    `select mime_type, photo from receipt_photos where verified_purchase_id = $1`,
    [purchaseId],
  );
  const r = rows[0];
  return r?.photo ? { mimeType: r.mime_type, bytes: new Uint8Array(r.photo) } : null;
}

/**
 * A person on the admin allowlist approves or turns down a pending purchase.
 * The caller must have checked the allowlist. The flags are recomputed here
 * from the database (not taken from the browser) and saved with the decision.
 */
export async function decidePurchase(
  sql: Sql,
  input: {
    purchaseId: string;
    adminUserId: string;
    decision: "verified" | "rejected";
    reason: string;
    confirmedOrderValueCents: number | null;
    limits: ReceiptPhotoLimits;
  },
): Promise<{ outcome: DecideOutcome }> {
  if (input.decision !== "verified" && input.decision !== "rejected") return { outcome: "bad_decision" };
  const cents = input.confirmedOrderValueCents;
  if (input.decision === "verified" && (cents === null || !Number.isInteger(cents) || cents < 0 || cents > 100_000_000)) {
    return { outcome: "bad_value" };
  }
  const current = await sql.query<PendingRow>(`${PENDING_SQL} and vp.id = $1`, [input.purchaseId]);
  const checks = current[0] ? toPending(current[0], input.limits.exifSlackSeconds).checks : [];
  const rows = await sql.query<{ r_outcome: DecideOutcome }>(
    `select * from trufolks_decide_purchase($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.purchaseId,
      input.adminUserId,
      input.decision,
      input.reason.slice(0, 500),
      input.decision === "verified" ? cents : null,
      JSON.stringify(checks),
    ],
  );
  return { outcome: rows[0]?.r_outcome ?? "unavailable" };
}
