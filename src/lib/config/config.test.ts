// Ticket 7 — settings, toggle log, startup validation, cooling-off, offer
// pinning, PAY-08, offer caps and the full disclosure. Each test gets its own
// throwaway in-memory PGlite with the real migrations 0001–0010 (offers are
// funded with a deposit, Ticket 8). Purchases are
// made the real way: admin adds business + offer → owner accepts → codes →
// scan → claim → photo → admin decides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { contactFeed } from "../contacts/engine.ts";
import { CONTACT_LIMITS } from "../contacts/limits.ts";
import { acceptMerchant, adminCreateBusiness, adminCreateOffer } from "../merchants/engine.ts";
import { recordDeposit } from "../payouts/engine.ts";
import { deriveHashKeys, hashIp } from "../receipt-codes/codes.ts";
import { claimCode, ensureDevice, generateCodes, scanCode } from "../receipt-codes/engine.ts";
import { RECEIPT_CODE_LIMITS, RECEIPT_PHOTO_LIMITS } from "../receipt-codes/limits.ts";
import { decidePurchase, storePhoto } from "../receipt-codes/photos.ts";
import { pgliteSql } from "../receipt-codes/test-support.ts";
import { disclosureLines, parseDisclosure } from "../reviews/disclosure.ts";
import { getReviewStart, submitReview } from "../reviews/engine.ts";
import { REVIEW_LIMITS } from "../reviews/limits.ts";
import {
  checkStoredConfig,
  codeLimitsFrom,
  finishPendingDisclosures,
  getSettingsAdminView,
  loadCampaignConfig,
  loadEffectiveConfig,
  saveConfig,
} from "./engine.ts";
import { formatFieldValue, parseFieldInput, SETTING_FIELDS } from "./fields.ts";
import { CONFIG_OUTCOMES, configMessage } from "./messages.ts";
import { formulaText, pay08Reward, percentText, PILOT_PRESET, PILOT_PRESET_ID, type AppConfig } from "./preset.ts";
import { diffConfig, validateConfig } from "./validate.ts";

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

async function fresh(): Promise<Ctx> {
  const db = new PGlite();
  await db.waitReady;
  for (const name of MIGRATIONS) await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const ctx = { db, sql: pgliteSql(db), seq: 0 };
  await account(ctx, "admin1", "Jack", "jack@example.com");
  return ctx;
}

async function account(c: Ctx, id: string, name: string, email: string): Promise<string> {
  await c.sql.query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, false, now(), now())`,
    [id, name, email],
  );
  return id;
}

const clone = (cfg: AppConfig = PILOT_PRESET): AppConfig => structuredClone(cfg) as AppConfig;
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

async function business(c: Ctx, tag: string): Promise<{ owner: string; merchantId: string }> {
  const owner = await account(c, `owner-${tag}`, `Owner ${tag}`, `owner-${tag}@example.com`);
  const b = (await adminCreateBusiness(c.sql, { adminId: "admin1", ownerEmail: `owner-${tag}@example.com`, name: `Cafe ${tag}`, businessType: "" })) as {
    merchantId: string;
  };
  assert.equal(await acceptMerchant(c.sql, { userId: owner, merchantId: b.merchantId, what: "walkthrough" }), "ok");
  assert.equal(await acceptMerchant(c.sql, { userId: owner, merchantId: b.merchantId, what: "terms" }), "ok");
  return { owner, merchantId: b.merchantId };
}

async function offer(c: Ctx, merchantId: string): Promise<string> {
  const o = await adminCreateOffer(c.sql, { adminId: "admin1", merchantId, name: "Pilot", startsAt: daysFromNow(-1), endsAt: daysFromNow(10) });
  assert.equal(o.outcome, "ok");
  const campaignId = (o as { campaignId: string }).campaignId;
  // Ticket 8 (MER-06): fund the offer up to its pool setting.
  const pool = (await loadCampaignConfig(c.sql, campaignId)).config.campaign.pool_cents;
  assert.equal(await recordDeposit(c.sql, { actorId: "admin1", campaignId, amountCents: pool, note: "test deposit" }), "ok");
  return campaignId;
}

async function codes(c: Ctx, owner: string, campaignId: string, n: number): Promise<string[]> {
  const g = await generateCodes(c.sql, { userId: owner, campaignId, count: n, issueMode: "handout_batch", keys, limits: RECEIPT_CODE_LIMITS });
  assert.equal(g.outcome, "ok");
  return (g as { codes: string[] }).codes;
}

function photo(c: Ctx): Uint8Array {
  c.seq += 1;
  const out = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0, 0, 0]);
  new DataView(out.buffer).setUint32(10, c.seq);
  return out;
}

/** Scan + claim (typed amount) and optionally confirm with an amount read off the receipt. */
async function buy(
  c: Ctx,
  code: string,
  buyer: string,
  opts: { typed?: number; confirmed?: number | null } = {},
): Promise<{ outcome: string; purchaseId?: string }> {
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
    details: { productLabel: "Flat white", orderValueCents: opts.typed ?? 450, currency: "USD", purchasedAt: new Date(Date.now() - 60_000).toISOString() },
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  if (claim.outcome !== "ok") return { outcome: claim.outcome };
  const purchaseId = (claim as { purchaseId: string }).purchaseId;
  if (opts.confirmed === null) return { outcome: "ok", purchaseId };
  assert.equal((await storePhoto(c.sql, { purchaseId, userId: buyer, photo: photo(c), header: null, limits: RECEIPT_PHOTO_LIMITS })).outcome, "ok");
  const d = await decidePurchase(c.sql, {
    purchaseId,
    adminUserId: "admin1",
    decision: "verified",
    reason: "",
    confirmedOrderValueCents: opts.confirmed ?? opts.typed ?? 450,
    limits: RECEIPT_PHOTO_LIMITS,
  });
  assert.equal(d.outcome, "ok");
  return { outcome: "ok", purchaseId };
}

async function review(c: Ctx, purchaseId: string, buyer: string, rating: number) {
  return submitReview(c.sql, {
    purchaseId,
    userId: buyer,
    fields: { rating, whatUsed: "A flat white", howLong: "One cup", honestThought: "Fine." },
    limits: REVIEW_LIMITS,
  });
}

// ------------------------------------------------------------------ preset, validation, PAY-08 (pure)

test("the seeded settings equal the code's pilot preset, and the code limits fallback matches it", async () => {
  const c = await fresh();
  const rows = await c.sql.query<{ settings: unknown; created_by: string | null }>(`select settings, created_by from config_versions where id = $1`, [
    PILOT_PRESET_ID,
  ]);
  assert.deepEqual(rows[0].settings, PILOT_PRESET);
  assert.equal(rows[0].created_by, null);
  assert.deepEqual(codeLimitsFrom(PILOT_PRESET), RECEIPT_CODE_LIMITS);
  const loaded = await loadEffectiveConfig(c.sql);
  assert.equal(loaded.versionId, PILOT_PRESET_ID);
  assert.equal(loaded.source, "db");
  await c.db.close();
});

test("the pilot preset is valid; unknown keys, bad ranges and undecided options are refused", () => {
  assert.equal(validateConfig(PILOT_PRESET).ok, true);
  const bad = (mutate: (x: Record<string, any>) => void) => {
    const x = clone() as unknown as Record<string, any>;
    mutate(x);
    const v = validateConfig(x);
    assert.equal(v.ok, false);
    return v as { ok: false; errors: string[]; guardrail: boolean };
  };
  assert.equal(bad((x) => (x.surprise = 1)).guardrail, false);
  assert.equal(bad((x) => (x.payout.extra = 1)).guardrail, false);
  assert.equal(bad((x) => (x.payout.floor_cents = 2000)).guardrail, false); // floor > cap
  assert.equal(bad((x) => (x.payout.percent_bp = 0)).guardrail, false);
  assert.equal(bad((x) => (x.payout.percent_bp = 20.5)).guardrail, false);
  assert.equal(bad((x) => (x.eligibility.types = ["A", "B"])).guardrail, false); // Type B undecided
  assert.equal(bad((x) => (x.visibility.scope = "public")).guardrail, false); // not built
  assert.equal(bad((x) => (x.review_format.video_extra_tier = true)).guardrail, false); // D2
  assert.equal(bad((x) => (x.review_format.text_qualifies = false)).guardrail, false); // FR-12
  assert.equal(bad((x) => (x.split_test.unit = "individual")).guardrail, false); // CFG-09
  assert.equal(bad((x) => delete x.fraud).guardrail, false);
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig([]).ok, false);
});

test("CFG-12: anything touching a guardrail is refused and flagged as a guardrail", () => {
  const guard = (mutate: (x: Record<string, any>) => void) => {
    const x = clone() as unknown as Record<string, any>;
    mutate(x);
    const v = validateConfig(x);
    assert.equal(v.ok, false);
    assert.equal((v as { guardrail: boolean }).guardrail, true, JSON.stringify((v as { errors: string[] }).errors));
  };
  guard((x) => (x.payout.rating_multiplier = 2)); // PAY-01
  guard((x) => (x.payout.mode = "flat"));
  guard((x) => (x.campaign.min_rating = 4));
  guard((x) => (x.fraud.single_use_codes = false)); // FR-08
  guard((x) => (x.fraud.photo_for_handout_codes = false)); // FR-08a
  guard((x) => (x.fraud.device_binding = false)); // HON-07
  guard((x) => (x.disclosure.hide_disclosure = true)); // LEG-01
  guard((x) => (x.disclosure.lines = ["Thanks for your review!"])); // LEG-03: no formula / amount
  guard((x) => (x.disclosure.lines = ["{percent} {floor} {cap} {amount}"])); // no "same for 1 star or 5"
  guard((x) => (x.funding.merchant_can_remove = true)); // MER-07
  guard((x) => (x.split_test.draw = true)); // D1
});

test("PAY-08 worked examples, in code and in the database; the database function takes no rating (PAY-01)", async () => {
  const p = PILOT_PRESET.payout;
  assert.equal(pay08Reward(500, p), 200); // $5 → 20% = $1 → floor $2
  assert.equal(pay08Reward(2500, p), 500); // $25 → $5
  assert.equal(pay08Reward(10000, p), 1500); // $100 → $20 → cap $15
  assert.equal(pay08Reward(1234, p), 247); // 246.8 → nearest cent
  assert.equal(percentText(2000), "20%");
  assert.equal(percentText(1250), "12.5%");
  assert.match(formulaText({ percentBp: 2000, floorCents: 200, capCents: 1500, currency: "USD" }), /20% of what you spend — at least \$2\.00 and at most \$15\.00\. It's the same for 1 star or 5\./);
  const c = await fresh();
  for (const order of [0, 500, 1234, 2500, 7499, 10000, 999999]) {
    const r = await c.sql.query<{ v: number }>(`select trufolks_pay08_reward($1, 2000, 200, 1500) as v`, [order]);
    assert.equal(r[0].v, pay08Reward(order, p), String(order));
  }
  const args = await c.sql.query<{ args: string }>(
    `select pg_get_function_arguments(oid) as args from pg_proc where proname in ('trufolks_pay08_reward', 'trufolks_purchase_reward')`,
  );
  for (const a of args) assert.ok(!/rating/i.test(a.args), a.args);
  await c.db.close();
});

test("form fields cover every editable setting and round-trip their values", () => {
  const paths = new Set(SETTING_FIELDS.map((f) => f.path));
  const leaves = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
      : [prefix];
  for (const key of leaves(PILOT_PRESET)) assert.ok(paths.has(key) || key === "schema", key);
  assert.deepEqual(diffConfig(PILOT_PRESET, PILOT_PRESET), []);
  for (const f of SETTING_FIELDS) {
    if (f.kind === "locked" || f.kind === "bool") continue;
    const shown = formatFieldValue(f, (f.path.split(".") as string[]).reduce<any>((o, k) => o[k], PILOT_PRESET));
    assert.deepEqual(parseFieldInput(f, shown), f.path.split(".").reduce<any>((o, k) => o[k], PILOT_PRESET), f.path);
  }
  const money = SETTING_FIELDS.find((f) => f.kind === "money")!;
  assert.equal(parseFieldInput(money, "$2.5"), 250);
  assert.equal(parseFieldInput(money, "abc"), null);
  for (const o of CONFIG_OUTCOMES) if (o !== "ok") assert.ok((configMessage(o) ?? "").length > 10, o);
});

// ------------------------------------------------------------------ saving, log, cooling-off (CFG-01, CFG-13)

test("saving: reason required, refusals logged, changes logged per setting, 24h wait only for global changes while an offer is live", async () => {
  const c = await fresh();
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: clone(), reason: "  " })).outcome, "reason_missing");
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: clone(), reason: "same" })).outcome, "no_change");

  const evil = clone() as unknown as Record<string, any>;
  evil.payout.rating_multiplier = 2;
  const refused = await saveConfig(c.sql, { actorId: "admin1", settings: evil, reason: "try it" });
  assert.equal(refused.outcome, "invalid");
  assert.equal((refused as { guardrail: boolean }).guardrail, true);
  const refusedLog = await c.sql.query<{ event: string; reason: string }>(`select event, reason from config_log where event = 'refused'`);
  assert.equal(refusedLog.length, 1);
  assert.match(refusedLog[0].reason, /Guardrail/);

  // No live offer: a global change is in force at once.
  const a = clone();
  a.fraud.max_failures_per_device = 7;
  const s1 = await saveConfig(c.sql, { actorId: "admin1", settings: a, reason: "Pilot feedback" });
  assert.equal(s1.outcome, "ok");
  assert.equal((s1 as { coolingOff: boolean }).coolingOff, false);
  assert.equal((await loadEffectiveConfig(c.sql)).config.fraud.max_failures_per_device, 7);
  const log = await c.sql.query<{ setting_key: string; old_value: unknown; new_value: unknown; actor_user_id: string; reason: string }>(
    `select setting_key, old_value, new_value, actor_user_id, reason from config_log where event = 'changed'`,
  );
  assert.deepEqual(log, [{ setting_key: "fraud.max_failures_per_device", old_value: 5, new_value: 7, actor_user_id: "admin1", reason: "Pilot feedback" }]);

  // A live offer: an offer-only change is in force now (applies to new offers)...
  const { merchantId } = await business(c, "a");
  await offer(c, merchantId);
  const b = clone(a);
  b.campaign.max_reviews = 40;
  const s2 = await saveConfig(c.sql, { actorId: "admin1", settings: b, reason: "Smaller next offer" });
  assert.equal((s2 as { coolingOff: boolean }).coolingOff, false);
  // ...but a global change waits 24 hours, and blocks another change meanwhile.
  const g = clone(b);
  g.disclosure.wording_approved = true;
  const s3 = await saveConfig(c.sql, { actorId: "admin1", settings: g, reason: "Lawyer signed off" });
  assert.equal(s3.outcome, "ok");
  assert.equal((s3 as { coolingOff: boolean }).coolingOff, true);
  const wait = new Date((s3 as { effectiveAt: string }).effectiveAt).getTime() - Date.now();
  assert.ok(wait > 23.9 * 3600_000 && wait <= 24 * 3600_000, String(wait));
  assert.equal((await loadEffectiveConfig(c.sql)).config.disclosure.wording_approved, false);
  const another = clone(b);
  another.campaign.max_reviews = 30;
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: another, reason: "again" })).outcome, "pending_exists");
  const view = await getSettingsAdminView(c.sql);
  assert.ok(view.pending);
  const cooled = await c.sql.query<{ n: number }>(`select count(*)::int as n from config_log where event = 'changed' and cooling_off_started_at is not null`);
  assert.equal(cooled[0].n, 1);

  // Nothing in the history can be edited or deleted.
  await assert.rejects(c.sql.query(`update config_versions set settings = '{}'::jsonb`));
  await assert.rejects(c.sql.query(`update config_versions set effective_at = now()`));
  await assert.rejects(c.sql.query(`delete from config_versions`));
  await assert.rejects(c.sql.query(`delete from config_log`));
  await assert.rejects(c.sql.query(`update config_log set reason = 'x'`));
  await c.db.close();
});

test("CFG-13: a live offer keeps the settings it was made under; new offers get the new ones", async () => {
  const c = await fresh();
  const { owner, merchantId } = await business(c, "p");
  const oldOffer = await offer(c, merchantId);
  const next = clone();
  next.payout.percent_bp = 1000;
  next.payout.floor_cents = 100;
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: next, reason: "Try 10%" })).outcome, "ok");
  const newOffer = await offer(c, merchantId);

  assert.equal((await loadCampaignConfig(c.sql, oldOffer)).config.payout.percent_bp, 2000);
  assert.equal((await loadCampaignConfig(c.sql, newOffer)).config.payout.percent_bp, 1000);
  await assert.rejects(c.sql.query(`update campaigns set config_preset_id = $2 where id = $1`, [oldOffer, (await loadCampaignConfig(c.sql, newOffer)).versionId]));

  // The reward follows the offer's own formula: $25 → 20% = $5 on the old offer, 10% = $2.50 on the new.
  const buyer = await account(c, "buyer-p", "Buyer", "bp@example.com");
  const [c1] = await codes(c, owner, oldOffer, 1);
  const [c2] = await codes(c, owner, newOffer, 1);
  const p1 = (await buy(c, c1, buyer, { typed: 2500 })).purchaseId!;
  const p2 = (await buy(c, c2, buyer, { typed: 2500 })).purchaseId!;
  const r1 = await c.sql.query<{ r_amount_cents: number }>(`select * from trufolks_purchase_reward($1)`, [p1]);
  const r2 = await c.sql.query<{ r_amount_cents: number }>(`select * from trufolks_purchase_reward($1)`, [p2]);
  assert.equal(r1[0].r_amount_cents, 500);
  assert.equal(r2[0].r_amount_cents, 250);
  await c.db.close();
});

// ------------------------------------------------------------------ startup validation (CFG-01)

test("startup validation: an invalid stored version is rejected, logged, and the last valid one is used — no crash", async () => {
  const c = await fresh();
  const good = clone();
  good.fraud.max_failures_per_ip = 30;
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: good, reason: "ok change" })).outcome, "ok");
  // Someone writes straight to the database, bypassing the app: a rating bonus.
  const evil = clone(good) as unknown as Record<string, any>;
  evil.payout.rating_bonus = 500;
  await c.sql.query(`insert into config_versions (id, settings, reason, effective_at) values ('evil', $1::jsonb, 'direct write', now())`, [
    JSON.stringify(evil),
  ]);
  const before = await c.sql.query<{ version_id: string }>(`select version_id from trufolks_effective_config()`);
  assert.equal(before[0].version_id, "evil"); // the database alone would pick it...

  assert.deepEqual(await checkStoredConfig(c.sql), ["evil"]); // ...until the check runs
  const loaded = await loadEffectiveConfig(c.sql);
  assert.notEqual(loaded.versionId, "evil");
  assert.equal(loaded.config.fraud.max_failures_per_ip, 30);
  const logged = await c.sql.query<{ version_id: string; reason: string }>(`select version_id, reason from config_log where event = 'rejected_at_startup'`);
  assert.equal(logged[0].version_id, "evil");
  assert.match(logged[0].reason, /guardrail/i);
  assert.equal((await getSettingsAdminView(c.sql)).rejected[0].versionId, "evil");
  assert.deepEqual(await checkStoredConfig(c.sql), []); // rejected once only
  await assert.rejects(c.sql.query(`update config_versions set status = 'accepted', rejected_at = null where id = 'evil'`));

  // If nothing stored is valid, the built-in pilot preset is used.
  await c.sql.query(`insert into config_versions (id, settings, reason, effective_at) values ('junk', '{"schema": 2}'::jsonb, 'x', now())`);
  for (const id of ["junk"]) assert.ok((await checkStoredConfig(c.sql)).includes(id));
  await c.db.exec(`alter table config_versions disable trigger config_versions_guard`);
  await c.sql.query(`update config_versions set status = 'rejected', rejected_at = now() where status = 'accepted'`);
  await c.db.exec(`alter table config_versions enable trigger config_versions_guard`);
  const fallback = await loadEffectiveConfig(c.sql);
  assert.equal(fallback.source, "builtin");
  assert.deepEqual(fallback.config, PILOT_PRESET);
  await c.db.close();
});

// ------------------------------------------------------------------ the disclosure (LEG-01, LEG-03; gaps 19–21)

test("the disclosure states the formula and the amount; contacts see it only after the wording is approved and earlier reviews are finished", async () => {
  const c = await fresh();
  const { owner, merchantId } = await business(c, "d");
  const campaignId = await offer(c, merchantId);
  const [k1, k2] = await codes(c, owner, campaignId, 2);
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const ben = await account(c, "ben", "Ben", "ben@example.com");
  // Ana and Ben are mutual contacts.
  await c.sql.query(`insert into contacts (owner_user_id, contact_user_id, status) values ('ana','ben','accepted'), ('ben','ana','accepted')`);

  // Typed $5, receipt says $100 → the confirmed amount counts: capped at $15.
  const p1 = (await buy(c, k1, ana, { typed: 500, confirmed: 10000 })).purchaseId!;
  const start = await getReviewStart(c.sql, { purchaseId: p1, userId: ana });
  assert.equal(start.outcome, "ok");
  const pre = (start as { start: { disclosure: ReturnType<typeof parseDisclosure> } }).start.disclosure!;
  assert.equal(pre.reward.status, "set");
  assert.equal(pre.reward.amountCents, 1500);
  assert.equal(pre.complete, false); // wording not approved yet
  assert.deepEqual(disclosureLines(pre), [
    "Cafe d pays people back for honest reviews of things they bought.",
    "The amount is the same whether they give 1 star or 5.",
    "How it is worked out: 20% of what they spent, at least $2.00 and at most $15.00.",
    "For this review: $15.00.",
  ]);

  const posted = await review(c, p1, ana, 1);
  assert.equal(posted.outcome, "ok");
  const r1 = (posted as { review: { reviewId: string; disclosure: { complete: boolean } } }).review;
  assert.equal(r1.disclosure.complete, false);
  assert.equal((await contactFeed(c.sql, { viewerId: ben, limits: CONTACT_LIMITS })).reviews.length, 0);
  // Not ready: finishing does nothing yet.
  assert.equal(await finishPendingDisclosures(c.sql, { actorId: "admin1" }), 0);

  // The lawyer signs off. No live offer → in force now (end the offer for the test).
  await c.sql.query(`update campaigns set status = 'ended' where id = $1`, [campaignId]);
  const approved = clone();
  approved.disclosure.wording_approved = true;
  approved.disclosure.wording_version = "lawyer-1";
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: approved, reason: "Lawyer approved" })).outcome, "ok");

  assert.equal(await finishPendingDisclosures(c.sql, { actorId: "admin1" }), 1);
  const feed = await contactFeed(c.sql, { viewerId: ben, limits: CONTACT_LIMITS });
  assert.deepEqual(
    feed.reviews.map((r) => r.reviewId),
    [r1.reviewId],
  );
  assert.equal(feed.reviews[0].disclosure?.wording?.version, "lawyer-1");
  assert.equal(feed.reviews[0].disclosure?.reward.amountCents, 1500);
  assert.equal(feed.reviews[0].rating, 1);
  const ev = await c.sql.query<{ event: string; actor_user_id: string }>(`select event, actor_user_id from review_events where review_id = $1 order by at`, [
    r1.reviewId,
  ]);
  assert.deepEqual(
    ev.map((e) => [e.event, e.actor_user_id]),
    [
      ["submitted", null],
      ["disclosure_completed", "admin1"],
    ],
  );
  const logged = await c.sql.query(`select 1 from config_log where event = 'disclosures_completed'`);
  assert.equal(logged.length, 2);

  // A review posted now is complete at once. (Re-open the offer to buy.)
  await c.db.exec(`alter table campaigns disable trigger campaigns_pin_locked`);
  await c.sql.query(`update campaigns set status = 'live' where id = $1`, [campaignId]);
  await c.db.exec(`alter table campaigns enable trigger campaigns_pin_locked`);
  const p2 = (await buy(c, k2, ana, { typed: 2500 })).purchaseId!;
  const r2 = await review(c, p2, ana, 5);
  assert.equal((r2 as { review: { disclosure: { complete: boolean; reward: { amountCents: number } } } }).review.disclosure.complete, true);
  assert.equal((r2 as { review: { disclosure: { reward: { amountCents: number } } } }).review.disclosure.reward.amountCents, 500);

  // FR-15 still holds: a completed disclosure, rating and text can't be changed.
  await assert.rejects(c.sql.query(`update reviews set disclosure = disclosure || '{"merchant_name": "Other"}'::jsonb where id = $1`, [r1.reviewId]));
  await assert.rejects(c.sql.query(`update reviews set disclosure = jsonb_set(disclosure, '{reward,amount_cents}', '1'::jsonb) where id = $1`, [r1.reviewId]));
  await assert.rejects(c.sql.query(`update reviews set rating = 5 where id = $1`, [r1.reviewId]));
  await c.db.close();
});

test("an incomplete disclosure can't be 'completed' with changed facts", async () => {
  const c = await fresh();
  const { owner, merchantId } = await business(c, "t");
  const campaignId = await offer(c, merchantId);
  const [k] = await codes(c, owner, campaignId, 1);
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const p = (await buy(c, k, ana, { typed: 2500 })).purchaseId!;
  const r = (await review(c, p, ana, 3)) as { review: { reviewId: string } };
  const id = r.review.reviewId;
  // complete=true but the merchant name changed → refused.
  await assert.rejects(
    c.sql.query(`update reviews set disclosure = disclosure || '{"complete": true, "merchant_name": "Fake"}'::jsonb where id = $1`, [id]),
  );
  // complete=true with a different amount than the one already set → refused.
  await assert.rejects(
    c.sql.query(
      `update reviews set disclosure = jsonb_set(disclosure || '{"complete": true}'::jsonb, '{reward,amount_cents}', '9999'::jsonb) where id = $1`,
      [id],
    ),
  );
  await c.db.close();
});

test("gap 20: a review can't be started while the amount can't be worked out", async () => {
  const c = await fresh();
  const { owner, merchantId } = await business(c, "g");
  // An offer pinned (by a direct write) to settings with no payout section.
  const broken = clone() as unknown as Record<string, any>;
  delete broken.payout;
  await c.sql.query(`insert into config_versions (id, settings, reason, effective_at) values ('no-payout', $1::jsonb, 'direct', now() - interval '1 day')`, [
    JSON.stringify(broken),
  ]);
  await c.db.exec(`alter table config_versions disable trigger config_versions_guard`);
  await c.sql.query(`update config_versions set created_at = now() + interval '1 hour' where id = 'no-payout'`);
  await c.db.exec(`alter table config_versions enable trigger config_versions_guard`);
  const campaignId = await offer(c, merchantId);
  await c.db.exec(`alter table campaigns disable trigger campaigns_pin_locked`);
  await c.sql.query(`update campaigns set config_preset_id = 'no-payout' where id = $1`, [campaignId]);
  await c.db.exec(`alter table campaigns enable trigger campaigns_pin_locked`);

  const [k] = await codes(c, owner, campaignId, 1);
  const ana = await account(c, "ana", "Ana", "ana@example.com");
  const p = (await buy(c, k, ana, { typed: 2500 })).purchaseId!;
  const start = (await getReviewStart(c.sql, { purchaseId: p, userId: ana })) as { start: { disclosure: { reward: { status: string } } } };
  assert.equal(start.start.disclosure.reward.status, "not_set");
  assert.equal((await review(c, p, ana, 4)).outcome, "amount_not_set");
  assert.equal((await c.sql.query(`select 1 from reviews`)).length, 0);
  await c.db.close();
});

// ------------------------------------------------------------------ offer cap (CFG-04, FR-21)

test("FR-21: the offer stops taking claims at its review cap, and at its pool", async () => {
  const c = await fresh();
  const small = clone();
  small.campaign.max_reviews = 2;
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: small, reason: "tiny offer for the test" })).outcome, "ok");
  const { owner, merchantId } = await business(c, "cap");
  const campaignId = await offer(c, merchantId);
  const ks = await codes(c, owner, campaignId, 4);
  const buyers = await Promise.all([1, 2, 3, 4].map((i) => account(c, `b${i}`, `B${i}`, `b${i}@example.com`)));
  assert.equal((await buy(c, ks[0], buyers[0], { confirmed: null })).outcome, "ok"); // pending still counts
  assert.equal((await buy(c, ks[1], buyers[1])).outcome, "ok");
  assert.equal((await buy(c, ks[2], buyers[2])).outcome, "campaign_full");

  // Pool: $15 cap per reward, $20 pool → the second big claim would overshoot.
  const pool = clone(small);
  pool.campaign.max_reviews = 50;
  pool.campaign.pool_cents = 2000;
  assert.equal((await saveConfig(c.sql, { actorId: "admin1", settings: pool, reason: "small pool for the test" })).outcome, "ok");
  const second = await offer(c, merchantId);
  const ks2 = await codes(c, owner, second, 3);
  assert.equal((await buy(c, ks2[0], buyers[0], { typed: 10000 })).outcome, "ok"); // $15 owed
  const blocked = await buy(c, ks2[1], buyers[1], { typed: 10000, confirmed: null });
  assert.equal(blocked.outcome, "campaign_full"); // $15 + $15 > $20
  await c.db.close();
});

test("FR-21: the database backstop refuses an over-cap purchase even if the app's check is skipped", async () => {
  const c = await fresh();
  const small = clone();
  small.campaign.max_reviews = 1;
  await saveConfig(c.sql, { actorId: "admin1", settings: small, reason: "cap 1" });
  const { owner, merchantId } = await business(c, "bk");
  const campaignId = await offer(c, merchantId);
  const [k] = await codes(c, owner, campaignId, 1);
  const buyer = await account(c, "bb", "BB", "bb@example.com");
  assert.equal((await buy(c, k, buyer, { confirmed: null })).outcome, "ok");
  await assert.rejects(
    c.sql.query(
      `insert into verified_purchases (user_id, merchant_id, campaign_id, product_label, order_value_cents, verification_method, verification_status, purchased_at)
       values ('bb', $1, $2, 'x', 100, 'receipt_photo', 'pending', now())`,
      [merchantId, campaignId],
    ),
    /TRUFOLKS_CAMPAIGN_FULL/,
  );
  await c.db.close();
});

test("offers follow the settings: Type A, and no longer than the most days allowed", async () => {
  const c = await fresh();
  const { merchantId } = await business(c, "len");
  const ok = await adminCreateOffer(c.sql, { adminId: "admin1", merchantId, name: "x", startsAt: daysFromNow(0), endsAt: daysFromNow(13.9) });
  assert.equal(ok.outcome, "ok");
  const t = await c.sql.query<{ campaign_type: string; config_preset_id: string }>(`select campaign_type, config_preset_id from campaigns where id = $1`, [
    (ok as { campaignId: string }).campaignId,
  ]);
  assert.deepEqual(t[0], { campaign_type: "A", config_preset_id: PILOT_PRESET_ID });
  assert.equal((await adminCreateOffer(c.sql, { adminId: "admin1", merchantId, name: "x", startsAt: daysFromNow(0), endsAt: daysFromNow(15) })).outcome, "too_long");
  const longer = clone();
  longer.campaign.max_days = 30;
  await saveConfig(c.sql, { actorId: "admin1", settings: longer, reason: "longer offers" });
  assert.equal((await adminCreateOffer(c.sql, { adminId: "admin1", merchantId, name: "x", startsAt: daysFromNow(0), endsAt: daysFromNow(15) })).outcome, "ok");
  await c.db.close();
});
