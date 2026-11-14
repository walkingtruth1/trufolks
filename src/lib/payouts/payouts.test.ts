// Ticket 8 — the payout ledger against a throwaway in-memory PGlite with the
// real migrations 0001–0010. Purchases are made the real way: admin adds
// business + offer + deposit → owner accepts → codes → scan → claim → photo →
// admin confirms the receipt amount → review → payout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { saveConfig } from "../config/engine.ts";
import { PILOT_PRESET, type AppConfig } from "../config/preset.ts";
import { acceptMerchant, adminCreateBusiness, adminCreateOffer, getDashboard } from "../merchants/engine.ts";
import { MERCHANT_LIMITS } from "../merchants/limits.ts";
import { deriveHashKeys, hashIp } from "../receipt-codes/codes.ts";
import { claimCode, ensureDevice, generateCodes, scanCode } from "../receipt-codes/engine.ts";
import { RECEIPT_CODE_LIMITS, RECEIPT_PHOTO_LIMITS } from "../receipt-codes/limits.ts";
import { decidePurchase, storePhoto } from "../receipt-codes/photos.ts";
import { pgliteSql } from "../receipt-codes/test-support.ts";
import { submitReview } from "../reviews/engine.ts";
import { REVIEW_LIMITS } from "../reviews/limits.ts";
import { actOnPayout, adminOffers, adminPayouts, myPayouts, offerDepositedCents, ownerPayoutTotals, recordDeposit, releaseDuePayouts } from "./engine.ts";
import { PAYOUT_OUTCOMES, payoutMessage, payoutStatusText } from "./messages.ts";

const keys = deriveHashKeys("test-secret-not-real-0123456789abcdef");
const MIGRATIONS = [
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
  "0011_profiles_top5_catalog.sql",
  "0012_receipt_only_purchases.sql",
];

type Ctx = { db: PGlite; sql: Sql; seq: number };

async function fresh(settings?: (c: AppConfig) => void): Promise<Ctx> {
  const db = new PGlite();
  await db.waitReady;
  for (const name of MIGRATIONS) await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const ctx = { db, sql: pgliteSql(db), seq: 0 };
  await account(ctx, "admin1", "Jack", "jack@example.com");
  if (settings) {
    const next = structuredClone(PILOT_PRESET) as AppConfig;
    settings(next);
    assert.equal((await saveConfig(ctx.sql, { actorId: "admin1", settings: next, reason: "test settings" })).outcome, "ok");
  }
  return ctx;
}

async function account(c: Ctx, id: string, name: string, email: string): Promise<string> {
  await c.sql.query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, false, now(), now())`,
    [id, name, email],
  );
  return id;
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

/** A business with a live, funded offer and some codes. */
async function setup(c: Ctx, tag: string, opts: { deposit?: number | null; codes?: number } = {}) {
  const owner = await account(c, `owner-${tag}`, `Owner ${tag}`, `owner-${tag}@example.com`);
  const b = (await adminCreateBusiness(c.sql, { adminId: "admin1", ownerEmail: `owner-${tag}@example.com`, name: `Cafe ${tag}`, businessType: "" })) as {
    merchantId: string;
  };
  await acceptMerchant(c.sql, { userId: owner, merchantId: b.merchantId, what: "walkthrough" });
  await acceptMerchant(c.sql, { userId: owner, merchantId: b.merchantId, what: "terms" });
  const o = (await adminCreateOffer(c.sql, { adminId: "admin1", merchantId: b.merchantId, name: "Pilot", startsAt: daysFromNow(-1), endsAt: daysFromNow(10) })) as {
    campaignId: string;
  };
  if (opts.deposit !== null) {
    assert.equal(await recordDeposit(c.sql, { actorId: "admin1", campaignId: o.campaignId, amountCents: opts.deposit ?? 25000, note: "bank transfer" }), "ok");
  }
  const g = await generateCodes(c.sql, { userId: owner, campaignId: o.campaignId, count: opts.codes ?? 4, issueMode: "handout_batch", keys, limits: RECEIPT_CODE_LIMITS });
  assert.equal(g.outcome, "ok");
  return { owner, merchantId: b.merchantId, campaignId: o.campaignId, codes: (g as { codes: string[] }).codes };
}

function photo(c: Ctx): Uint8Array {
  c.seq += 1;
  const out = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0, 0, 0]);
  new DataView(out.buffer).setUint32(10, c.seq);
  return out;
}

/** Buy, confirm and review. Returns the purchase id, or the refusal. */
async function buyAndReview(c: Ctx, code: string, buyer: string, opts: { confirmed?: number; rating?: number; review?: boolean } = {}) {
  c.seq += 1;
  const ipHash = hashIp(`198.51.100.${c.seq % 250}-${c.seq}`, keys);
  const dev = await ensureDevice(c.sql, { rawToken: null, ipHash, limits: RECEIPT_CODE_LIMITS });
  assert.ok(dev.ok);
  const scan = await scanCode(c.sql, { rawCode: code, deviceId: dev.deviceId, ipHash, keys, limits: RECEIPT_CODE_LIMITS });
  if (scan.outcome !== "ok") return { outcome: scan.outcome };
  const claim = await claimCode(c.sql, {
    rawCode: code,
    deviceId: dev.deviceId,
    userId: buyer,
    ipHash,
    details: { productLabel: "Flat white", orderValueCents: opts.confirmed ?? 2500, currency: "USD", purchasedAt: new Date(Date.now() - 60_000).toISOString() },
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  if (claim.outcome !== "ok") return { outcome: claim.outcome };
  const purchaseId = (claim as { purchaseId: string }).purchaseId;
  assert.equal((await storePhoto(c.sql, { purchaseId, userId: buyer, photo: photo(c), header: null, limits: RECEIPT_PHOTO_LIMITS })).outcome, "ok");
  const d = await decidePurchase(c.sql, {
    purchaseId,
    adminUserId: "admin1",
    decision: "verified",
    reason: "",
    confirmedOrderValueCents: opts.confirmed ?? 2500,
    limits: RECEIPT_PHOTO_LIMITS,
  });
  assert.equal(d.outcome, "ok");
  if (opts.review === false) return { outcome: "ok", purchaseId };
  const r = await submitReview(c.sql, {
    purchaseId,
    userId: buyer,
    fields: { rating: opts.rating ?? 3, whatUsed: "A flat white", howLong: "One cup", honestThought: "Fine." },
    limits: REVIEW_LIMITS,
  });
  assert.equal(r.outcome, "ok");
  return { outcome: "ok", purchaseId, reviewId: (r as { review: { reviewId: string } }).review.reviewId };
}

async function payoutFor(c: Ctx, purchaseId: string) {
  const rows = await c.sql.query<{ id: string; status: string; amount_cents: number; hold_until: Date; flagged: boolean }>(
    `select id, status, amount_cents, hold_until, flagged from payouts where verified_purchase_id = $1`,
    [purchaseId],
  );
  return rows[0];
}

// ------------------------------------------------------------------ PAY-01 barrier, FR-27 decoupling

test("PAY-01: the functions that create and price a payout never mention the rating", async () => {
  const c = await fresh();
  const src = await c.sql.query<{ proname: string; prosrc: string }>(
    `select proname, prosrc from pg_proc where proname in
       ('trufolks_qualify_payout', 'trufolks_reviews_create_payout', 'trufolks_purchase_reward', 'trufolks_pay08_reward')`,
  );
  assert.equal(src.length, 4);
  for (const f of src) assert.ok(!/rating/i.test(f.prosrc), `${f.proname} mentions the rating`);
  // FR-27: the review record carries no payout data.
  const cols = await c.sql.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'reviews' and (column_name like '%payout%' or column_name like '%amount%' or column_name like '%reward%')`,
  );
  assert.deepEqual(cols, []);
  await c.db.close();
});

test("a posted review creates its payout automatically: same amount for 1 star and 5 stars, logged, held for the return window", async () => {
  const c = await fresh();
  const s = await setup(c, "a");
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const ben = await account(c, "ben", "Ben", "ben@example.com");
  const one = await buyAndReview(c, s.codes[0], ana, { rating: 1, confirmed: 2500 });
  const five = await buyAndReview(c, s.codes[1], ben, { rating: 5, confirmed: 2500 });
  const p1 = await payoutFor(c, one.purchaseId!);
  const p5 = await payoutFor(c, five.purchaseId!);
  assert.equal(p1.amount_cents, 500); // $25 × 20%
  assert.equal(p5.amount_cents, p1.amount_cents);
  assert.equal(p1.status, "held");

  const full = await c.sql.query<Record<string, unknown>>(`select * from payouts where id = $1`, [p1.id]);
  const row = full[0];
  assert.equal(row.review_id, one.reviewId);
  assert.equal(row.campaign_id, s.campaignId);
  assert.ok(row.receipt_code_id);
  assert.deepEqual([row.order_value_cents, row.percent_bp, row.floor_cents, row.cap_cents, row.currency], [2500, 2000, 200, 1500, "USD"]);
  const purchase = await c.sql.query<{ purchased_at: Date }>(`select purchased_at from verified_purchases where id = $1`, [one.purchaseId]);
  assert.equal(new Date(row.hold_until as string).getTime(), new Date(purchase[0].purchased_at).getTime() + 14 * 86400_000);

  // FR-22: logged against review, code, campaign and amount.
  const ev = await c.sql.query<{ event: string; review_id: string; receipt_code_id: string; campaign_id: string; amount_cents: number }>(
    `select event, review_id, receipt_code_id, campaign_id, amount_cents from payout_events where payout_id = $1 order by at`,
    [p1.id],
  );
  assert.deepEqual(
    ev.map((e) => e.event),
    ["qualified", "held"],
  );
  assert.ok(ev.every((e) => e.review_id === one.reviewId && e.campaign_id === s.campaignId && e.amount_cents === 500 && e.receipt_code_id));

  // Not due yet: nothing is released.
  assert.equal(await releaseDuePayouts(c.sql), 0);
  const mine = await myPayouts(c.sql, { userId: ana });
  assert.equal(mine.length, 1);
  assert.match(payoutStatusText(mine[0]), /^Qualified and held: \$5\.00, held until .* It's the same whatever rating you gave\.$/);
  await c.db.close();
});

test("the payout is a snapshot: later setting changes never change it (FR-27)", async () => {
  const c = await fresh();
  const s = await setup(c, "snap");
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const r = await buyAndReview(c, s.codes[0], ana, { confirmed: 10000 });
  const next = structuredClone(PILOT_PRESET) as AppConfig;
  next.payout.cap_cents = 2000;
  next.payout.percent_bp = 3000;
  await saveConfig(c.sql, { actorId: "admin1", settings: next, reason: "bigger rewards next time" });
  assert.equal((await payoutFor(c, r.purchaseId!)).amount_cents, 1500); // still the $15 cap of its own offer
  await assert.rejects(c.sql.query(`update payouts set amount_cents = 1 where verified_purchase_id = $1`, [r.purchaseId]));
  await assert.rejects(c.sql.query(`update payouts set hold_until = now() where verified_purchase_id = $1`, [r.purchaseId]));
  await assert.rejects(c.sql.query(`delete from payouts`));
  await assert.rejects(c.sql.query(`delete from payout_events`));
  await assert.rejects(c.sql.query(`update payout_events set reason = 'x'`));
  await c.db.close();
});

// ------------------------------------------------------------------ HON-09 hold / release / forfeit, RES-01 flag, paid

test("HON-09: released once the window passes; a flag holds it; marked paid is final", async () => {
  const c = await fresh((cfg) => (cfg.payout.hold_days = 0)); // window already over
  const s = await setup(c, "rel");
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const ben = await account(c, "ben", "Ben", "ben@example.com");
  const a = await buyAndReview(c, s.codes[0], ana);
  const b = await buyAndReview(c, s.codes[1], ben);
  const pa = await payoutFor(c, a.purchaseId!);
  const pb = await payoutFor(c, b.purchaseId!);

  // A flag before release keeps it held (RES-01(c)); the review stays.
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: { kind: "flag", reason: "" } }), "invalid");
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: { kind: "flag", reason: "Merchant says extortion; checking" } }), "ok");
  assert.equal(await releaseDuePayouts(c.sql), 1);
  assert.equal((await payoutFor(c, a.purchaseId!)).status, "released");
  assert.equal((await payoutFor(c, b.purchaseId!)).status, "held");
  assert.equal((await c.sql.query(`select 1 from reviews where id = $1`, [b.reviewId])).length, 1);
  assert.match(payoutStatusText((await myPayouts(c.sql, { userId: ben }))[0]), /^On hold/);

  // Mark paid: only once released; needs how; final.
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: { kind: "paid", method: "cash", reference: "" } }), "wrong_status");
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pa.id, action: { kind: "paid", method: " ", reference: "" } }), "invalid");
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pa.id, action: { kind: "paid", method: "Store credit", reference: "till 1234" } }), "ok");
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pa.id, action: { kind: "flag", reason: "late" } }), "wrong_status");
  const paid = (await myPayouts(c.sql, { userId: ana }))[0];
  assert.equal(paid.status, "paid");
  assert.match(payoutStatusText(paid), /^Paid: \$5\.00 on .*\(Store credit\)\.$/);

  // Clear the flag → released on the next run.
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: { kind: "clear_flag", reason: "No evidence of extortion" } }), "ok");
  await myPayouts(c.sql, { userId: ben });
  assert.equal((await payoutFor(c, b.purchaseId!)).status, "released");
  // A released payout can be flagged back to held before it's paid.
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: { kind: "flag", reason: "New evidence" } }), "ok");
  assert.equal((await payoutFor(c, b.purchaseId!)).status, "held");

  const log = await c.sql.query<{ event: string; actor_user_id: string | null; reason: string | null }>(
    `select event, actor_user_id, reason from payout_events where payout_id = $1 order by at`,
    [pb.id],
  );
  assert.deepEqual(
    log.map((l) => [l.event, l.actor_user_id]),
    [
      ["qualified", null],
      ["held", null],
      ["flagged", "admin1"],
      ["flag_cleared", "admin1"],
      ["released", null],
      ["flagged", "admin1"],
    ],
  );
  // Returned after the window can't forfeit (no clawback after the window — undecided).
  assert.equal(
    await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: { kind: "forfeit", forfeitKind: "returned", reason: "Came back late" } }),
    "window_passed",
  );
  await c.db.close();
});

test("HON-09: a return inside the window forfeits to $0, frees the budget, and the review stays up; a breach needs a flag first", async () => {
  const c = await fresh();
  const s = await setup(c, "ret");
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const ben = await account(c, "ben", "Ben", "ben@example.com");
  const a = await buyAndReview(c, s.codes[0], ana, { rating: 1, confirmed: 10000 });
  const b = await buyAndReview(c, s.codes[1], ben);
  const pa = await payoutFor(c, a.purchaseId!);
  const pb = await payoutFor(c, b.purchaseId!);
  const before = (await adminOffers(c.sql)).find((o) => o.campaignId === s.campaignId)!;
  assert.equal(before.committedCents, 2000); // $15 + $5

  assert.equal(
    await actOnPayout(c.sql, { actorId: "admin1", payoutId: pa.id, action: { kind: "forfeit", forfeitKind: "returned", reason: "Shop says it was refunded on day 2" } }),
    "ok",
  );
  const after = (await adminOffers(c.sql)).find((o) => o.campaignId === s.campaignId)!;
  assert.equal(after.committedCents, 500);
  assert.equal((await c.sql.query(`select 1 from reviews where id = $1`, [a.reviewId])).length, 1);
  const mine = (await myPayouts(c.sql, { userId: ana }))[0];
  assert.equal(mine.status, "forfeited");
  assert.match(payoutStatusText(mine), /returned within the return window\. Your review stays up\.$/);
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pa.id, action: { kind: "clear_flag", reason: "x" } }), "wrong_status");

  // Policy breach: refused without a flag, allowed after.
  const breach = { kind: "forfeit" as const, forfeitKind: "policy_breach" as const, reason: "Demanded a refund to remove the review (thread evidence)" };
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: breach }), "needs_flag");
  await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: { kind: "flag", reason: "Extortion claim with evidence" } });
  assert.equal(await actOnPayout(c.sql, { actorId: "admin1", payoutId: pb.id, action: breach }), "ok");
  assert.equal(await actOnPayout(c.sql, { actorId: "nobody", payoutId: "missing", action: breach }), "not_found");
  await c.db.close();
});

// ------------------------------------------------------------------ MER-06 deposits

test("MER-06: deposits are logged, can't pass the pool setting, and an unfunded offer takes no claims", async () => {
  const c = await fresh();
  const s = await setup(c, "dep", { deposit: 2000 });
  assert.equal(await offerDepositedCents(c.sql, s.campaignId), 2000);
  assert.equal(await recordDeposit(c.sql, { actorId: "admin1", campaignId: s.campaignId, amountCents: 23001, note: "too much" }), "over_pool");
  assert.equal(await recordDeposit(c.sql, { actorId: "admin1", campaignId: s.campaignId, amountCents: 0, note: "zero" }), "invalid");
  assert.equal(await recordDeposit(c.sql, { actorId: "admin1", campaignId: s.campaignId, amountCents: 100, note: " " }), "invalid");
  assert.equal(await recordDeposit(c.sql, { actorId: "admin1", campaignId: "nope", amountCents: 100, note: "x" }), "not_found");
  await assert.rejects(c.sql.query(`delete from offer_deposits`));
  await assert.rejects(c.sql.query(`update offer_deposits set amount_cents = 1`));

  // Budget is the deposit ($20): one $15 reward fits, a second doesn't.
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const ben = await account(c, "ben", "Ben", "ben@example.com");
  assert.equal((await buyAndReview(c, s.codes[0], ana, { confirmed: 10000 })).outcome, "ok");
  assert.equal((await buyAndReview(c, s.codes[1], ben, { confirmed: 10000 })).outcome, "campaign_full");

  // An unfunded offer: the server refuses codes (checked via offerDepositedCents), and the
  // database budget is $0, so even an existing code can't be claimed.
  const u = await setup(c, "unfunded", { deposit: null, codes: 1 });
  assert.equal(await offerDepositedCents(c.sql, u.campaignId), 0);
  const cleo = await account(c, "cleo", "Cleo", "cleo@example.com");
  assert.equal((await buyAndReview(c, u.codes[0], cleo)).outcome, "campaign_full");
  await c.db.close();
});

// ------------------------------------------------------------------ who sees what

test("each person sees only their own payouts; each owner only their own totals; the team sees everything", async () => {
  const c = await fresh();
  const s1 = await setup(c, "o1");
  const s2 = await setup(c, "o2");
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const ben = await account(c, "ben", "Ben", "ben@example.com");
  await buyAndReview(c, s1.codes[0], ana);
  await buyAndReview(c, s2.codes[0], ben, { confirmed: 500 });

  assert.deepEqual(
    (await myPayouts(c.sql, { userId: ana })).map((p) => p.merchantName),
    ["Cafe o1"],
  );
  assert.deepEqual(await myPayouts(c.sql, { userId: "nobody" }), []);
  const t1 = await ownerPayoutTotals(c.sql, { userId: s1.owner });
  assert.deepEqual([...t1.keys()], [s1.campaignId]);
  assert.deepEqual(t1.get(s1.campaignId), { depositedCents: 25000, heldCents: 500, releasedCents: 0, paidCents: 0, forfeitedCents: 0 });
  assert.equal((await ownerPayoutTotals(c.sql, { userId: ana })).size, 0);
  const dash = await getDashboard(c.sql, { userId: s2.owner, limits: MERCHANT_LIMITS });
  assert.equal(dash[0].offers[0].money.heldCents, 200); // $5 order → $2 floor
  assert.ok(!JSON.stringify(dash).includes("Ben"));

  const all = await adminPayouts(c.sql);
  assert.equal(all.length, 2);
  assert.ok(all.some((p) => p.personEmail === "ana@example.com"));
  await c.db.close();
});

test("a review of a purchase outside any offer creates no payout; every payout outcome has a plain message", async () => {
  const c = await fresh();
  await account(c, "own", "Own", "own@example.com");
  await c.sql.query(`insert into merchants (id, owner_user_id, name, verification_status) values ('m-x', 'own', 'Shop', 'verified')`);
  await account(c, "ana", "Ana", "ana@example.com");
  await c.sql.query(
    `insert into verified_purchases (id, user_id, merchant_id, product_label, order_value_cents, verification_method, verification_status, purchased_at, verified_at)
     values ('vp-x', 'ana', 'm-x', 'Bread', 300, 'receipt_photo', 'verified', now(), now())`,
  );
  const r = await submitReview(c.sql, {
    purchaseId: "vp-x",
    userId: "ana",
    fields: { rating: 2, whatUsed: "Bread", howLong: "A loaf", honestThought: "Dry." },
    limits: REVIEW_LIMITS,
  });
  assert.equal(r.outcome, "ok");
  assert.equal((await c.sql.query(`select 1 from payouts`)).length, 0);
  for (const o of PAYOUT_OUTCOMES) if (o !== "ok") assert.ok((payoutMessage(o) ?? "").length > 10, o);
  await c.db.close();
});
