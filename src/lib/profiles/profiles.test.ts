// v1.7 — My Profile, Top 5, Shop, catalog and sharing against a throwaway
// in-memory PGlite with the real migrations 0001–0012 (v1.8: receipt without a code). Purchases are made the
// real way: admin adds business + offer + deposit → owner accepts → codes →
// scan → claim → photo → admin confirms → review. Access is checked for the
// owner, an accepted friend, a blocked account, an unrelated member and an
// anonymous visitor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { saveConfig } from "../config/engine.ts";
import { PILOT_PRESET, type AppConfig } from "../config/preset.ts";
import { acceptInvite, changeContact, createInvite } from "../contacts/engine.ts";
import { CONTACT_LIMITS } from "../contacts/limits.ts";
import { acceptMerchant, adminCreateBusiness, adminCreateOffer } from "../merchants/engine.ts";
import { recordDeposit } from "../payouts/engine.ts";
import { deriveHashKeys, hashIp } from "../receipt-codes/codes.ts";
import { claimCode, ensureDevice, generateCodes, scanCode } from "../receipt-codes/engine.ts";
import { RECEIPT_CODE_LIMITS, RECEIPT_PHOTO_LIMITS } from "../receipt-codes/limits.ts";
import { decidePurchase, storePhoto } from "../receipt-codes/photos.ts";
import { pgliteSql } from "../receipt-codes/test-support.ts";
import { submitReview } from "../reviews/engine.ts";
import { submitReceiptReview } from "../reviews/receipt-review.ts";
import { REVIEW_LIMITS } from "../reviews/limits.ts";
import {
  adminAddOffer,
  adminDecideOffer,
  adminDecideProduct,
  adminUpdateProduct,
  catalogAdminView,
  ensureProfile,
  getProductPage,
  getProfileView,
  getReviewPage,
  linkReviewProduct,
  myPurchases,
  requestCorrection,
  setBio,
  setDisplayName,
  setProfileAudience,
  setReviewAudience,
  setShopItem,
  setTopPicks,
} from "./engine.ts";

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

type Ctx = { db: PGlite; sql: Sql; seq: number; codes: string[]; owner: string };

async function account(c: { sql: Sql }, id: string, name: string): Promise<string> {
  await c.sql.query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, false, now(), now())`,
    [id, name, `${id}@example.com`],
  );
  return id;
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

/** A database with lawyer-approved wording (so disclosures complete), a funded offer and codes. */
async function fresh(): Promise<Ctx> {
  const db = new PGlite();
  await db.waitReady;
  for (const name of MIGRATIONS) await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  const sql = pgliteSql(db);
  await account({ sql }, "admin1", "Jack");
  const next = structuredClone(PILOT_PRESET) as AppConfig;
  next.disclosure.wording_approved = true;
  assert.equal((await saveConfig(sql, { actorId: "admin1", settings: next, reason: "test settings" })).outcome, "ok");
  const owner = await account({ sql }, "owner1", "Cafe Owner");
  const b = (await adminCreateBusiness(sql, { adminId: "admin1", ownerEmail: "owner1@example.com", name: "Corner Cafe", businessType: "" })) as {
    merchantId: string;
  };
  await acceptMerchant(sql, { userId: owner, merchantId: b.merchantId, what: "walkthrough" });
  await acceptMerchant(sql, { userId: owner, merchantId: b.merchantId, what: "terms" });
  const o = (await adminCreateOffer(sql, { adminId: "admin1", merchantId: b.merchantId, name: "Launch offer", startsAt: daysFromNow(-1), endsAt: daysFromNow(10) })) as {
    campaignId: string;
  };
  assert.equal(await recordDeposit(sql, { actorId: "admin1", campaignId: o.campaignId, amountCents: 25000, note: "bank transfer" }), "ok");
  const g = await generateCodes(sql, { userId: owner, campaignId: o.campaignId, count: 20, issueMode: "handout_batch", keys, limits: RECEIPT_CODE_LIMITS });
  assert.equal(g.outcome, "ok");
  for (const [id, name] of [
    ["ana", "Ana Lopez"],
    ["ben", "Ben"],
    ["cat", "Cat"],
    ["dan", "Dan"],
  ]) {
    await account({ sql }, id, name);
  }
  return { db, sql, seq: 0, codes: (g as { codes: string[] }).codes, owner };
}

function photo(c: Ctx): Uint8Array {
  c.seq += 1;
  const out = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0, 0, 0]);
  new DataView(out.buffer).setUint32(10, c.seq);
  return out;
}

/** Claim a code; optionally add the photo, confirm and review. */
async function buy(
  c: Ctx,
  buyer: string,
  end: "claimed" | "photo" | "rejected" | "verified" | "reviewed" = "reviewed",
  label = "Flat white",
): Promise<{ purchaseId: string; reviewId?: string }> {
  const code = c.codes.shift() as string;
  c.seq += 1;
  const ipHash = hashIp(`198.51.100.${c.seq % 250}-${c.seq}`, keys);
  const dev = await ensureDevice(c.sql, { rawToken: null, ipHash, limits: RECEIPT_CODE_LIMITS });
  assert.ok(dev.ok);
  assert.equal((await scanCode(c.sql, { rawCode: code, deviceId: dev.deviceId, ipHash, keys, limits: RECEIPT_CODE_LIMITS })).outcome, "ok");
  const claim = await claimCode(c.sql, {
    rawCode: code,
    deviceId: dev.deviceId,
    userId: buyer,
    ipHash,
    details: { productLabel: label, orderValueCents: 2500, currency: "USD", purchasedAt: new Date(Date.now() - 60_000).toISOString() },
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  assert.equal(claim.outcome, "ok");
  const purchaseId = (claim as { purchaseId: string }).purchaseId;
  if (end === "claimed") return { purchaseId };
  assert.equal((await storePhoto(c.sql, { purchaseId, userId: buyer, photo: photo(c), header: null, limits: RECEIPT_PHOTO_LIMITS })).outcome, "ok");
  if (end === "photo") return { purchaseId };
  const d = await decidePurchase(c.sql, {
    purchaseId,
    adminUserId: "admin1",
    decision: end === "rejected" ? "rejected" : "verified",
    reason: end === "rejected" ? "Unreadable" : "",
    confirmedOrderValueCents: 2500,
    limits: RECEIPT_PHOTO_LIMITS,
  });
  assert.equal(d.outcome, "ok");
  if (end !== "reviewed") return { purchaseId };
  const r = await submitReview(c.sql, {
    purchaseId,
    userId: buyer,
    fields: { rating: 2, whatUsed: label, howLong: "One cup", honestThought: "Too bitter for me." },
    limits: REVIEW_LIMITS,
  });
  assert.equal(r.outcome, "ok");
  return { purchaseId, reviewId: (r as { review: { reviewId: string } }).review.reviewId };
}

async function befriend(c: Ctx, a: string, b: string) {
  const inv = await createInvite(c.sql, { userId: a, limits: CONTACT_LIMITS });
  assert.equal(inv.outcome, "ok");
  assert.equal((await acceptInvite(c.sql, { token: (inv as { token: string }).token, userId: b })).outcome, "ok");
}

async function handleOf(c: Ctx, userId: string): Promise<string> {
  return (await ensureProfile(c.sql, userId)) as string;
}

const FORBIDDEN_KEYS = ["order_value_cents", "orderValueCents", "receipt", "photo", "payout", "amountCentsConfirmed", "email"];

function assertNoPrivateFields(value: unknown) {
  const json = JSON.stringify(value);
  for (const k of FORBIDDEN_KEYS) assert.ok(!json.includes(`"${k}`), `response must not carry ${k}`);
}

// ------------------------------------------------------------------ profiles exist

test("every member gets a stable, unique handle; it never changes", async () => {
  const c = await fresh();
  const h = await handleOf(c, "ana");
  assert.match(h, /^ana-lopez-[0-9a-f]{6}$/);
  assert.equal(await handleOf(c, "ana"), h);
  await assert.rejects(c.sql.query(`update profiles set handle = 'other-handle' where user_id = 'ana'`));
  const rows = await c.sql.query<{ n: number }>(`select count(*)::int as n from profiles`);
  assert.equal(rows[0].n, 6, "admin, owner and four shoppers");
  await c.db.close();
});

// ------------------------------------------------------------------ access matrix

test("Friends only by default: owner and friend see it; blocked, unrelated and anonymous get not_found", async () => {
  const c = await fresh();
  const { reviewId } = await buy(c, "ana");
  await befriend(c, "ana", "ben");
  await befriend(c, "ana", "cat");
  assert.equal(await changeContact(c.sql, { userId: "ana", otherId: "cat", action: "block" }), "ok");
  const handle = await handleOf(c, "ana");

  const owner = await getProfileView(c.sql, { handle, viewerId: "ana" });
  assert.equal(owner.outcome, "ok");
  assert.equal((owner as { view: { relation: string } }).view.relation, "owner");

  const friend = await getProfileView(c.sql, { handle, viewerId: "ben" });
  assert.equal(friend.outcome, "ok");
  const fv = (friend as { view: { reviews: { reviewId: string }[]; relation: string } }).view;
  assert.equal(fv.relation, "friend");
  assert.deepEqual(fv.reviews.map((r) => r.reviewId), [reviewId]);
  assertNoPrivateFields(friend);

  assert.equal((await getProfileView(c.sql, { handle, viewerId: "cat" })).outcome, "not_found", "blocked");
  assert.equal((await getProfileView(c.sql, { handle, viewerId: "dan" })).outcome, "not_found", "unrelated");
  assert.equal((await getProfileView(c.sql, { handle, viewerId: null })).outcome, "not_found", "anonymous");
  // The review itself follows the same rule.
  assert.equal((await getReviewPage(c.sql, { reviewId: reviewId as string, viewerId: "ben" })).outcome, "ok");
  for (const v of ["cat", "dan", null]) {
    assert.equal((await getReviewPage(c.sql, { reviewId: reviewId as string, viewerId: v })).outcome, "not_found");
  }
  await c.db.close();
});

test("publishing is explicit and separate: a public profile shows only public reviews to strangers", async () => {
  const c = await fresh();
  const one = await buy(c, "ana", "reviewed", "Flat white");
  const two = await buy(c, "ana", "reviewed", "Croissant");
  await befriend(c, "ana", "cat");
  assert.equal(await changeContact(c.sql, { userId: "cat", otherId: "ana", action: "block" }), "ok");
  const handle = await handleOf(c, "ana");

  assert.equal(await setProfileAudience(c.sql, { userId: "ana", audience: "public" }), "ok");
  const anon = await getProfileView(c.sql, { handle, viewerId: null });
  assert.equal(anon.outcome, "ok");
  assert.equal((anon as { view: { reviews: unknown[] } }).view.reviews.length, 0, "no review is public yet");

  assert.equal(await setReviewAudience(c.sql, { userId: "ana", reviewId: one.reviewId as string, audience: "public" }), "ok");
  for (const viewer of [null, "dan"]) {
    const v = await getProfileView(c.sql, { handle, viewerId: viewer });
    assert.deepEqual((v as { view: { reviews: { reviewId: string }[] } }).view.reviews.map((r) => r.reviewId), [one.reviewId]);
    assertNoPrivateFields(v);
  }
  // The public review opens for a guest on its own; the friends-only one doesn't.
  assert.equal((await getReviewPage(c.sql, { reviewId: one.reviewId as string, viewerId: null })).outcome, "ok");
  assert.equal((await getReviewPage(c.sql, { reviewId: two.reviewId as string, viewerId: null })).outcome, "not_found");
  // Blocking wins over public, in either direction.
  assert.equal((await getProfileView(c.sql, { handle, viewerId: "cat" })).outcome, "not_found");
  assert.equal((await getReviewPage(c.sql, { reviewId: one.reviewId as string, viewerId: "cat" })).outcome, "not_found");

  // Revoke: unpublishing takes it away again, and the events are logged.
  assert.equal(await setReviewAudience(c.sql, { userId: "ana", reviewId: one.reviewId as string, audience: "contacts" }), "ok");
  assert.equal((await getReviewPage(c.sql, { reviewId: one.reviewId as string, viewerId: null })).outcome, "not_found");
  assert.equal(await setProfileAudience(c.sql, { userId: "ana", audience: "friends" }), "ok");
  assert.equal((await getProfileView(c.sql, { handle, viewerId: null })).outcome, "not_found");
  const events = await c.sql.query<{ event: string }>(`select event from profile_events where user_id = 'ana' order by at, id`);
  assert.deepEqual(
    events.map((e) => e.event).sort(),
    ["profile_published", "profile_unpublished", "review_published", "review_unpublished"].sort(),
  );
  await c.db.close();
});

test("the owner's audience preview shows exactly what a friend or a stranger would", async () => {
  const c = await fresh();
  const one = await buy(c, "ana");
  await buy(c, "ana", "reviewed", "Croissant");
  const handle = await handleOf(c, "ana");
  const asAnyone = await getProfileView(c.sql, { handle, viewerId: "ana", previewAs: "anonymous" });
  assert.equal(asAnyone.outcome, "ok");
  assert.equal((asAnyone as { view: { reviews: unknown[]; relation: string } }).view.reviews.length, 0);
  assert.equal((asAnyone as { view: { relation: string } }).view.relation, "anonymous");
  await setProfileAudience(c.sql, { userId: "ana", audience: "public" });
  await setReviewAudience(c.sql, { userId: "ana", reviewId: one.reviewId as string, audience: "public" });
  const after = await getProfileView(c.sql, { handle, viewerId: "ana", previewAs: "anonymous" });
  assert.equal((after as { view: { reviews: unknown[] } }).view.reviews.length, 1);
  const asFriend = await getProfileView(c.sql, { handle, viewerId: "ana", previewAs: "friend" });
  assert.equal((asFriend as { view: { reviews: unknown[] } }).view.reviews.length, 2);
  // A non-owner can't use the preview to see more than they may.
  const dan = await getProfileView(c.sql, { handle, viewerId: "dan", previewAs: "friend" });
  assert.equal((dan as { view: { relation: string; reviews: unknown[] } }).view.relation, "member");
  assert.equal((dan as { view: { reviews: unknown[] } }).view.reviews.length, 1);
  await c.db.close();
});

test("a review can't be made public until its disclosure is complete (LEG-01)", async () => {
  const c = await fresh();
  const { reviewId } = await buy(c, "ana");
  // Simulate a pre-approval review: wording not approved → incomplete.
  await c.db.exec(`alter table reviews disable trigger reviews_locked`);
  await c.sql.query(`update reviews set disclosure = jsonb_set(disclosure, '{complete}', 'false') where id = $1`, [reviewId]);
  await c.db.exec(`alter table reviews enable trigger reviews_locked`);
  assert.equal(await setReviewAudience(c.sql, { userId: "ana", reviewId: reviewId as string, audience: "public" }), "not_shareable");
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "products", reviewIds: [reviewId] }), "not_eligible");
  await c.db.close();
});

// ------------------------------------------------------------------ cross-account writes

test("nobody can change another person's profile, reviews, Top 5 or catalog links", async () => {
  const c = await fresh();
  const { reviewId } = await buy(c, "ana");
  assert.equal(await setReviewAudience(c.sql, { userId: "ben", reviewId: reviewId as string, audience: "public" }), "not_found");
  assert.equal(await setTopPicks(c.sql, { userId: "ben", list: "products", reviewIds: [reviewId] }), "not_eligible");
  const link = await linkReviewProduct(c.sql, {
    userId: "ben",
    reviewId: reviewId as string,
    fields: { kind: "product", brand: "Hario", model: "V60", category: "Coffee gear" },
  });
  assert.equal(link.outcome, "not_found");
  await assert.rejects(
    c.sql.query(`insert into top_picks (user_id, list, position, review_id) values ('ben', 'products', 1, $1)`, [reviewId]),
  );
  const v = await c.sql.query<{ visibility: string }>(`select visibility from reviews where id = $1`, [reviewId]);
  assert.equal(v[0].visibility, "contacts");
  assert.equal(await setBio(c.sql, { userId: "ben", bio: "x".repeat(281) }), "invalid");
  // Display name: owner only (acts on the caller's own row), 1–60 characters, shown on reviews.
  assert.equal(await setDisplayName(c.sql, { userId: "ana", name: "  " }), "invalid");
  assert.equal(await setDisplayName(c.sql, { userId: "ana", name: "x".repeat(61) }), "invalid");
  assert.equal(await setDisplayName(c.sql, { userId: "ana", name: "Ana L." }), "ok");
  const page = await getReviewPage(c.sql, { reviewId: reviewId as string, viewerId: "ana" });
  assert.equal((page as { review: { reviewerName: string } }).review.reviewerName, "Ana L.");
  const ben = await c.sql.query<{ display_name: string }>(`select display_name from users where id = 'ben'`);
  assert.equal(ben[0].display_name, "Ben");
  await c.db.close();
});

// ------------------------------------------------------------------ Top 5

test("Top 5: zero to five per list, manual order persists, one list per review", async () => {
  const c = await fresh();
  const ids: string[] = [];
  for (let i = 0; i < 7; i += 1) ids.push((await buy(c, "ana", "reviewed", `Item ${i}`)).reviewId as string);
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "products", reviewIds: ids.slice(0, 6) }), "too_many");
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "products", reviewIds: [ids[0], ids[0]] }), "duplicate");
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "products", reviewIds: [ids[2], ids[0], ids[1]] }), "ok");
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "services", reviewIds: [ids[0]] }), "in_other_list");
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "services", reviewIds: [ids[5]] }), "ok");
  // Reorder and read back.
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "products", reviewIds: [ids[1], ids[2], ids[0]] }), "ok");
  const handle = await handleOf(c, "ana");
  const v = (await getProfileView(c.sql, { handle, viewerId: "ana" })) as {
    view: { topPicks: { products: { reviewId: string }[]; services: { reviewId: string }[] } };
  };
  assert.deepEqual(v.view.topPicks.products.map((r) => r.reviewId), [ids[1], ids[2], ids[0]]);
  assert.deepEqual(v.view.topPicks.services.map((r) => r.reviewId), [ids[5]]);
  // Empty is allowed.
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "services", reviewIds: [] }), "ok");
  // Strangers only see picks that are public.
  await setProfileAudience(c.sql, { userId: "ana", audience: "public" });
  await setReviewAudience(c.sql, { userId: "ana", reviewId: ids[2], audience: "public" });
  const anon = (await getProfileView(c.sql, { handle, viewerId: null })) as { view: { topPicks: { products: { reviewId: string }[] } } };
  assert.deepEqual(anon.view.topPicks.products.map((r) => r.reviewId), [ids[2]]);
  await c.db.close();
});

// ------------------------------------------------------------------ catalog

test("catalog: same exact model joins one product page; a different variant stays distinct", async () => {
  const c = await fresh();
  const a = await buy(c, "ana", "reviewed", "Hario V60 02 white");
  const b = await buy(c, "ben", "reviewed", "V60 size 02 (white)");
  const d = await buy(c, "dan", "reviewed", "V60 01 black");

  const la = await linkReviewProduct(c.sql, {
    userId: "ana",
    reviewId: a.reviewId as string,
    fields: { kind: "product", brand: "Hario", model: "V60 02", variant: "White", category: "Coffee gear", offerSeller: "Corner Cafe", offerUrl: "https://example.com/v60" },
  });
  assert.equal(la.outcome, "ok");
  assert.equal((la as { status: string }).status, "pending", "a brand-new entry waits for the team");
  // Admin approves the record and its suggested offer.
  const pid = (la as { productId: string }).productId;
  assert.equal(await adminDecideProduct(c.sql, { adminId: "admin1", productId: pid, action: "approve" }), "ok");

  const lb = await linkReviewProduct(c.sql, {
    userId: "ben",
    reviewId: b.reviewId as string,
    fields: { kind: "product", brand: "  HARIO ", model: "v60-02", variant: "white", category: "Coffee" },
  });
  assert.equal((lb as { productId: string }).productId, pid, "normalized brand/model/variant joins the same record");
  assert.equal((lb as { method: string }).method, "brand_model");

  const ld = await linkReviewProduct(c.sql, {
    userId: "dan",
    reviewId: d.reviewId as string,
    fields: { kind: "product", brand: "Hario", model: "V60 02", variant: "Black", category: "Coffee gear" },
  });
  assert.notEqual((ld as { productId: string }).productId, pid, "a different variant is its own record");
  const queue = await catalogAdminView(c.sql);
  const dq = queue.pending.find((p) => p.productId === (ld as { productId: string }).productId);
  assert.equal(dq?.matchNote, "possible_variant");
  assert.equal(dq?.similarTo?.productId, pid);

  // Identifier match beats text.
  const e = await buy(c, "cat", "reviewed", "Dripper");
  await adminUpdateProduct(c.sql, {
    adminId: "admin1",
    productId: pid,
    fields: { kind: "product", brand: "Hario", model: "V60 02", variant: "White", category: "Coffee gear", gtin: "4977642723214", mpn: "", releaseYear: 2004, releaseYearVerified: true },
  });
  const le = await linkReviewProduct(c.sql, {
    userId: "cat",
    reviewId: e.reviewId as string,
    fields: { kind: "product", brand: "Hario Co", model: "Dripper", category: "Coffee", gtin: "4977-6427-23214" },
  });
  assert.equal((le as { productId: string }).productId, pid);
  assert.equal((le as { method: string }).method, "identifier");
  await c.db.close();
});

test("product page: approved only, public reviews for guests, approved seller links only, merges redirect", async () => {
  const c = await fresh();
  const a = await buy(c, "ana", "reviewed", "Hario V60");
  const b = await buy(c, "ben", "reviewed", "Hario V60");
  const la = (await linkReviewProduct(c.sql, {
    userId: "ana",
    reviewId: a.reviewId as string,
    fields: { kind: "product", brand: "Hario", model: "V60", category: "Coffee gear", offerSeller: "Some shop", offerUrl: "https://shop.example/v60" },
  })) as { productId: string };
  const slugRow = await c.sql.query<{ slug: string }>(`select slug from catalog_products where id = $1`, [la.productId]);
  const slug = slugRow[0].slug;
  assert.equal((await getProductPage(c.sql, { slug, viewerId: null })).outcome, "not_found", "pending record has no page");
  await adminDecideProduct(c.sql, { adminId: "admin1", productId: la.productId, action: "approve" });
  assert.equal((await getProductPage(c.sql, { slug, viewerId: null })).outcome, "not_found", "no public review yet");
  await setReviewAudience(c.sql, { userId: "ana", reviewId: a.reviewId as string, audience: "public" });
  const guest = await getProductPage(c.sql, { slug, viewerId: null });
  assert.equal(guest.outcome, "ok");
  const page = (guest as { page: { offers: unknown[]; reviews: { reviewId: string; authorHandle: string | null }[] } }).page;
  assert.equal(page.offers.length, 0, "the suggested offer isn't shown until approved");
  assert.equal(page.reviews[0].authorHandle, null, "Ana's profile is still Friends only");
  assertNoPrivateFields(guest);

  const offers = await catalogAdminView(c.sql);
  const offer = offers.offers.find((o) => o.productId === la.productId);
  assert.ok(offer);
  assert.equal(await adminDecideOffer(c.sql, { adminId: "admin1", offerId: offer.offerId, action: "approve" }), "ok");
  const withOffer = (await getProductPage(c.sql, { slug, viewerId: null })) as { page: { offers: { url: string }[] } };
  assert.deepEqual(withOffer.page.offers.map((o) => o.url), ["https://shop.example/v60"]);
  assert.equal(
    await adminAddOffer(c.sql, { adminId: "admin1", productId: la.productId, sellerName: "Bad", url: "javascript:alert(1)", kind: "seller", referralCommission: false }),
    "invalid",
  );

  // Shop on the profile: off by default, then shown once Ana switches it on.
  await setProfileAudience(c.sql, { userId: "ana", audience: "public" });
  type ShopView = { view: { shop: { reviewId: string; offers: unknown[] }[] } };
  const before = (await getProfileView(c.sql, { handle: await handleOf(c, "ana"), viewerId: null })) as ShopView;
  assert.deepEqual(before.view.shop, []);
  assert.equal(await setShopItem(c.sql, { userId: "ana", reviewId: a.reviewId as string, on: true }), "ok");
  const prof = (await getProfileView(c.sql, { handle: await handleOf(c, "ana"), viewerId: null })) as ShopView;
  assert.deepEqual(prof.view.shop.map((r) => r.reviewId), [a.reviewId]);

  // Merge a duplicate into the approved record: its links move and its page redirects.
  const lb = (await linkReviewProduct(c.sql, {
    userId: "ben",
    reviewId: b.reviewId as string,
    fields: { kind: "product", brand: "Hario", model: "V-60 dripper", category: "Coffee gear" },
  })) as { productId: string };
  assert.notEqual(lb.productId, la.productId);
  assert.equal(await adminDecideProduct(c.sql, { adminId: "admin1", productId: lb.productId, action: "merge", targetId: la.productId }), "ok");
  const dupSlug = (await c.sql.query<{ slug: string }>(`select slug from catalog_products where id = $1`, [lb.productId]))[0].slug;
  const moved = await getProductPage(c.sql, { slug: dupSlug, viewerId: null });
  assert.deepEqual(moved, { outcome: "moved", slug });
  const linked = await c.sql.query<{ product_id: string }>(`select product_id from review_products where review_id = $1`, [b.reviewId]);
  assert.equal(linked[0].product_id, la.productId);

  // Correction path.
  assert.equal(await requestCorrection(c.sql, { userId: "dan", slug, note: "It's the 02 size." }), "ok");
  assert.equal((await catalogAdminView(c.sql)).corrections.length, 1);
  await c.db.close();
});

test("product page: a linked review leads even when it is older than the newest reviews listed (v1.9)", async () => {
  const c = await fresh();
  const old = await buy(c, "ana", "reviewed", "Hario V60");
  const mid = await buy(c, "ben", "reviewed", "Hario V60");
  const hidden = await buy(c, "cat", "reviewed", "Hario V60");
  const la = (await linkReviewProduct(c.sql, {
    userId: "ana",
    reviewId: old.reviewId as string,
    fields: { kind: "product", brand: "Hario", model: "V60", category: "Coffee gear" },
  })) as { productId: string };
  await adminDecideProduct(c.sql, { adminId: "admin1", productId: la.productId, action: "approve" });
  for (const [user, r] of [["ben", mid], ["cat", hidden]] as const) {
    await linkReviewProduct(c.sql, {
      userId: user,
      reviewId: r.reviewId as string,
      fields: { kind: "product", brand: "Hario", model: "V60", category: "Coffee gear" },
    });
  }
  // Ana's review was posted first, so it is the oldest. Ana and Ben share publicly; Cat stays Friends only.
  await setReviewAudience(c.sql, { userId: "ana", reviewId: old.reviewId as string, audience: "public" });
  await setReviewAudience(c.sql, { userId: "ben", reviewId: mid.reviewId as string, audience: "public" });
  await setProfileAudience(c.sql, { userId: "ana", audience: "public" });
  const slug = (await c.sql.query<{ slug: string }>(`select slug from catalog_products where id = $1`, [la.productId]))[0].slug;
  type Page = { page: { leadReviewId: string | null; reviews: { reviewId: string; authorHandle: string | null }[] } };

  // Only the newest review fits the list, yet the linked older one is fetched and leads.
  const linked = (await getProductPage(c.sql, { slug, viewerId: null, reviewId: old.reviewId, limit: 1 })) as Page;
  assert.equal(linked.page.leadReviewId, old.reviewId);
  assert.deepEqual(linked.page.reviews.map((r) => r.reviewId).sort(), [mid.reviewId, old.reviewId].sort());
  const lead = linked.page.reviews.find((r) => r.reviewId === old.reviewId);
  assert.equal(lead?.authorHandle, await handleOf(c, "ana"), "the link back to Ana's profile is kept");
  assertNoPrivateFields(linked);

  // Same checks as the list: a Friends-only review never leads for a guest, and a review of
  // another product or an unknown id is ignored.
  const blocked = (await getProductPage(c.sql, { slug, viewerId: null, reviewId: hidden.reviewId, limit: 1 })) as Page;
  assert.equal(blocked.page.leadReviewId, null);
  assert.ok(!blocked.page.reviews.some((r) => r.reviewId === hidden.reviewId));
  const other = await buy(c, "dan", "reviewed", "Chemex");
  for (const id of [other.reviewId as string, "no-such-review"]) {
    const r = (await getProductPage(c.sql, { slug, viewerId: null, reviewId: id, limit: 1 })) as Page;
    assert.equal(r.page.leadReviewId, null);
    assert.equal(r.page.reviews.length, 1);
  }
  // Cat's friend can follow the link to it.
  await befriend(c, "cat", "dan");
  const friend = (await getProductPage(c.sql, { slug, viewerId: "dan", reviewId: hidden.reviewId, limit: 1 })) as Page;
  assert.equal(friend.page.leadReviewId, hidden.reviewId);
  await c.db.close();
});

test("legacy reviews without a catalog link stay readable", async () => {
  const c = await fresh();
  const { reviewId } = await buy(c, "ana");
  await befriend(c, "ana", "ben");
  const r = await getReviewPage(c.sql, { reviewId: reviewId as string, viewerId: "ben" });
  assert.equal(r.outcome, "ok");
  assert.equal((r as { review: { product: unknown } }).review.product, null);
  await c.db.close();
});

// ------------------------------------------------------------------ Add a review

test("Add a review: each purchase shows its real status and next step", async () => {
  const c = await fresh();
  const claimed = await buy(c, "ana", "claimed");
  const photoOnly = await buy(c, "ana", "photo");
  const rejected = await buy(c, "ana", "rejected");
  const verified = await buy(c, "ana", "verified");
  const posted = await buy(c, "ana", "reviewed");
  await buy(c, "ben", "verified");
  const list = await myPurchases(c.sql, { userId: "ana" });
  const state = new Map(list.map((p) => [p.purchaseId, p.state]));
  assert.equal(list.length, 5, "only Ana's own purchases");
  assert.equal(state.get(claimed.purchaseId), "pending_photo");
  assert.equal(state.get(photoOnly.purchaseId), "pending");
  assert.equal(state.get(rejected.purchaseId), "rejected");
  assert.equal(state.get(verified.purchaseId), "ready");
  assert.equal(state.get(posted.purchaseId), "posted");
  assert.equal(list.find((p) => p.purchaseId === posted.purchaseId)?.reviewId, posted.reviewId);
  assertNoPrivateFields(list);
  await c.db.close();
});

// ------------------------------------------------------------------ Show in Shop (SHOP-18-01)

test("Show in Shop: off by default, owner's choice, respects both audiences and the approved seller link", async () => {
  const c = await fresh();
  const a = await buy(c, "ana", "reviewed", "Hario V60");
  const noLink = await buy(c, "ana", "reviewed", "Croissant");
  await befriend(c, "ana", "ben");
  const handle = await handleOf(c, "ana");
  const link = (await linkReviewProduct(c.sql, {
    userId: "ana",
    reviewId: a.reviewId as string,
    fields: { kind: "product", brand: "Hario", model: "V60", category: "Coffee gear", offerSeller: "Shop", offerUrl: "https://shop.example/v60" },
  })) as { productId: string };
  type V = { outcome: string; view?: { shop: { reviewId: string; rating: number; disclosure: { complete: boolean } | null }[] } };
  const shopOf = async (viewer: string | null) => {
    const v = (await getProfileView(c.sql, { handle, viewerId: viewer })) as V;
    return v.outcome === "ok" ? (v.view?.shop ?? []).map((r) => r.reviewId) : null;
  };

  // Not eligible before the record and its seller link are approved; never someone else's review.
  assert.equal(await setShopItem(c.sql, { userId: "ana", reviewId: a.reviewId as string, on: true }), "not_eligible");
  assert.equal(await setShopItem(c.sql, { userId: "ana", reviewId: noLink.reviewId as string, on: true }), "not_eligible");
  assert.equal(await setShopItem(c.sql, { userId: "ben", reviewId: a.reviewId as string, on: true }), "not_found");
  await adminDecideProduct(c.sql, { adminId: "admin1", productId: link.productId, action: "approve" });
  const offer = (await catalogAdminView(c.sql)).offers.find((o) => o.productId === link.productId);
  assert.ok(offer);
  await adminDecideOffer(c.sql, { adminId: "admin1", offerId: offer.offerId, action: "approve" });

  // A Top 5 pin does not add it to Shop.
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "products", reviewIds: [a.reviewId] }), "ok");
  assert.deepEqual(await shopOf("ana"), []);

  assert.equal(await setShopItem(c.sql, { userId: "ana", reviewId: a.reviewId as string, on: true }), "ok");
  assert.deepEqual(await shopOf("ana"), [a.reviewId], "owner");
  assert.deepEqual(await shopOf("ben"), [a.reviewId], "friend: Friends-only profile and review");
  assert.equal(await shopOf(null), null, "guest: profile is Friends only");
  assert.equal(await shopOf("dan"), null, "unrelated member");

  // Both audiences must allow it before a stranger sees the listing.
  await setProfileAudience(c.sql, { userId: "ana", audience: "public" });
  assert.deepEqual(await shopOf(null), [], "public profile, but the review is still Friends only");
  await setReviewAudience(c.sql, { userId: "ana", reviewId: a.reviewId as string, audience: "public" });
  assert.deepEqual(await shopOf(null), [a.reviewId], "guest sees it once both are public");
  const guest = (await getProfileView(c.sql, { handle, viewerId: null })) as V;
  assert.equal(guest.view?.shop[0].rating, 2, "the rating travels with the listing");
  assert.equal(guest.view?.shop[0].disclosure?.complete, true, "so does the full disclosure");

  // Unsharing the review takes it away from strangers; friends still see it.
  await setReviewAudience(c.sql, { userId: "ana", reviewId: a.reviewId as string, audience: "contacts" });
  assert.deepEqual(await shopOf(null), []);
  assert.deepEqual(await shopOf("ben"), [a.reviewId]);
  await setReviewAudience(c.sql, { userId: "ana", reviewId: a.reviewId as string, audience: "public" });

  // Losing the approved seller link takes it away for everyone, without touching the choice.
  await adminDecideOffer(c.sql, { adminId: "admin1", offerId: offer.offerId, action: "withdraw" });
  assert.deepEqual(await shopOf(null), []);
  assert.deepEqual(await shopOf("ana"), []);
  await adminAddOffer(c.sql, { adminId: "admin1", productId: link.productId, sellerName: "Other shop", url: "https://other.example/v60", kind: "seller", referralCommission: false });
  assert.deepEqual(await shopOf(null), [a.reviewId], "a new approved link brings the owner's choice back");

  // Removing it from Shop.
  assert.equal(await setShopItem(c.sql, { userId: "ana", reviewId: a.reviewId as string, on: false }), "ok");
  assert.deepEqual(await shopOf(null), []);
  assert.deepEqual(await shopOf("ana"), []);
  // The Top 5 pin is untouched.
  const me = (await getProfileView(c.sql, { handle, viewerId: "ana" })) as { view: { topPicks: { products: { reviewId: string }[] } } };
  assert.deepEqual(me.view.topPicks.products.map((r) => r.reviewId), [a.reviewId]);
  const events = await c.sql.query<{ event: string }>(`select event from profile_events where user_id = 'ana' and event like 'shop_%' order by at, id`);
  assert.deepEqual(events.map((e) => e.event), ["shop_added", "shop_removed"]);
  await c.db.close();
});

// ------------------------------------------------------------------ v1.8: a receipt without a code (REV-18-02)

const todayYmd = () => new Date().toISOString().slice(0, 10);

async function sendReceipt(
  c: Ctx,
  buyer: string,
  over: { store?: string; date?: string; photoBytes?: Uint8Array; cap?: number; rating?: number } = {},
) {
  return submitReceiptReview(c.sql, {
    userId: buyer,
    fields: { rating: over.rating ?? 4, whatUsed: "Oat latte", howLong: "Two visits", honestThought: "Smooth, a bit sweet." },
    storeName: over.store ?? "Blue Door Coffee",
    purchasedOn: over.date ?? todayYmd(),
    photo: over.photoBytes ?? photo(c),
    header: null,
    limits: { ...REVIEW_LIMITS, maxReceiptOnlyPerDay: over.cap ?? REVIEW_LIMITS.maxReceiptOnlyPerDay },
    photoLimits: RECEIPT_PHOTO_LIMITS,
  });
}

async function decide(c: Ctx, purchaseId: string, decision: "verified" | "rejected") {
  const d = await decidePurchase(c.sql, {
    purchaseId,
    adminUserId: "admin1",
    decision,
    reason: decision === "rejected" ? "Not a receipt" : "",
    confirmedOrderValueCents: 650,
    limits: RECEIPT_PHOTO_LIMITS,
  });
  assert.equal(d.outcome, "ok");
}

test("receipt without a code: the review waits, then posts as a Verified purchase once confirmed, with no reward", async () => {
  const c = await fresh();
  await befriend(c, "ana", "ben");
  const sent = await sendReceipt(c, "ana");
  assert.equal(sent.outcome, "ok");
  const purchaseId = (sent as { purchaseId: string }).purchaseId;

  // Waiting: no review yet, the purchase says so.
  let mine = await myPurchases(c.sql, { userId: "ana" });
  assert.equal(mine[0].purchaseId, purchaseId);
  assert.equal(mine[0].state, "pending");
  assert.equal(mine[0].withoutCode, true);
  assert.equal(mine[0].reviewWaiting, true);
  assert.equal(mine[0].merchantName, "Blue Door Coffee");
  assert.equal((await c.sql.query(`select 1 from reviews where verified_purchase_id = $1`, [purchaseId])).length, 0);

  // Confirmed by the team: posts by itself, exactly as written.
  await decide(c, purchaseId, "verified");
  mine = await myPurchases(c.sql, { userId: "ana" });
  assert.equal(mine[0].state, "posted");
  assert.equal(mine[0].reviewWaiting, false);
  const reviewId = mine[0].reviewId as string;
  const handle = await handleOf(c, "ana");
  type P = { outcome: string; view?: { reviews: { reviewId: string; verifiedPurchase: boolean; merchantName: string; honestThought: string; rating: number; disclosure: { incentive: boolean; complete: boolean; reward: { status: string } } | null }[] } };
  const own = (await getProfileView(c.sql, { handle, viewerId: "ana" })) as P;
  const r = own.view?.reviews.find((x) => x.reviewId === reviewId);
  assert.ok(r);
  assert.equal(r.verifiedPurchase, true, "Verified purchase, like any checked receipt");
  assert.equal(r.merchantName, "Blue Door Coffee");
  assert.equal(r.honestThought, "Smooth, a bit sweet.");
  assert.equal(r.rating, 4);
  assert.equal(r.disclosure?.incentive, false, "no offer, so nothing paid");
  assert.equal(r.disclosure?.reward.status, "none");
  assert.equal(r.disclosure?.complete, true);
  assert.equal((await c.sql.query(`select 1 from payouts where review_id = $1`, [reviewId])).length, 0, "no payout");
  assert.equal((await c.sql.query(`select 1 from review_drafts`)).length, 0, "the waiting words are gone");

  // Shared like any other review: friend sees it, it can be pinned to Top 5.
  const friend = (await getProfileView(c.sql, { handle, viewerId: "ben" })) as P;
  assert.ok(friend.view?.reviews.some((x) => x.reviewId === reviewId));
  assert.equal(await setTopPicks(c.sql, { userId: "ana", list: "products", reviewIds: [reviewId] }), "ok");
  assertNoPrivateFields(friend);
  await c.db.close();
});

test("receipt without a code: not confirmed deletes the words and posts nothing", async () => {
  const c = await fresh();
  const sent = (await sendReceipt(c, "ana")) as { outcome: string; purchaseId: string };
  assert.equal(sent.outcome, "ok");
  await decide(c, sent.purchaseId, "rejected");
  const mine = await myPurchases(c.sql, { userId: "ana" });
  assert.equal(mine[0].state, "rejected");
  assert.equal((await c.sql.query(`select 1 from reviews`)).length, 0);
  assert.equal((await c.sql.query(`select 1 from review_drafts`)).length, 0);
  await c.db.close();
});

test("receipt without a code: bad input, a reused photo and the daily cap keep nothing", async () => {
  const c = await fresh();
  assert.equal((await sendReceipt(c, "ana", { store: "  " })).outcome, "bad_store");
  assert.equal((await sendReceipt(c, "ana", { date: "2999-01-01" })).outcome, "bad_date");
  assert.equal((await sendReceipt(c, "ana", { date: "not-a-date" })).outcome, "bad_date");
  assert.equal((await sendReceipt(c, "ana", { rating: 9 })).outcome, "invalid");
  assert.equal((await sendReceipt(c, "ana", { photoBytes: new Uint8Array([1, 2, 3]) })).outcome, "bad_photo");

  const same = photo(c);
  assert.equal((await sendReceipt(c, "ana", { photoBytes: same })).outcome, "ok");
  assert.equal((await sendReceipt(c, "ben", { photoBytes: same })).outcome, "duplicate_photo", "another account can't reuse it");
  assert.equal((await c.sql.query(`select 1 from verified_purchases where user_id = 'ben'`)).length, 0, "nothing kept");
  assert.equal((await c.sql.query(`select 1 from review_drafts where user_id = 'ben'`)).length, 0);

  assert.equal((await sendReceipt(c, "ana", { cap: 2 })).outcome, "ok");
  assert.equal((await sendReceipt(c, "ana", { cap: 2 })).outcome, "too_many");
  await c.db.close();
});

test("receipt without a code: the database refuses a receipt-only purchase with a code, an offer or no place", async () => {
  const c = await fresh();
  await assert.rejects(
    c.sql.query(
      `insert into verified_purchases (user_id, merchant_id, store_name, product_label, order_value_cents, verification_method, purchased_at)
       values ('ana', null, null, 'x', 0, 'receipt_photo', now())`,
    ),
    "a purchase needs a business or a store name",
  );
  await assert.rejects(
    c.sql.query(
      `insert into verified_purchases (user_id, merchant_id, store_name, product_label, order_value_cents, verification_method, purchased_at)
       values ('ana', null, 'Shop', 'x', 0, 'receipt_code_and_photo', now())`,
    ),
    "receipt-only is always checked by photo",
  );
  await c.db.close();
});
