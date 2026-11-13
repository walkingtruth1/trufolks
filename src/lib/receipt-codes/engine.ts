// Ticket 3a — receipt code engine (BRD v1.6 FR-06–FR-10, FR-08a, HON-04,
// HON-05, HON-07, MER-02, MER-07, NFR-05, NFR-06). Server-only.
//
// Takes an Sql client as an argument (does not import db.ts) so tests can run
// it on a throwaway PGlite. The atomic rules live in the 0004 migration's
// functions; this file validates input, hashes, and maps results.
// No money logic: a claim creates a PENDING purchase only (Ticket 8 pays).
import type { Sql } from "../db.ts";
import { formatCode, generateCode, hashCode, hashDeviceToken, generateDeviceToken, isDeviceTokenShape, normalizeCode, type HashKeys } from "./codes.ts";
import type { ReceiptCodeLimits } from "./limits.ts";
import type { CodeOutcome, GenerateOutcome } from "./messages.ts";

export type IssueMode = "till_single_purchase" | "handout_batch";

// ---------------------------------------------------------------- devices

/** Look up a device by its raw token. Revoked or unknown → null. */
export async function findDevice(sql: Sql, rawToken: string | undefined | null): Promise<string | null> {
  if (!isDeviceTokenShape(rawToken)) return null;
  const rows = await sql.query<{ id: string }>(
    `update devices set last_seen_at = now()
      where token_hash = $1 and revoked_at is null
      returning id`,
    [hashDeviceToken(rawToken)],
  );
  return rows[0]?.id ?? null;
}

export type EnsureDeviceResult =
  | { ok: true; deviceId: string; newRawToken: string | null }
  | { ok: false; outcome: "rate_limited" };

/**
 * Reuse the caller's device, or create one (HON-07). Creating devices is rate
 * limited per network address, so clearing cookies does not give unlimited
 * fresh devices.
 */
export async function ensureDevice(
  sql: Sql,
  input: { rawToken: string | undefined | null; ipHash: string; limits: ReceiptCodeLimits },
): Promise<EnsureDeviceResult> {
  const existing = await findDevice(sql, input.rawToken);
  if (existing) return { ok: true, deviceId: existing, newRawToken: null };

  const token = generateDeviceToken();
  const rows = await sql.query<{ id: string | null }>(
    `select trufolks_create_device($1, $2, $3, $4) as id`,
    [hashDeviceToken(token), input.ipHash, input.limits.newDeviceWindowSeconds, input.limits.maxNewDevicesPerIp],
  );
  const deviceId = rows[0]?.id;
  if (!deviceId) return { ok: false, outcome: "rate_limited" };
  return { ok: true, deviceId, newRawToken: token };
}

// ---------------------------------------------------------------- generation

export type GenerateResult =
  | { outcome: "ok"; codes: string[] }
  | { outcome: Exclude<GenerateOutcome, "ok"> };

/**
 * A merchant owner makes a batch of codes for one of their campaigns (FR-06).
 * Refused unless the business is verified and has accepted the reward rules
 * (MER-02) and the mixed-ratings walkthrough (MER-07). Returns the raw codes —
 * the only time they exist; only their hashes are stored.
 */
export async function generateCodes(
  sql: Sql,
  input: {
    userId: string;
    campaignId: string;
    count: number;
    issueMode: IssueMode;
    keys: HashKeys;
    limits: ReceiptCodeLimits;
  },
): Promise<GenerateResult> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > input.limits.maxCodesPerBatch) {
    return { outcome: "bad_count" };
  }
  const rows = await sql.query<{
    status: string;
    ended: boolean;
    owner_user_id: string;
    verification_status: string;
    terms_accepted_at: unknown;
    walkthrough_accepted_at: unknown;
  }>(
    `select c.status, (c.ends_at <= now()) as ended, m.owner_user_id, m.verification_status,
            m.terms_accepted_at, m.walkthrough_accepted_at
       from campaigns c join merchants m on m.id = c.merchant_id
      where c.id = $1`,
    [input.campaignId],
  );
  const c = rows[0];
  // Someone else's campaign looks the same as a missing one.
  if (!c || c.owner_user_id !== input.userId) return { outcome: "campaign_not_found" };
  if (c.verification_status !== "verified") return { outcome: "merchant_not_verified" };
  if (!c.terms_accepted_at) return { outcome: "terms_not_accepted" };
  if (!c.walkthrough_accepted_at) return { outcome: "walkthrough_not_accepted" };
  if (c.status === "ended" || c.ended) return { outcome: "campaign_ended" };
  if (c.status === "suspended") return { outcome: "campaign_not_live" };

  const codes = Array.from({ length: input.count }, () => generateCode());
  const hashes = codes.map((code) => hashCode(code, input.keys));
  await sql.query(
    `with c as (select id, merchant_id, ends_at from campaigns where id = $1),
     ins as (
       insert into receipt_codes
         (campaign_id, merchant_id, code_hash, issue_mode, max_uses, expires_at, issued_by_user_id)
       select c.id, c.merchant_id, h, $3, $4,
              least(c.ends_at, now() + make_interval(secs => $5)), $6
         from c, unnest($2::text[]) as h
       returning id, campaign_id
     )
     insert into receipt_code_events (kind, outcome, code_id, campaign_id, user_id, detail)
     select 'issued', 'ok', id, campaign_id, $6, jsonb_build_object('issue_mode', $3::text) from ins`,
    [input.campaignId, hashes, input.issueMode, input.limits.maxUsesPerCode, input.limits.codeLifetimeSeconds, input.userId],
  );
  return { outcome: "ok", codes: codes.map(formatCode) };
}

// ---------------------------------------------------------------- scan

export type ScanResult =
  | { outcome: "ok"; campaignId: string; campaignName: string; merchantName: string; campaignEndsAt: string }
  | { outcome: Exclude<CodeOutcome, "ok"> };

/** Scan a code (FR-07, FR-08). Binds it to this device on the first valid scan (HON-07). */
export async function scanCode(
  sql: Sql,
  input: { rawCode: string; deviceId: string; ipHash: string; keys: HashKeys; limits: ReceiptCodeLimits },
): Promise<ScanResult> {
  const code = normalizeCode(input.rawCode);
  const rows = await sql.query<{ r_outcome: CodeOutcome; r_campaign_id: string | null }>(
    `select * from trufolks_scan_receipt_code($1, $2, $3, $4, $5, $6)`,
    [
      code ? hashCode(code, input.keys) : null,
      input.deviceId,
      input.ipHash,
      input.limits.failureWindowSeconds,
      input.limits.maxFailuresPerDevice,
      input.limits.maxFailuresPerIp,
    ],
  );
  const outcome = rows[0]?.r_outcome ?? "unavailable";
  if (outcome !== "ok" || !rows[0]?.r_campaign_id) {
    return { outcome: outcome === "ok" ? "unavailable" : outcome };
  }
  const info = await sql.query<{ campaign_name: string; merchant_name: string; ends_at: Date | string }>(
    `select c.name as campaign_name, m.name as merchant_name, c.ends_at
       from campaigns c join merchants m on m.id = c.merchant_id where c.id = $1`,
    [rows[0].r_campaign_id],
  );
  const i = info[0];
  return {
    outcome: "ok",
    campaignId: rows[0].r_campaign_id,
    campaignName: i.campaign_name,
    merchantName: i.merchant_name,
    campaignEndsAt: new Date(i.ends_at).toISOString(),
  };
}

// ---------------------------------------------------------------- claim

export interface PurchaseDetails {
  productLabel: string;
  orderValueCents: number;
  currency: string;
  purchasedAt: string; // ISO timestamp
}

export type ClaimResult =
  | { outcome: "ok"; purchaseId: string; userClaimsInCampaign: number }
  | { outcome: Exclude<CodeOutcome, "ok"> };

/** Check the typed purchase details before touching the database. */
export function validPurchaseDetails(d: PurchaseDetails): boolean {
  return (
    typeof d.productLabel === "string" &&
    d.productLabel.trim().length > 0 &&
    d.productLabel.length <= 200 &&
    Number.isInteger(d.orderValueCents) &&
    d.orderValueCents >= 0 &&
    d.orderValueCents <= 100_000_000 &&
    typeof d.currency === "string" &&
    /^[A-Z]{3}$/.test(d.currency) &&
    typeof d.purchasedAt === "string" &&
    !Number.isNaN(Date.parse(d.purchasedAt))
  );
}

/**
 * Claim a code for a purchase (FR-08, HON-04, HON-05, HON-07). Needs the same
 * device the code is bound to and a signed-in person. Creates a PENDING
 * verified purchase; a handout code still needs the receipt photo check
 * (Ticket 3b) before it can be verified (FR-08a). The order value is typed by
 * the person and is unverified until then.
 */
export async function claimCode(
  sql: Sql,
  input: {
    rawCode: string;
    deviceId: string | null;
    userId: string;
    ipHash: string;
    details: PurchaseDetails;
    keys: HashKeys;
    limits: ReceiptCodeLimits;
  },
): Promise<ClaimResult> {
  if (!input.deviceId) return { outcome: "device_missing" };
  if (!validPurchaseDetails(input.details)) return { outcome: "invalid_details" };
  const code = normalizeCode(input.rawCode);
  type ClaimRow = { r_outcome: CodeOutcome; r_purchase_id: string | null; r_user_claims_in_campaign: number | null };
  let rows: ClaimRow[];
  try {
    rows = await sql.query<ClaimRow>(
      `select * from trufolks_claim_receipt_code($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11, $12)`,
      [
        code ? hashCode(code, input.keys) : null,
        input.deviceId,
        input.userId,
        input.ipHash,
        input.details.productLabel.trim(),
        input.details.orderValueCents,
        input.details.currency,
        input.details.purchasedAt,
        input.limits.purchaseClockSkewSeconds,
        input.limits.failureWindowSeconds,
        input.limits.maxFailuresPerDevice,
        input.limits.maxFailuresPerIp,
      ],
    );
  } catch (err) {
    // Ticket 7: the offer-cap backstop (migration 0009) refuses a racing claim.
    if (err instanceof Error && err.message.includes("TRUFOLKS_CAMPAIGN_FULL")) return { outcome: "campaign_full" };
    throw err;
  }
  const r = rows[0];
  if (!r) return { outcome: "unavailable" };
  if (r.r_outcome !== "ok") return { outcome: r.r_outcome };
  if (!r.r_purchase_id) return { outcome: "unavailable" };
  return { outcome: "ok", purchaseId: r.r_purchase_id, userClaimsInCampaign: r.r_user_claims_in_campaign ?? 1 };
}

// ---------------------------------------------------------------- suspend

/**
 * Switch a code off, with a reason, and log it (FR-25). No server function
 * yet: admin roles come later. Returns false if already suspended / missing.
 */
export async function suspendCode(
  sql: Sql,
  input: { codeId: string; reason: string; actorUserId: string },
): Promise<boolean> {
  const reason = input.reason.trim();
  if (!reason) return false;
  const rows = await sql.query<{ code_id: string }>(
    `with s as (
       update receipt_codes
          set status = 'suspended', suspended_at = now(), suspended_reason = $2
        where id = $1 and status <> 'suspended'
        returning id, campaign_id
     )
     insert into receipt_code_events (kind, outcome, code_id, campaign_id, user_id, detail)
     select 'suspend', 'ok', id, campaign_id, $3, jsonb_build_object('reason', $2::text) from s
     returning code_id`,
    [input.codeId, reason, input.actorUserId],
  );
  return rows.length === 1;
}
