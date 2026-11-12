// Ticket 3b-1 — receipt photos and human verification against a throwaway
// in-memory PGlite with the real 0002 + 0004 + 0005 migrations applied.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { deriveHashKeys, hashIp } from "./codes.ts";
import { claimCode, ensureDevice, generateCodes, suspendCode } from "./engine.ts";
import { RECEIPT_CODE_LIMITS, RECEIPT_PHOTO_LIMITS } from "./limits.ts";
import { decidePurchase, findMyClaim, getPhoto, listPendingPurchases, purgeExpiredPhotos, storePhoto } from "./photos.ts";
import { jpegWithExif, pgliteSql } from "./test-support.ts";

const keys = deriveHashKeys("test-secret-not-real-0123456789abcdef");
const limits = RECEIPT_CODE_LIMITS;
const photoLimits = RECEIPT_PHOTO_LIMITS;

let db: PGlite;
let sql: Sql;
let seq = 0;

before(async () => {
  db = new PGlite();
  await db.waitReady;
  for (const name of ["0002_foundation.sql", "0004_receipt_codes.sql", "0005_receipt_photos.sql"]) {
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

/** A unique JPEG each call (so duplicate checks only fire when meant to). */
function photo(when?: string): Uint8Array {
  seq += 1;
  const base = when
    ? jpegWithExif({ little: true, when, offset: "+00:00" })
    : new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  const out = new Uint8Array(base.length + 4);
  out.set(base);
  new DataView(out.buffer).setUint32(base.length, seq);
  return out;
}

function exifNow(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Claim a fresh code as `userId`; returns the printed code and the pending purchase id. */
async function claimed(userId = "u1", mode: "handout_batch" | "till_single_purchase" = "handout_batch") {
  const gen = await generateCodes(sql, { userId: "owner1", campaignId: "c1", count: 1, issueMode: mode, keys, limits });
  assert.equal(gen.outcome, "ok");
  const printed = (gen as { codes: string[] }).codes[0];
  seq += 1;
  const ipHash = hashIp(`203.0.113.${seq % 250}-${seq}`, keys);
  const dev = await ensureDevice(sql, { rawToken: null, ipHash, limits });
  assert.ok(dev.ok);
  const r = await claimCode(sql, {
    rawCode: printed,
    deviceId: dev.deviceId,
    userId,
    ipHash,
    details: { productLabel: "Flat white", orderValueCents: 450, currency: "USD", purchasedAt: new Date(Date.now() - 60_000).toISOString() },
    keys,
    limits,
  });
  assert.equal(r.outcome, "ok");
  return { printed, purchaseId: (r as { purchaseId: string }).purchaseId };
}

const store = (purchaseId: string, userId: string, bytes: Uint8Array, header: Uint8Array | null = null) =>
  storePhoto(sql, { purchaseId, userId, photo: bytes, header, limits: photoLimits });

const decide = (
  purchaseId: string,
  decision: "verified" | "rejected",
  over: { reason?: string; cents?: number | null; admin?: string } = {},
) =>
  decidePurchase(sql, {
    purchaseId,
    adminUserId: over.admin ?? "admin1",
    decision,
    reason: over.reason ?? "",
    confirmedOrderValueCents: over.cents === undefined ? 450 : over.cents,
    limits: photoLimits,
  });

async function purchase(id: string) {
  return (await sql.query<Record<string, unknown>>(`select * from verified_purchases where id = $1`, [id]))[0];
}

// ------------------------------------------------------------ the person's side

test("the purchaser finds their own claim; nobody else can", async () => {
  const { printed, purchaseId } = await claimed("u1");
  const mine = await findMyClaim(sql, { rawCode: printed, userId: "u1", keys });
  assert.deepEqual(mine, { outcome: "ok", purchaseId, status: "pending", hasPhoto: false });
  assert.equal((await findMyClaim(sql, { rawCode: printed, userId: "u2", keys })).outcome, "not_found");
  assert.equal((await findMyClaim(sql, { rawCode: "junk", userId: "u1", keys })).outcome, "not_found");
});

test("only the purchaser can upload, and the 'taken at' time comes from the original header", async () => {
  const { purchaseId } = await claimed("u1");
  assert.equal((await store(purchaseId, "u2", photo())).outcome, "not_found");
  assert.equal((await store("no-such-purchase", "u1", photo())).outcome, "not_found");
  const compressed = photo(); // no EXIF, like a canvas re-encode
  const original = photo(exifNow(-5 * 60_000));
  assert.equal((await store(purchaseId, "u1", compressed, original)).outcome, "ok");
  const row = (await sql.query<Record<string, unknown>>(`select * from receipt_photos where verified_purchase_id = $1`, [purchaseId]))[0];
  assert.equal(row.mime_type, "image/jpeg");
  assert.equal(row.byte_size, compressed.length);
  assert.ok(row.exif_taken_at);
  assert.equal(row.exif_has_offset, true);
  const logged = await sql.query<{ outcome: string; user_id: string }>(
    `select outcome, user_id from receipt_code_events
      where kind = 'photo_upload' and detail->>'purchase_id' = $1 order by at`,
    [purchaseId],
  );
  // The refused attempt by someone else is logged too, then the real upload.
  assert.deepEqual(logged.map((e) => `${e.user_id}:${e.outcome}`), ["u2:not_found", "u1:ok"]);
});

test("non-images, empty files and oversized photos are refused", async () => {
  const { purchaseId } = await claimed("u1");
  assert.equal((await store(purchaseId, "u1", new TextEncoder().encode("<svg onload=alert(1)>"))).outcome, "bad_photo");
  assert.equal((await store(purchaseId, "u1", new Uint8Array())).outcome, "bad_photo");
  const big = new Uint8Array(photoLimits.maxPhotoBytes + 1);
  big.set([0xff, 0xd8, 0xff]);
  assert.equal((await store(purchaseId, "u1", big)).outcome, "too_big");
});

test("the same photo can never back two purchases, even after it is replaced", async () => {
  const a = await claimed("u1");
  const b = await claimed("u2");
  const shared = photo();
  assert.equal((await store(a.purchaseId, "u1", shared)).outcome, "ok");
  assert.equal((await store(a.purchaseId, "u1", shared)).outcome, "ok"); // same purchase again is fine
  assert.equal((await store(b.purchaseId, "u2", shared)).outcome, "duplicate_photo");
  assert.equal((await store(a.purchaseId, "u1", photo())).outcome, "ok"); // replaced
  assert.equal((await store(b.purchaseId, "u2", shared)).outcome, "duplicate_photo"); // still refused
  const n = await sql.query<{ n: number }>(`select count(*)::int as n from receipt_photos where verified_purchase_id = $1`, [a.purchaseId]);
  assert.equal(n[0].n, 1);
});

// ------------------------------------------------------------ the admin side

test("pending list shows typed details and flags; a person approves with the receipt amount", async () => {
  const { purchaseId } = await claimed("u1");
  assert.equal((await store(purchaseId, "u1", photo(), photo(exifNow()))).outcome, "ok");
  const list = await listPendingPurchases(sql, { limits: photoLimits });
  const item = list.find((p) => p.purchaseId === purchaseId);
  assert.ok(item);
  assert.equal(item.typedOrderValueCents, 450);
  assert.equal(item.merchantName, "Corner Cafe");
  assert.equal(item.hasPhoto, true);
  assert.ok(item.checks.some((c) => c.code === "handout_code"));
  assert.ok(!item.checks.some((c) => c.code === "photo_outside_campaign"));

  const shown = await getPhoto(sql, purchaseId);
  assert.ok(shown && shown.mimeType === "image/jpeg" && shown.bytes.length > 0);

  assert.equal((await decide(purchaseId, "verified", { cents: 520 })).outcome, "ok");
  const p = await purchase(purchaseId);
  assert.equal(p.verification_status, "verified");
  assert.equal(p.verification_method, "receipt_code_and_photo");
  assert.equal(p.order_value_cents, 520);
  assert.ok(p.verified_at);
  const d = (await sql.query<Record<string, unknown>>(
    `select * from purchase_verification_decisions where verified_purchase_id = $1`, [purchaseId],
  ))[0];
  assert.equal(d.typed_order_value_cents, 450);
  assert.equal(d.confirmed_order_value_cents, 520);
  assert.equal(d.decided_by_user_id, "admin1");
  assert.ok(Array.isArray(d.checks) && (d.checks as { code: string }[]).some((c) => c.code === "handout_code"));
  assert.ok(!(await listPendingPurchases(sql, { limits: photoLimits })).some((x) => x.purchaseId === purchaseId));
});

test("a photo taken outside the offer's dates is flagged, not rejected", async () => {
  const { purchaseId } = await claimed("u1");
  await store(purchaseId, "u1", photo(), photo("2025:01:01 09:00:00"));
  const item = (await listPendingPurchases(sql, { limits: photoLimits })).find((p) => p.purchaseId === purchaseId);
  assert.ok(item?.checks.some((c) => c.code === "photo_outside_campaign"));
  assert.equal((await purchase(purchaseId)).verification_status, "pending");
});

test("approval needs a photo and an amount; turning down needs a reason", async () => {
  const { purchaseId } = await claimed("u1");
  assert.equal((await decide(purchaseId, "verified")).outcome, "no_photo");
  await store(purchaseId, "u1", photo());
  assert.equal((await decide(purchaseId, "verified", { cents: null })).outcome, "bad_value");
  assert.equal((await decide(purchaseId, "verified", { cents: -5 })).outcome, "bad_value");
  assert.equal((await decide(purchaseId, "rejected", { reason: "  " })).outcome, "reason_required");
  assert.equal((await decide(purchaseId, "rejected", { reason: "Receipt is from another shop" })).outcome, "ok");
  assert.equal((await purchase(purchaseId)).verification_status, "rejected");
  assert.equal((await decide(purchaseId, "verified")).outcome, "already_decided");
  assert.equal((await store(purchaseId, "u1", photo())).outcome, "already_decided");
});

test("no deciding your own purchase, and no approving a switched-off code", async () => {
  const own = await claimed("admin1");
  await store(own.purchaseId, "admin1", photo());
  assert.equal((await decide(own.purchaseId, "verified", { admin: "admin1" })).outcome, "own_purchase");

  const { printed, purchaseId } = await claimed("u1", "till_single_purchase");
  await store(purchaseId, "u1", photo());
  const code = (await sql.query<{ id: string }>(`select receipt_code_id as id from verified_purchases where id = $1`, [purchaseId]))[0];
  assert.ok(printed && code.id);
  await suspendCode(sql, { codeId: code.id, reason: "Reported shared", actorUserId: "admin1" });
  assert.equal((await decide(purchaseId, "verified")).outcome, "code_not_usable");
  assert.equal((await purchase(purchaseId)).verification_status, "pending");
});

test("one decision per purchase, and decisions and hashes can't be changed", async () => {
  const { purchaseId } = await claimed("u1");
  await store(purchaseId, "u1", photo());
  assert.equal((await decide(purchaseId, "verified")).outcome, "ok");
  assert.equal((await decide(purchaseId, "rejected", { reason: "changed my mind" })).outcome, "already_decided");
  await assert.rejects(sql.query(`update purchase_verification_decisions set decision = 'rejected'`), /append-only/);
  await assert.rejects(sql.query(`delete from purchase_verification_decisions`), /append-only/);
  await assert.rejects(sql.query(`delete from receipt_photo_hashes`), /append-only/);
});

test("photos are deleted after retention; the hash still blocks reuse", async () => {
  const a = await claimed("u1");
  const b = await claimed("u2");
  const bytes = photo();
  await store(a.purchaseId, "u1", bytes);
  await sql.query(
    `update receipt_photos set uploaded_at = now() - interval '90 days', delete_after = now() - interval '1 second'
      where verified_purchase_id = $1`,
    [a.purchaseId],
  );
  assert.ok((await purgeExpiredPhotos(sql)) >= 1);
  assert.equal(await getPhoto(sql, a.purchaseId), null);
  const row = (await sql.query<Record<string, unknown>>(`select * from receipt_photos where verified_purchase_id = $1`, [a.purchaseId]))[0];
  assert.equal(row.photo, null);
  assert.ok(row.deleted_at);
  assert.equal((await store(b.purchaseId, "u2", bytes)).outcome, "duplicate_photo");
  assert.equal((await decide(a.purchaseId, "verified")).outcome, "no_photo"); // can't approve what nobody can see
  const purgeLog = await sql.query<{ n: number }>(`select count(*)::int as n from receipt_code_events where kind = 'photo_purge'`);
  assert.ok(purgeLog[0].n >= 1);
});

test("a handout purchase still can't be verified by hand without the photo method (3a guard holds)", async () => {
  const { purchaseId } = await claimed("u1");
  await assert.rejects(
    sql.query(`update verified_purchases set verification_status = 'verified', verified_at = now() where id = $1`, [purchaseId]),
    /receipt photo/,
  );
});

test("new tables carry no reward or payout data (FR-27, PAY-01)", async () => {
  const cols = await sql.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_name in ('receipt_photos', 'receipt_photo_hashes', 'purchase_verification_decisions')
        and column_name ~ '(pay|reward|amount|cap|floor|percent|rating)'`,
  );
  assert.deepEqual(cols, []);
});
