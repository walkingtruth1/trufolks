// Ticket 6 — merchant dashboard and concierge set-up against a throwaway
// in-memory PGlite with the real migrations 0001–0010. The funnel is driven the
// real way: admin adds business + offer → owner accepts → codes → scan → claim
// → photo → admin decides → review.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { deriveHashKeys, hashIp } from "../receipt-codes/codes.ts";
import { claimCode, ensureDevice, generateCodes, scanCode } from "../receipt-codes/engine.ts";
import { RECEIPT_CODE_LIMITS, RECEIPT_PHOTO_LIMITS } from "../receipt-codes/limits.ts";
import { decidePurchase, storePhoto } from "../receipt-codes/photos.ts";
import { pgliteSql } from "../receipt-codes/test-support.ts";
import { submitReview } from "../reviews/engine.ts";
import { REVIEW_LIMITS } from "../reviews/limits.ts";
import {
  acceptMerchant,
  adminCreateBusiness,
  adminCreateOffer,
  getDashboard,
  listBusinessesForAdmin,
} from "./engine.ts";
import { MERCHANT_LIMITS } from "./limits.ts";
import { recordDeposit } from "../payouts/engine.ts";
import { MERCHANT_OUTCOMES, merchantMessage, PAY_FOR_ANY_RATING_STATEMENT, WALKTHROUGH } from "./messages.ts";

const keys = deriveHashKeys("test-secret-not-real-0123456789abcdef");
let db: PGlite;
let sql: Sql;
let seq = 0;

before(async () => {
  db = new PGlite();
  await db.waitReady;
  for (const name of [
    "0001_auth.sql",
    "0002_foundation.sql",
    "0003_link_users_to_auth.sql",
    "0004_receipt_codes.sql",
    "0005_receipt_photos.sql",
    "0006_reviews.sql",
    "0007_contacts_feed.sql",
    "0008_merchant_dashboard.sql",
    "0009_config_presets.sql",
    "0010_payout_ledger.sql",
  ]) {
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  sql = pgliteSql(db);
  await account("admin1", "Jack", "jack@example.com");
});

after(async () => {
  await db.close();
});

/** A login account; the 0003 sign-up trigger creates the TruFolks users row. */
async function account(id: string, name: string, email: string): Promise<string> {
  await sql.query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, false, now(), now())`,
    [id, name, email],
  );
  return id;
}

function uniquePhoto(): Uint8Array {
  seq += 1;
  const out = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0, 0, 0]);
  new DataView(out.buffer).setUint32(10, seq);
  return out;
}

const hourFromNow = () => new Date(Date.now() + 3600_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
const dayAgo = () => new Date(Date.now() - 86400_000).toISOString();

/** Admin adds a business + live offer for a new owner; owner accepts both. */
async function readyBusiness(tag: string, accept = true): Promise<{ owner: string; merchantId: string; campaignId: string }> {
  const owner = await account(`owner-${tag}`, `Owner ${tag}`, `owner-${tag}@example.com`);
  const b = await adminCreateBusiness(sql, {
    adminId: "admin1",
    ownerEmail: `Owner-${tag}@Example.com `,
    name: `Cafe ${tag}`,
    businessType: "Coffee",
  });
  assert.equal(b.outcome, "ok");
  const merchantId = (b as { merchantId: string }).merchantId;
  const o = await adminCreateOffer(sql, {
    adminId: "admin1",
    merchantId,
    name: "Pilot",
    startsAt: dayAgo(),
    endsAt: daysFromNow(12.9), // just under 14 days in all: the pilot preset's most (CFG-04)
  });
  assert.equal(o.outcome, "ok");
  // Ticket 8 (MER-06): the business funds the offer upfront.
  assert.equal(
    await recordDeposit(sql, { actorId: "admin1", campaignId: (o as { campaignId: string }).campaignId, amountCents: 25000, note: "test deposit" }),
    "ok",
  );
  if (accept) {
    assert.equal(await acceptMerchant(sql, { userId: owner, merchantId, what: "walkthrough" }), "ok");
    assert.equal(await acceptMerchant(sql, { userId: owner, merchantId, what: "terms" }), "ok");
  }
  return { owner, merchantId, campaignId: (o as { campaignId: string }).campaignId };
}

async function makeCodes(owner: string, campaignId: string, count: number): Promise<string[]> {
  const gen = await generateCodes(sql, {
    userId: owner,
    campaignId,
    count,
    issueMode: "handout_batch",
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  assert.equal(gen.outcome, "ok");
  return (gen as { codes: string[] }).codes;
}

/** Scan + claim (+ photo + decision) as a buyer. Returns the purchase id. */
async function buy(code: string, buyer: string, end: "pending" | "verified" | "rejected" | "scan_only"): Promise<string | null> {
  seq += 1;
  const ipHash = hashIp(`198.51.100.${seq % 250}-${seq}`, keys);
  const dev = await ensureDevice(sql, { rawToken: null, ipHash, limits: RECEIPT_CODE_LIMITS });
  assert.ok(dev.ok);
  const scan = await scanCode(sql, { rawCode: code, deviceId: dev.deviceId, ipHash, keys, limits: RECEIPT_CODE_LIMITS });
  assert.equal(scan.outcome, "ok");
  if (end === "scan_only") return null;
  const claim = await claimCode(sql, {
    rawCode: code,
    deviceId: dev.deviceId,
    userId: buyer,
    ipHash,
    details: { productLabel: "Flat white", orderValueCents: 450, currency: "USD", purchasedAt: new Date(Date.now() - 60_000).toISOString() },
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  assert.equal(claim.outcome, "ok");
  const purchaseId = (claim as { purchaseId: string }).purchaseId;
  if (end === "pending") return purchaseId;
  const stored = await storePhoto(sql, { purchaseId, userId: buyer, photo: uniquePhoto(), header: null, limits: RECEIPT_PHOTO_LIMITS });
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

async function reviewIt(purchaseId: string, buyer: string, rating: number): Promise<void> {
  const r = await submitReview(sql, {
    purchaseId,
    userId: buyer,
    fields: { rating, whatUsed: "A flat white", howLong: "One cup", honestThought: `Rated ${rating}.` },
    limits: REVIEW_LIMITS,
  });
  assert.equal(r.outcome, "ok");
}

// ------------------------------------------------------------------ copy

test("every merchant outcome except ok has a plain message; statements say 1 star = 5 stars", () => {
  for (const o of MERCHANT_OUTCOMES) {
    if (o === "ok") assert.equal(merchantMessage(o), null);
    else assert.ok((merchantMessage(o) ?? "").length > 10, o);
  }
  assert.ok(PAY_FOR_ANY_RATING_STATEMENT.join(" ").includes("1-star review gets the same amount as a 5-star"));
  assert.ok(WALKTHROUGH.examples.some((e) => e.rating === 1));
  assert.ok(WALKTHROUGH.points.some((p) => p.includes("can't remove")));
});

// ------------------------------------------------------------------ concierge set-up

test("admin adds a business for an existing account by email (case and spaces ignored)", async () => {
  const { owner, merchantId } = await readyBusiness("a", false);
  const m = await sql.query<{ owner_user_id: string; verification_status: string; terms_accepted_at: unknown }>(
    `select owner_user_id, verification_status, terms_accepted_at from merchants where id = $1`,
    [merchantId],
  );
  assert.equal(m[0].owner_user_id, owner);
  assert.equal(m[0].verification_status, "verified");
  assert.equal(m[0].terms_accepted_at, null);
  const offer = await sql.query<{ campaign_type: string; status: string }>(
    `select campaign_type, status from campaigns where merchant_id = $1`,
    [merchantId],
  );
  assert.deepEqual(offer[0], { campaign_type: "A", status: "live" });
  const events = await sql.query<{ event: string; actor_user_id: string }>(
    `select event, actor_user_id from merchant_events where merchant_id = $1 order by at, event`,
    [merchantId],
  );
  assert.deepEqual(
    events.map((e) => [e.event, e.actor_user_id]),
    [
      ["created", "admin1"],
      ["offer_created", "admin1"],
    ],
  );
  const list = await listBusinessesForAdmin(sql);
  const row = list.find((b) => b.merchantId === merchantId);
  assert.equal(row?.ownerEmail, "owner-a@example.com");
  assert.equal(row?.offers.length, 1);
  assert.equal(row?.termsAccepted, false);
});

test("admin set-up refuses unknown owners, blank names and bad dates", async () => {
  assert.equal(
    (await adminCreateBusiness(sql, { adminId: "admin1", ownerEmail: "nobody@example.com", name: "X", businessType: "" })).outcome,
    "owner_not_found",
  );
  await account("owner-b", "Owner b", "owner-b@example.com");
  assert.equal(
    (await adminCreateBusiness(sql, { adminId: "admin1", ownerEmail: "owner-b@example.com", name: "   ", businessType: "" })).outcome,
    "invalid",
  );
  const ok = (await adminCreateBusiness(sql, {
    adminId: "admin1",
    ownerEmail: "owner-b@example.com",
    name: "Bakery",
    businessType: "",
  })) as { merchantId: string };
  const offer = (over: Partial<{ name: string; startsAt: string | null; endsAt: string | null; merchantId: string }>) =>
    adminCreateOffer(sql, { adminId: "admin1", merchantId: ok.merchantId, name: "Pilot", startsAt: dayAgo(), endsAt: hourFromNow(), ...over });
  assert.equal((await offer({ endsAt: dayAgo(), startsAt: daysFromNow(-2) })).outcome, "invalid"); // ends in the past
  assert.equal((await offer({ startsAt: daysFromNow(3), endsAt: daysFromNow(2) })).outcome, "invalid"); // ends before start
  assert.equal((await offer({ startsAt: null })).outcome, "invalid");
  assert.equal((await offer({ startsAt: "not a date" })).outcome, "invalid");
  assert.equal((await offer({ name: "" })).outcome, "invalid");
  assert.equal((await offer({ merchantId: "nope" })).outcome, "not_found");
  // Ticket 7 (CFG-04): longer than the most days allowed.
  assert.equal((await offer({ startsAt: dayAgo(), endsAt: daysFromNow(14) })).outcome, "too_long");
  assert.equal((await offer({})).outcome, "ok");
});

// ------------------------------------------------------------------ owner accepts (MER-02, MER-07)

test("no codes until the owner accepts both statements; only the owner can accept; acceptance is final", async () => {
  const { owner, merchantId, campaignId } = await readyBusiness("c", false);
  const tryCodes = () =>
    generateCodes(sql, { userId: owner, campaignId, count: 1, issueMode: "handout_batch", keys, limits: RECEIPT_CODE_LIMITS });
  assert.notEqual((await tryCodes()).outcome, "ok");

  const other = await account("intruder", "Intruder", "intruder@example.com");
  assert.equal(await acceptMerchant(sql, { userId: other, merchantId, what: "terms" }), "not_found");
  assert.equal(await acceptMerchant(sql, { userId: "admin1", merchantId, what: "terms" }), "not_found");
  assert.equal(await acceptMerchant(sql, { userId: owner, merchantId, what: "terms" }), "ok");
  assert.notEqual((await tryCodes()).outcome, "ok"); // walkthrough still missing
  assert.equal(await acceptMerchant(sql, { userId: owner, merchantId, what: "walkthrough" }), "ok");
  assert.equal(await acceptMerchant(sql, { userId: owner, merchantId, what: "walkthrough" }), "already");
  assert.equal((await tryCodes()).outcome, "ok");

  await assert.rejects(sql.query(`update merchants set terms_accepted_at = null where id = $1`, [merchantId]));
  await assert.rejects(sql.query(`update merchants set owner_user_id = 'intruder' where id = $1`, [merchantId]));
  await assert.rejects(sql.query(`delete from merchant_events where merchant_id = $1`, [merchantId]));
  const events = await sql.query<{ event: string; actor_user_id: string }>(
    `select event, actor_user_id from merchant_events where merchant_id = $1 and event like '%accepted' order by at`,
    [merchantId],
  );
  assert.deepEqual(
    events.map((e) => [e.event, e.actor_user_id]),
    [
      ["terms_accepted", owner],
      ["walkthrough_accepted", owner],
    ],
  );
});

// ------------------------------------------------------------------ dashboard (FR-24, MER-05, §13, P5)

test("the dashboard counts the scan-to-review funnel and every rating, with no reviewer names", async () => {
  const { owner, merchantId, campaignId } = await readyBusiness("d");
  const codes = await makeCodes(owner, campaignId, 7);
  const buyers = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => account(`buyer-d${i}`, `Buyer Name ${i}`, `bd${i}@example.com`)));
  // codes[0]: made only. codes[1]: opened only. codes[2]: claimed, pending. codes[3]: turned down.
  // codes[4..6]: verified; reviewed with 1, 5 and 5 stars.
  await buy(codes[1], buyers[0], "scan_only");
  await buy(codes[2], buyers[0], "pending");
  await buy(codes[3], buyers[1], "rejected");
  const ratings = [1, 5, 5];
  for (let i = 0; i < 3; i += 1) {
    const p = await buy(codes[4 + i], buyers[2 + i], "verified");
    await reviewIt(p as string, buyers[2 + i], ratings[i]);
  }

  const dash = await getDashboard(sql, { userId: owner, limits: MERCHANT_LIMITS });
  assert.equal(dash.length, 1);
  const biz = dash[0];
  assert.equal(biz.merchantId, merchantId);
  assert.ok(biz.termsAcceptedAt && biz.walkthroughAcceptedAt);
  const offer = biz.offers[0];
  assert.deepEqual(
    {
      made: offer.codesMade,
      opened: offer.codesOpened,
      claimed: offer.codesClaimed,
      pending: offer.purchasesPending,
      verified: offer.purchasesVerified,
      rejected: offer.purchasesRejected,
      reviews: offer.reviews,
    },
    { made: 7, opened: 6, claimed: 5, pending: 1, verified: 3, rejected: 1, reviews: 3 },
  );
  assert.deepEqual(offer.starCounts, [1, 0, 0, 0, 2]);
  // Ticket 7 (CFG-04): 4 claims not turned down; rewards on $4.50 = $2 floor each (pending on the typed amount).
  assert.deepEqual(offer.room, { claims: 4, maxReviews: 50, committedCents: 800, poolCents: 25000 });
  // Ticket 8: three verified reviews → three $2 payouts, held for the return window.
  assert.deepEqual(offer.money, { depositedCents: 25000, heldCents: 600, releasedCents: 0, paidCents: 0, forfeitedCents: 0 });

  assert.equal(biz.reviews.length, 3);
  assert.deepEqual(
    biz.reviews.map((r) => r.rating).sort(),
    [1, 5, 5],
  );
  // Rewarded reviews aren't shown to contacts yet (gap 18/19), and the dashboard says so.
  assert.ok(biz.reviews.every((r) => r.shownToContacts === false));
  // P5: nothing that identifies the reviewer reaches the business.
  const json = JSON.stringify(dash);
  for (let i = 1; i <= 6; i += 1) {
    assert.ok(!json.includes(`Buyer Name ${i}`), "reviewer name leaked");
    assert.ok(!json.includes(`buyer-d${i}`), "reviewer id leaked");
    assert.ok(!json.includes(`bd${i}@example.com`), "reviewer email leaked");
  }
  // FR-27: no payout fields on the dashboard yet.
  assert.ok(!/payout|reward|amount/i.test(Object.keys(offer).join(",")));
});

test("§13: an owner only ever sees their own businesses", async () => {
  const a = await readyBusiness("e1");
  const b = await readyBusiness("e2");
  const codes = await makeCodes(b.owner, b.campaignId, 1);
  const buyer = await account("buyer-e", "Buyer E", "be@example.com");
  const p = await buy(codes[0], buyer, "verified");
  await reviewIt(p as string, buyer, 2);

  const dashA = await getDashboard(sql, { userId: a.owner, limits: MERCHANT_LIMITS });
  assert.deepEqual(
    dashA.map((x) => x.merchantId),
    [a.merchantId],
  );
  assert.equal(dashA[0].reviews.length, 0);
  assert.equal(dashA[0].offers[0].codesMade, 0);

  const raw = await sql.query<{ campaign_id: string }>(`select campaign_id from trufolks_owner_offer_stats($1)`, [a.owner]);
  assert.ok(!raw.some((r) => r.campaign_id === b.campaignId));
  const rawReviews = await sql.query(`select 1 from trufolks_owner_reviews($1, 100) where merchant_id = $2`, [a.owner, b.merchantId]);
  assert.equal(rawReviews.length, 0);

  // A buyer, a stranger and the admin own nothing.
  for (const who of [buyer, "admin1", "nobody", ""]) {
    assert.deepEqual(await getDashboard(sql, { userId: who, limits: MERCHANT_LIMITS }), [], who);
  }
});
