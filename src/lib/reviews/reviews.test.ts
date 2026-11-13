// Ticket 4 — review submission against a throwaway in-memory PGlite with the
// real 0002 + 0004 + 0005 + 0006 migrations. Purchases are made the real way:
// code → claim → photo → admin approves.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { deriveHashKeys, hashIp } from "../receipt-codes/codes.ts";
import { claimCode, ensureDevice, generateCodes } from "../receipt-codes/engine.ts";
import { RECEIPT_CODE_LIMITS, RECEIPT_PHOTO_LIMITS } from "../receipt-codes/limits.ts";
import { decidePurchase, storePhoto } from "../receipt-codes/photos.ts";
import { pgliteSql } from "../receipt-codes/test-support.ts";
import { getReviewStart, submitReview } from "./engine.ts";
import { REVIEW_LIMITS } from "./limits.ts";

const keys = deriveHashKeys("test-secret-not-real-0123456789abcdef");
let db: PGlite;
let sql: Sql;
let seq = 0;

before(async () => {
  db = new PGlite();
  await db.waitReady;
  for (const name of ["0002_foundation.sql", "0004_receipt_codes.sql", "0005_receipt_photos.sql", "0006_reviews.sql"]) {
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into users (id, display_name) values
      ('u1', 'Ana'), ('u2', 'Ben'), ('owner1', 'Cafe Owner'), ('admin1', 'Jack');
    insert into merchants (id, owner_user_id, name, verification_status, terms_accepted_at, walkthrough_accepted_at) values
      ('m1', 'owner1', 'Corner Cafe', 'verified', now(), now());
    insert into campaigns (id, merchant_id, name, campaign_type, starts_at, ends_at, status) values
      ('c1', 'm1', 'Pilot', 'A', now() - interval '1 day', now() + interval '14 days', 'live');
  `);
  sql = pgliteSql(db);
});

after(async () => {
  await db.close();
});

function uniquePhoto(): Uint8Array {
  seq += 1;
  const out = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0, 0, 0]);
  new DataView(out.buffer).setUint32(10, seq);
  return out;
}

/** A purchase made the real way, then approved / turned down / left pending. */
async function purchase(userId = "u1", end: "verified" | "rejected" | "pending" = "verified"): Promise<string> {
  const gen = await generateCodes(sql, {
    userId: "owner1",
    campaignId: "c1",
    count: 1,
    issueMode: "handout_batch",
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  assert.equal(gen.outcome, "ok");
  seq += 1;
  const ipHash = hashIp(`203.0.113.${seq % 250}-${seq}`, keys);
  const dev = await ensureDevice(sql, { rawToken: null, ipHash, limits: RECEIPT_CODE_LIMITS });
  assert.ok(dev.ok);
  const claim = await claimCode(sql, {
    rawCode: (gen as { codes: string[] }).codes[0],
    deviceId: dev.deviceId,
    userId,
    ipHash,
    details: { productLabel: "Flat white", orderValueCents: 450, currency: "USD", purchasedAt: new Date(Date.now() - 60_000).toISOString() },
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  assert.equal(claim.outcome, "ok");
  const purchaseId = (claim as { purchaseId: string }).purchaseId;
  if (end === "pending") return purchaseId;
  const stored = await storePhoto(sql, { purchaseId, userId, photo: uniquePhoto(), header: null, limits: RECEIPT_PHOTO_LIMITS });
  assert.equal(stored.outcome, "ok");
  const decided = await decidePurchase(sql, {
    purchaseId,
    adminUserId: "admin1",
    decision: end,
    reason: end === "rejected" ? "Receipt is for another shop" : "",
    confirmedOrderValueCents: end === "verified" ? 450 : null,
    limits: RECEIPT_PHOTO_LIMITS,
  });
  assert.equal(decided.outcome, "ok");
  return purchaseId;
}

const fields = (over: Record<string, unknown> = {}) => ({
  rating: 2,
  whatUsed: "Flat white",
  howLong: "Drank it there",
  honestThought: "Bit bitter, good foam.",
  ...over,
});

const submit = (purchaseId: string, userId = "u1", over: Record<string, unknown> = {}) =>
  submitReview(sql, { purchaseId, userId, fields: fields(over), limits: REVIEW_LIMITS });

async function countReviews(purchaseId: string): Promise<number> {
  const rows = await sql.query<{ n: number }>(`select count(*)::int as n from reviews where verified_purchase_id = $1`, [purchaseId]);
  return rows[0].n;
}

test("the purchaser posts a review of a verified purchase; the disclosure comes from the campaign", async () => {
  const p = await purchase("u1");
  const r = await submit(p, "u1", { honestThought: "  Bit bitter, good foam.  " });
  assert.equal(r.outcome, "ok");
  const review = (r as { review: import("./engine.ts").ReviewView }).review;
  assert.equal(review.reviewerName, "Ana");
  assert.equal(review.merchantName, "Corner Cafe");
  assert.equal(review.productLabel, "Flat white");
  assert.equal(review.rating, 2);
  assert.equal(review.honestThought, "Bit bitter, good foam.");
  assert.equal(review.verifiedPurchase, true);
  assert.ok(review.disclosure);
  assert.equal(review.disclosure.merchantName, "Corner Cafe");
  assert.equal(review.disclosure.incentive, true);
  assert.equal(review.disclosure.ratingBlind, true);
  assert.equal(review.disclosure.reward.status, "not_set");
  assert.equal(review.disclosure.complete, false);

  const events = await sql.query<{ event: string; user_id: string }>(`select event, user_id from review_events where review_id = $1`, [review.reviewId]);
  assert.deepEqual(events, [{ event: "submitted", user_id: "u1" }]);
});

test("one review per purchase (HON-04)", async () => {
  const p = await purchase("u1");
  assert.equal((await submit(p)).outcome, "ok");
  assert.equal((await submit(p, "u1", { rating: 5 })).outcome, "already_reviewed");
  assert.equal(await countReviews(p), 1);
});

test("only the purchaser can review, and only a verified purchase", async () => {
  const p = await purchase("u1");
  assert.equal((await submit(p, "u2")).outcome, "not_found");
  assert.equal((await submit("no-such-purchase", "u1")).outcome, "not_found");
  assert.equal((await submit(p, "")).outcome, "not_found");

  const pending = await purchase("u1", "pending");
  assert.equal((await submit(pending)).outcome, "not_verified");
  const rejected = await purchase("u1", "rejected");
  assert.equal((await submit(rejected)).outcome, "rejected");
  assert.equal(await countReviews(pending), 0);
  assert.equal(await countReviews(rejected), 0);
});

test("missing or overlong fields are refused and nothing is stored", async () => {
  const p = await purchase("u1");
  for (const over of [
    { rating: 0 },
    { rating: 6 },
    { rating: 3.5 },
    { whatUsed: "  " },
    { howLong: "" },
    { honestThought: "" },
    { honestThought: "a".repeat(REVIEW_LIMITS.maxThoughtChars + 1) },
  ]) {
    const r = await submit(p, "u1", over);
    assert.equal(r.outcome, "invalid", JSON.stringify(over).slice(0, 40));
  }
  assert.equal(await countReviews(p), 0);
});

test("the database refuses bad fields even if the engine's check is skipped", async () => {
  const p = await purchase("u1");
  const rows = await sql.query<{ r_outcome: string }>(
    `select * from trufolks_submit_review($1, 'u1', 3, 'Flat white', '  ', 'Fine.', 200, 2000)`,
    [p],
  );
  assert.equal(rows[0].r_outcome, "invalid");
  assert.equal(await countReviews(p), 0);
});

test("the disclosure is the same for a 1-star and a 5-star review (PAY-01, HON-01)", async () => {
  const a = await purchase("u1");
  const b = await purchase("u1");
  await submit(a, "u1", { rating: 1 });
  await submit(b, "u1", { rating: 5 });
  const rows = await sql.query<{ rating: number; d: unknown }>(
    `select rating, disclosure - 'attached_at' as d from reviews where verified_purchase_id in ($1, $2) order by rating`,
    [a, b],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].d, rows[1].d);
});

test("the preview disclosure is exactly the one attached on posting (FR-14)", async () => {
  const p = await purchase("u2");
  const before = await getReviewStart(sql, { purchaseId: p, userId: "u2" });
  assert.equal(before.outcome, "ok");
  const start = (before as { start: import("./engine.ts").ReviewStart }).start;
  assert.equal(start.status, "verified");
  assert.equal(start.review, null);
  assert.equal(start.reviewerName, "Ben");
  const r = await submit(p, "u2");
  assert.equal(r.outcome, "ok");
  assert.deepEqual((r as { review: import("./engine.ts").ReviewView }).review.disclosure, start.disclosure);

  const after = await getReviewStart(sql, { purchaseId: p, userId: "u2" });
  assert.ok(after.outcome === "ok" && after.start.review);
  assert.equal(after.start.review.rating, 2);
  assert.equal((await getReviewStart(sql, { purchaseId: p, userId: "u1" })).outcome, "not_found");
});

test("a posted review's rating, honest fields and disclosure are locked (FR-15)", async () => {
  const p = await purchase("u1");
  const r = await submit(p);
  const id = (r as { review: { reviewId: string } }).review.reviewId;
  for (const set of [
    "rating = 5",
    "what_used = 'x'",
    "how_long = 'x'",
    "honest_thought = 'Great!'",
    `disclosure = '{"version":1}'::jsonb`,
    "user_id = 'u2'",
    "created_at = now() - interval '1 day'",
  ]) {
    await assert.rejects(sql.query(`update reviews set ${set} where id = $1`, [id]), /locked/, set);
  }
  await assert.rejects(sql.query(`delete from reviews where id = $1`, [id]), /cannot be deleted/);
  // Display settings are not locked.
  await sql.query(`update reviews set visibility = 'contacts', updated_at = now() where id = $1`, [id]);
  const row = await sql.query<{ rating: number }>(`select rating from reviews where id = $1`, [id]);
  assert.equal(row[0].rating, 2);
});

test("a review can't be inserted around the function: needs a verified purchase and a disclosure", async () => {
  const verified = await purchase("u1");
  await assert.rejects(
    sql.query(
      `insert into reviews (user_id, verified_purchase_id, rating, what_used, how_long, honest_thought)
       values ('u1', $1, 4, 'a', 'b', 'c')`,
      [verified],
    ),
    /disclosure/,
  );
  const pending = await purchase("u1", "pending");
  await assert.rejects(
    sql.query(
      `insert into reviews (user_id, verified_purchase_id, rating, what_used, how_long, honest_thought, disclosure)
       values ('u1', $1, 4, 'a', 'b', 'c', '{}'::jsonb)`,
      [pending],
    ),
    /verified purchase/,
  );
});

test("review events are append-only and carry no review text or payout data", async () => {
  const p = await purchase("u1");
  await submit(p);
  await assert.rejects(sql.query(`update review_events set event = 'submitted'`), /append-only/);
  await assert.rejects(sql.query(`delete from review_events`), /append-only/);
  const cols = await sql.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_name = 'review_events'
        and column_name ~ '(pay|reward|amount|cents|cap|floor|percent|thought|what_used|how_long)'`,
  );
  assert.deepEqual(cols, []);
});
