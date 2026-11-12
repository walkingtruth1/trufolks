// Ticket 3b-2 — local test data for the manual run-through. DEV ONLY.
//
// There is no merchant screen yet (Ticket 6), so this makes one test business,
// one live offer and a few handout receipt codes on a developer's computer.
// It runs inside the dev server because local data lives only in that
// process's memory. Refused unless NODE_ENV is "development" or "test".
// The owner is a placeholder login with no password (it can't sign in), so
// the person testing is never the owner and can claim codes (HON-05).
// Server-only. Takes an Sql argument so tests run it on PGlite.
import type { Sql } from "../db.ts";
import { generateCodes } from "../receipt-codes/engine.ts";
import { qrPath, type HashKeys } from "../receipt-codes/codes.ts";
import type { ReceiptCodeLimits } from "../receipt-codes/limits.ts";

export { devOnlyEnv as devSeedAllowed } from "../receipt-codes/admin.ts";

/** Fixed names for the test data. Test fixtures only, not business settings. */
export const DEV_SEED = Object.freeze({
  ownerUserId: "dev-merchant-owner",
  ownerEmail: "dev-merchant-owner@trufolks.invalid",
  ownerName: "Test Cafe owner",
  merchantId: "dev-test-cafe",
  merchantName: "Test Cafe",
  campaignId: "dev-test-offer",
  campaignName: "Test offer",
  campaignType: "A",
  campaignDays: 14,
  codeCount: 3,
});

export interface DevSeedResult {
  merchantName: string;
  campaignName: string;
  codes: { printed: string; path: string }[];
}

/** Make (or reuse) the test business and offer, then make fresh codes. Safe to run again. */
export async function seedDevData(sql: Sql, input: { keys: HashKeys; limits: ReceiptCodeLimits }): Promise<DevSeedResult> {
  const s = DEV_SEED;
  // The sign-up trigger (0003) creates the matching users row.
  await sql.query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     values ($1, $2, $3, false, now(), now())
     on conflict ("id") do nothing`,
    [s.ownerUserId, s.ownerName, s.ownerEmail],
  );
  await sql.query(
    `insert into merchants (id, owner_user_id, name, verification_status, terms_accepted_at, walkthrough_accepted_at)
     values ($1, $2, $3, 'verified', now(), now())
     on conflict (id) do nothing`,
    [s.merchantId, s.ownerUserId, s.merchantName],
  );
  await sql.query(
    `insert into campaigns (id, merchant_id, name, campaign_type, starts_at, ends_at, status)
     values ($1, $2, $3, $4, now() - interval '1 day', now() + make_interval(days => $5::int), 'live')
     on conflict (id) do update
       set status = 'live',
           ends_at = greatest(campaigns.ends_at, excluded.ends_at),
           updated_at = now()`,
    [s.campaignId, s.merchantId, s.campaignName, s.campaignType, s.campaignDays],
  );
  const r = await generateCodes(sql, {
    userId: s.ownerUserId,
    campaignId: s.campaignId,
    count: s.codeCount,
    issueMode: "handout_batch",
    keys: input.keys,
    limits: input.limits,
  });
  if (r.outcome !== "ok") throw new Error(`dev seed: could not make codes (${r.outcome})`);
  const codes = (r as { codes: string[] }).codes;
  return {
    merchantName: s.merchantName,
    campaignName: s.campaignName,
    codes: codes.map((printed) => ({ printed, path: qrPath(printed) })),
  };
}
