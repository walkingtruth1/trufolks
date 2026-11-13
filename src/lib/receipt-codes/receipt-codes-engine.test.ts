// Ticket 3a — receipt code engine against a throwaway in-memory PGlite with
// the real 0002 + 0004 migrations applied (0003 needs Better Auth's table and
// 0004 does not touch auth). No network, no real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { deriveHashKeys, formatCode, generateCode, hashCode, hashIp, normalizeCode } from "./codes.ts";
import { claimCode, ensureDevice, findDevice, generateCodes, scanCode, suspendCode, type PurchaseDetails } from "./engine.ts";
import { RECEIPT_CODE_LIMITS, type ReceiptCodeLimits } from "./limits.ts";

const keys = deriveHashKeys("test-secret-not-real-0123456789abcdef");
// Small limits so rate limits are quick to hit in tests.
const limits: ReceiptCodeLimits = {
  ...RECEIPT_CODE_LIMITS,
  maxFailuresPerDevice: 3,
  maxFailuresPerIp: 6,
  maxNewDevicesPerIp: 4,
};

let db: PGlite;
let sql: Sql;
let ipSeq = 0;

/** A fresh network address per test, so rate limits from one test don't leak into another. */
function freshIp(): string {
  ipSeq += 1;
  return hashIp(`198.51.100.${ipSeq}`, keys);
}

function pgliteSql(pg: PGlite): Sql {
  const run = async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows;
  const tagged = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  tagged.query = run;
  return tagged;
}

before(async () => {
  db = new PGlite();
  await db.waitReady;
  for (const name of ["0002_foundation.sql", "0004_receipt_codes.sql"]) {
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into users (id, display_name) values
      ('u1', 'Ana'), ('u2', 'Ben'), ('owner1', 'Cafe Owner'), ('owner2', 'Bakery Owner');
    insert into merchants (id, owner_user_id, name, verification_status, terms_accepted_at, walkthrough_accepted_at) values
      ('m1', 'owner1', 'Corner Cafe', 'verified', now(), now()),
      ('m2', 'owner2', 'Main St Bakery', 'pending', null, null);
    insert into campaigns (id, merchant_id, name, campaign_type, starts_at, ends_at, status) values
      ('c1', 'm1', 'Pilot', 'A', now() - interval '1 day', now() + interval '14 days', 'live'),
      ('c_draft', 'm1', 'Next month', 'A', now() + interval '20 days', now() + interval '34 days', 'draft'),
      ('c_over', 'm1', 'Old', 'A', now() - interval '30 days', now() - interval '16 days', 'ended'),
      ('c2', 'm2', 'Pilot', 'A', now() - interval '1 day', now() + interval '14 days', 'live');
  `);
  sql = pgliteSql(db);
});

after(async () => {
  await db.close();
});

async function device(ipHash = freshIp()): Promise<string> {
  const r = await ensureDevice(sql, { rawToken: null, ipHash, limits });
  assert.ok(r.ok);
  return r.deviceId;
}

async function codes(n = 1, campaignId = "c1", mode: "handout_batch" | "till_single_purchase" = "handout_batch") {
  const r = await generateCodes(sql, { userId: "owner1", campaignId, count: n, issueMode: mode, keys, limits });
  assert.equal(r.outcome, "ok");
  return (r as { codes: string[] }).codes;
}

function details(overrides: Partial<PurchaseDetails> = {}): PurchaseDetails {
  return {
    productLabel: "Flat white",
    orderValueCents: 500,
    currency: "USD",
    purchasedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

async function codeRow(printed: string) {
  const rows = await sql.query<Record<string, unknown>>(
    `select * from receipt_codes where code_hash = $1`,
    [hashCode(normalizeCode(printed)!, keys)],
  );
  return rows[0];
}

// ------------------------------------------------------------ generation

test("generation stores only hashes, never a raw code", async () => {
  const made = await codes(5);
  assert.equal(made.length, 5);
  const dump = JSON.stringify(
    await sql.query(`select * from receipt_codes`),
  ) + JSON.stringify(await sql.query(`select * from receipt_code_events`));
  for (const printed of made) {
    assert.ok(!dump.includes(printed));
    assert.ok(!dump.includes(normalizeCode(printed)!));
    const row = await codeRow(printed);
    assert.equal(row.status, "issued");
    assert.equal(row.issue_mode, "handout_batch");
  }
  const logged = await sql.query<{ n: number }>(
    `select count(*)::int as n from receipt_code_events where kind = 'issued'`,
  );
  assert.ok(logged[0].n >= 5);
});

test("codes expire at the earlier of campaign end or the code lifetime", async () => {
  const [printed] = await codes(1);
  const row = await codeRow(printed);
  const campaign = (await sql.query<{ ends_at: Date }>(`select ends_at from campaigns where id = 'c1'`))[0];
  const expires = new Date(row.expires_at as string).getTime();
  assert.ok(expires <= new Date(campaign.ends_at).getTime());
  assert.ok(expires <= Date.now() + limits.codeLifetimeSeconds * 1000 + 5_000);
});

test("only a verified owner who accepted the rules can make codes (MER-02, MER-07)", async () => {
  const gen = (userId: string, campaignId: string, count = 1) =>
    generateCodes(sql, { userId, campaignId, count, issueMode: "handout_batch", keys, limits });
  assert.equal((await gen("u1", "c1")).outcome, "campaign_not_found"); // not the owner
  assert.equal((await gen("owner1", "nope")).outcome, "campaign_not_found");
  assert.equal((await gen("owner2", "c2")).outcome, "merchant_not_verified");
  await db.exec(`update merchants set verification_status = 'verified' where id = 'm2'`);
  assert.equal((await gen("owner2", "c2")).outcome, "terms_not_accepted");
  await db.exec(`update merchants set terms_accepted_at = now() where id = 'm2'`);
  assert.equal((await gen("owner2", "c2")).outcome, "walkthrough_not_accepted");
  await db.exec(`update merchants set verification_status = 'pending', terms_accepted_at = null where id = 'm2'`);
  assert.equal((await gen("owner1", "c_over")).outcome, "campaign_ended");
  assert.equal((await gen("owner1", "c1", 0)).outcome, "bad_count");
  assert.equal((await gen("owner1", "c1", limits.maxCodesPerBatch + 1)).outcome, "bad_count");
  assert.equal((await gen("owner1", "c_draft")).outcome, "ok"); // draft campaigns can prepare codes
});

test("the database refuses reusable codes until reuse is designed", async () => {
  await assert.rejects(
    generateCodes(sql, {
      userId: "owner1", campaignId: "c1", count: 1, issueMode: "handout_batch", keys,
      limits: { ...limits, maxUsesPerCode: 2 },
    }),
  );
});

// ------------------------------------------------------------ scan

test("first valid scan binds the code to that device; another phone is refused (HON-07)", async () => {
  const [printed] = await codes(1);
  const phoneA = await device();
  const phoneB = await device();
  const ip = freshIp();
  const first = await scanCode(sql, { rawCode: printed, deviceId: phoneA, ipHash: ip, keys, limits });
  assert.equal(first.outcome, "ok");
  if (first.outcome === "ok") {
    assert.equal(first.merchantName, "Corner Cafe");
    assert.equal(first.campaignName, "Pilot");
  }
  const row = await codeRow(printed);
  assert.equal(row.status, "bound");
  assert.equal(row.bound_device_id, phoneA);
  assert.equal((await scanCode(sql, { rawCode: printed, deviceId: phoneA, ipHash: ip, keys, limits })).outcome, "ok");
  assert.equal((await scanCode(sql, { rawCode: printed, deviceId: phoneB, ipHash: freshIp(), keys, limits })).outcome, "other_device");
  assert.equal((await codeRow(printed)).bound_device_id, phoneA);
});

test("unknown, typo'd, expired, suspended and off-window codes give their own reason", async () => {
  const phone = await device();
  const scan = (rawCode: string) => scanCode(sql, { rawCode, deviceId: phone, ipHash: freshIp(), keys, limits });

  assert.equal((await scan(formatCode(generateCode()))).outcome, "not_found");
  const [good] = await codes(1);
  const typo = good.slice(0, 2) + (good[2] === "A" ? "B" : "A") + good.slice(3);
  assert.equal((await scan(typo)).outcome, "malformed");

  const [expired] = await codes(1);
  await sql.query(
    `update receipt_codes set issued_at = now() - interval '2 days', expires_at = now() - interval '1 second' where code_hash = $1`,
    [hashCode(normalizeCode(expired)!, keys)],
  );
  assert.equal((await scan(expired)).outcome, "expired");

  const [switchedOff] = await codes(1);
  const row = await codeRow(switchedOff);
  assert.ok(await suspendCode(sql, { codeId: row.id as string, reason: "Reported lost", actorUserId: "owner1" }));
  assert.equal(await suspendCode(sql, { codeId: row.id as string, reason: "Again", actorUserId: "owner1" }), false);
  assert.equal((await scan(switchedOff)).outcome, "suspended");

  const [early] = await codes(1, "c_draft");
  assert.equal((await scan(early)).outcome, "campaign_not_live");
  await db.exec(`update campaigns set status = 'live' where id = 'c_draft'`);
  assert.equal((await scan(early)).outcome, "campaign_not_started");
  await db.exec(`update campaigns set status = 'draft' where id = 'c_draft'`);

  const [paused] = await codes(1);
  await db.exec(`update campaigns set status = 'suspended' where id = 'c1'`);
  assert.equal((await scan(paused)).outcome, "campaign_not_live");
  await db.exec(`update campaigns set status = 'live' where id = 'c1'`);

  const [ended] = await codes(1);
  await db.exec(`update campaigns set ends_at = now() - interval '1 second', starts_at = now() - interval '20 days' where id = 'c1'`);
  assert.equal((await scan(ended)).outcome, "campaign_ended");
  await db.exec(`update campaigns set starts_at = now() - interval '1 day', ends_at = now() + interval '14 days' where id = 'c1'`);

  // None of these bound a device or made a purchase.
  for (const p of [expired, switchedOff, early, paused, ended]) {
    assert.equal((await codeRow(p)).bound_device_id, null);
  }
});

// ------------------------------------------------------------ claim

test("a code can be claimed exactly once, by the scanning phone, creating a PENDING purchase", async () => {
  const [printed] = await codes(1);
  const phone = await device();
  const ip = freshIp();
  assert.equal((await scanCode(sql, { rawCode: printed, deviceId: phone, ipHash: ip, keys, limits })).outcome, "ok");

  const claim = await claimCode(sql, { rawCode: printed, deviceId: phone, userId: "u1", ipHash: ip, details: details(), keys, limits });
  assert.equal(claim.outcome, "ok");
  const purchaseId = (claim as { purchaseId: string }).purchaseId;
  const p = (await sql.query<Record<string, unknown>>(`select * from verified_purchases where id = $1`, [purchaseId]))[0];
  assert.equal(p.verification_status, "pending");
  assert.equal(p.verification_method, "receipt_code");
  assert.equal(p.user_id, "u1");
  assert.equal(p.merchant_id, "m1");
  assert.equal(p.campaign_id, "c1");
  assert.equal(p.receipt_code_id, (await codeRow(printed)).id);
  assert.equal((await codeRow(printed)).status, "claimed");

  const again = await claimCode(sql, { rawCode: printed, deviceId: phone, userId: "u1", ipHash: ip, details: details(), keys, limits });
  assert.equal(again.outcome, "used");
  assert.equal((await scanCode(sql, { rawCode: printed, deviceId: phone, ipHash: ip, keys, limits })).outcome, "used");
});

test("two claims at once: exactly one wins", async () => {
  const [printed] = await codes(1);
  const phone = await device();
  const ip = freshIp();
  const results = await Promise.all(
    ["u1", "u2"].map((userId) =>
      claimCode(sql, { rawCode: printed, deviceId: phone, userId, ipHash: ip, details: details(), keys, limits }),
    ),
  );
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["ok", "used"]);
  const n = await sql.query<{ n: number }>(
    `select count(*)::int as n from verified_purchases where receipt_code_id = $1`,
    [(await codeRow(printed)).id],
  );
  assert.equal(n[0].n, 1);
});

test("a code bound to one phone can't be claimed from another", async () => {
  const [printed] = await codes(1);
  const phoneA = await device();
  const phoneB = await device();
  await scanCode(sql, { rawCode: printed, deviceId: phoneA, ipHash: freshIp(), keys, limits });
  const r = await claimCode(sql, { rawCode: printed, deviceId: phoneB, userId: "u2", ipHash: freshIp(), details: details(), keys, limits });
  assert.equal(r.outcome, "other_device");
});

test("claim needs a device and sensible purchase details", async () => {
  const [printed] = await codes(1);
  const base = { rawCode: printed, userId: "u1", ipHash: freshIp(), keys, limits };
  assert.equal((await claimCode(sql, { ...base, deviceId: null, details: details() })).outcome, "device_missing");
  const phone = await device();
  for (const bad of [
    details({ productLabel: "  " }),
    details({ orderValueCents: -1 }),
    details({ orderValueCents: 1.5 }),
    details({ currency: "usd" }),
    details({ purchasedAt: "yesterday-ish" }),
  ]) {
    assert.equal((await claimCode(sql, { ...base, deviceId: phone, details: bad })).outcome, "invalid_details");
  }
  const tooEarly = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  assert.equal(
    (await claimCode(sql, { ...base, deviceId: phone, details: details({ purchasedAt: tooEarly }) })).outcome,
    "purchase_outside_window",
  );
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  assert.equal(
    (await claimCode(sql, { ...base, deviceId: phone, details: details({ purchasedAt: future }) })).outcome,
    "purchase_outside_window",
  );
  assert.equal((await codeRow(printed)).status, "issued"); // nothing was used up
});

test("the business owner can't claim their own code (HON-05)", async () => {
  const [printed] = await codes(1);
  const r = await claimCode(sql, { rawCode: printed, deviceId: await device(), userId: "owner1", ipHash: freshIp(), details: details(), keys, limits });
  assert.equal(r.outcome, "own_business");
});

test("claims per person per campaign are logged for review, with no cap (HON-06)", async () => {
  const made = await codes(2);
  const phone = await device();
  const ip = freshIp();
  const counts: number[] = [];
  for (const printed of made) {
    const r = await claimCode(sql, { rawCode: printed, deviceId: phone, userId: "u2", ipHash: ip, details: details(), keys, limits });
    assert.equal(r.outcome, "ok");
    counts.push((r as { userClaimsInCampaign: number }).userClaimsInCampaign);
  }
  assert.equal(counts[1], counts[0] + 1);
  const logged = await sql.query<{ n: number }>(
    `select (detail->>'user_claims_in_campaign')::int as n from receipt_code_events
      where kind = 'claim' and outcome = 'ok' and user_id = 'u2' order by at desc limit 1`,
  );
  assert.equal(logged[0].n, counts[1]);
});

// ------------------------------------------------------------ purchase rules

test("a handout code alone can never verify a purchase; a photo check is required (FR-08a)", async () => {
  const [printed] = await codes(1);
  const r = await claimCode(sql, { rawCode: printed, deviceId: await device(), userId: "u1", ipHash: freshIp(), details: details(), keys, limits });
  const id = (r as { purchaseId: string }).purchaseId;
  await assert.rejects(
    sql.query(`update verified_purchases set verification_status = 'verified', verified_at = now() where id = $1`, [id]),
    /receipt photo/,
  );
  await sql.query(
    `update verified_purchases set verification_method = 'receipt_code_and_photo', verification_status = 'verified', verified_at = now() where id = $1`,
    [id],
  );
});

test("a till-tied code can verify on its own, but not once suspended", async () => {
  const [printed] = await codes(1, "c1", "till_single_purchase");
  const r = await claimCode(sql, { rawCode: printed, deviceId: await device(), userId: "u1", ipHash: freshIp(), details: details(), keys, limits });
  const id = (r as { purchaseId: string }).purchaseId;
  const row = await codeRow(printed);
  await suspendCode(sql, { codeId: row.id as string, reason: "Fraud flag", actorUserId: "owner1" });
  await assert.rejects(
    sql.query(`update verified_purchases set verification_status = 'verified', verified_at = now() where id = $1`, [id]),
  );
  await sql.query(`update verified_purchases set verification_status = 'rejected' where id = $1`, [id]); // rejecting still works
});

test("purchases can't point at a code they didn't claim", async () => {
  const insert = (codeId: string | null, userId = "u1", method = "receipt_code") =>
    sql.query(
      `insert into verified_purchases (user_id, merchant_id, campaign_id, product_label, order_value_cents,
         verification_method, receipt_code_id, purchased_at)
       values ($1, 'm1', 'c1', 'Muffin', 300, $2, $3, now())`,
      [userId, method, codeId],
    );
  await assert.rejects(insert(null), /must link/);
  await assert.rejects(insert("no-such-code"));
  const [printed] = await codes(1);
  await assert.rejects(insert((await codeRow(printed)).id as string)); // not claimed by anyone
  const r = await claimCode(sql, { rawCode: printed, deviceId: await device(), userId: "u1", ipHash: freshIp(), details: details(), keys, limits });
  assert.equal(r.outcome, "ok");
  const codeId = (await codeRow(printed)).id as string;
  await assert.rejects(insert(codeId, "u2")); // someone else
  await assert.rejects(insert(codeId, "u1"), /unique|duplicate/i); // second purchase on one code
});

// ------------------------------------------------------------ rate limits and log

test("guessing is rate limited per device, even for a real code afterwards", async () => {
  const phone = await device();
  const [real] = await codes(1);
  const outcomes: string[] = [];
  for (let i = 0; i < limits.maxFailuresPerDevice + 1; i += 1) {
    outcomes.push((await scanCode(sql, { rawCode: formatCode(generateCode()), deviceId: phone, ipHash: freshIp(), keys, limits })).outcome);
  }
  assert.deepEqual(outcomes.slice(0, limits.maxFailuresPerDevice), Array(limits.maxFailuresPerDevice).fill("not_found"));
  assert.equal(outcomes.at(-1), "rate_limited");
  assert.equal((await scanCode(sql, { rawCode: real, deviceId: phone, ipHash: freshIp(), keys, limits })).outcome, "rate_limited");
  assert.equal((await claimCode(sql, { rawCode: real, deviceId: phone, userId: "u1", ipHash: freshIp(), details: details(), keys, limits })).outcome, "rate_limited");
  assert.equal((await codeRow(real)).status, "issued");
});

test("a fresh device per guess doesn't escape the network-address limit", async () => {
  const ip = freshIp();
  const phones: string[] = [];
  const devices = await Promise.all(
    Array.from({ length: limits.maxNewDevicesPerIp + 1 }, () => ensureDevice(sql, { rawToken: null, ipHash: ip, limits })),
  );
  for (const d of devices) if (d.ok) phones.push(d.deviceId);
  assert.equal(phones.length, limits.maxNewDevicesPerIp);
  assert.equal(devices.at(-1)?.ok, false);

  // Spread guesses over those devices from one address: the address limit stops them.
  const outcomes: string[] = [];
  for (let i = 0; i < limits.maxFailuresPerIp + 1; i += 1) {
    const deviceId = phones[i % phones.length];
    outcomes.push((await scanCode(sql, { rawCode: formatCode(generateCode()), deviceId, ipHash: ip, keys, limits })).outcome);
  }
  assert.equal(outcomes.filter((o) => o === "not_found").length <= limits.maxFailuresPerIp, true);
  assert.equal(outcomes.at(-1), "rate_limited");
});

test("typos don't count toward the limit", async () => {
  const phone = await device();
  for (let i = 0; i < limits.maxFailuresPerDevice + 2; i += 1) {
    assert.equal((await scanCode(sql, { rawCode: "ABCD-EFGH-JKMN-0", deviceId: phone, ipHash: freshIp(), keys, limits })).outcome, "malformed");
  }
  const [real] = await codes(1);
  assert.equal((await scanCode(sql, { rawCode: real, deviceId: phone, ipHash: freshIp(), keys, limits })).outcome, "ok");
});

test("an existing device is found again from its token; unknown tokens are not", async () => {
  const ip = freshIp();
  const first = await ensureDevice(sql, { rawToken: null, ipHash: ip, limits });
  assert.ok(first.ok && first.newRawToken);
  if (!first.ok || !first.newRawToken) return;
  const again = await ensureDevice(sql, { rawToken: first.newRawToken, ipHash: ip, limits });
  assert.ok(again.ok);
  if (again.ok) {
    assert.equal(again.deviceId, first.deviceId);
    assert.equal(again.newRawToken, null);
  }
  assert.equal(await findDevice(sql, "x".repeat(43)), null);
  const stored = await sql.query<{ token_hash: string }>(`select token_hash from devices where id = $1`, [first.deviceId]);
  assert.notEqual(stored[0].token_hash, first.newRawToken);
});

test("every scan and claim is logged, and the log can't be changed", async () => {
  const before = (await sql.query<{ n: number }>(`select count(*)::int as n from receipt_code_events`))[0].n;
  const phone = await device();
  await scanCode(sql, { rawCode: formatCode(generateCode()), deviceId: phone, ipHash: freshIp(), keys, limits });
  await claimCode(sql, { rawCode: "nonsense", deviceId: phone, userId: "u1", ipHash: freshIp(), details: details(), keys, limits });
  const afterCount = (await sql.query<{ n: number }>(`select count(*)::int as n from receipt_code_events`))[0].n;
  assert.equal(afterCount, before + 3); // device_created + scan + claim
  await assert.rejects(sql.query(`update receipt_code_events set outcome = 'ok'`), /append-only/);
  await assert.rejects(sql.query(`delete from receipt_code_events`), /append-only/);
  await assert.rejects(sql.query(`truncate receipt_code_events`), /append-only/);
});

test("new tables carry no money or payout data (FR-27, PAY-01)", async () => {
  const cols = await sql.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_name in ('devices', 'receipt_codes', 'receipt_code_events')
        and column_name ~ '(pay|reward|amount|cents|cap|floor|percent|rating)'`,
  );
  assert.deepEqual(cols, []);
});
