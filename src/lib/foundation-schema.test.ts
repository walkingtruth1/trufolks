// Ticket 1 — foundation schema guardrails (BRD v1.6 §2A, §13).
// Loads migrations/0002_foundation.sql into a throwaway in-memory PGlite and
// checks the rules the schema itself must enforce. No network, no real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../../migrations/0002_foundation.sql", import.meta.url);
let db: PGlite;
let seq = 0;

before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(`
    insert into users (id, display_name) values
      ('u1', 'Ana'), ('u2', 'Ben'), ('owner1', 'Cafe Owner'), ('owner2', 'Bakery Owner');
    insert into merchants (id, owner_user_id, name) values
      ('m1', 'owner1', 'Corner Cafe'), ('m2', 'owner2', 'Main St Bakery');
    insert into campaigns (id, merchant_id, name, campaign_type, starts_at, ends_at) values
      ('c1', 'm1', 'Pilot', 'A', now(), now() + interval '14 days'),
      ('c2', 'm2', 'Pilot', 'A', now(), now() + interval '14 days');
  `);
});

after(async () => {
  await db.close();
});

async function purchase(
  userId = "u1",
  merchantId = "m1",
  campaignId: string | null = "c1",
  valueCents = 500,
): Promise<string> {
  seq += 1;
  const id = `p${seq}`;
  await db.query(
    `insert into verified_purchases
       (id, user_id, merchant_id, campaign_id, product_label, order_value_cents,
        verification_method, verification_status, purchased_at, verified_at)
     values ($1, $2, $3, $4, 'Flat white', $5, 'receipt_code', 'verified', now(), now())`,
    [id, userId, merchantId, campaignId, valueCents],
  );
  return id;
}

async function review(
  purchaseId: string,
  userId = "u1",
  fields: { rating?: number; whatUsed?: string; howLong?: string; thought?: string; createdAt?: string } = {},
): Promise<string> {
  seq += 1;
  const id = `r${seq}`;
  await db.query(
    `insert into reviews
       (id, user_id, verified_purchase_id, rating, what_used, how_long, honest_thought, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [
      id,
      userId,
      purchaseId,
      fields.rating ?? 3,
      fields.whatUsed ?? "Flat white",
      fields.howLong ?? "Drank it there",
      fields.thought ?? "Bit bitter, good foam.",
      fields.createdAt ?? null,
    ],
  );
  return id;
}

test("rating must be 1 to 5", async () => {
  await assert.rejects(review(await purchase(), "u1", { rating: 0 }));
  await assert.rejects(review(await purchase(), "u1", { rating: 6 }));
  await review(await purchase(), "u1", { rating: 1 }); // a 1-star is valid
});

test("all three honest fields are required (FR-11)", async () => {
  await assert.rejects(review(await purchase(), "u1", { whatUsed: "" }));
  await assert.rejects(review(await purchase(), "u1", { howLong: "   " }));
  await assert.rejects(review(await purchase(), "u1", { thought: "" }));
});

test("one review per verified purchase (HON-04)", async () => {
  const p = await purchase();
  await review(p);
  await assert.rejects(review(p));
});

test("only the purchaser can review a purchase", async () => {
  const p = await purchase("u1");
  await assert.rejects(review(p, "u2"));
});

test("a person cannot be their own contact", async () => {
  await assert.rejects(
    db.query(`insert into contacts (owner_user_id, contact_user_id) values ('u1', 'u1')`),
  );
  await db.query(`insert into contacts (owner_user_id, contact_user_id) values ('u1', 'u2')`);
});

test("order value cannot be negative", async () => {
  await assert.rejects(purchase("u1", "m1", "c1", -1));
});

test("a purchase's campaign must belong to the same merchant", async () => {
  await assert.rejects(purchase("u1", "m1", "c2"));
});

test("Top 5 view returns the five newest reviews per user", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const at = new Date(Date.UTC(2026, 10, 1 + i)).toISOString();
    ids.push(await review(await purchase("u2"), "u2", { createdAt: at }));
  }
  const rows = await db.query<{ id: string }>(
    `select id from user_top5_reviews where user_id = 'u2' order by recency_rank`,
  );
  assert.deepEqual(
    rows.rows.map((r) => r.id),
    ids.slice(2).reverse(),
  );
});

test("merchant view only returns that merchant's reviews", async () => {
  const bakeryReview = await review(await purchase("u1", "m2", "c2"));
  const m2 = await db.query<{ review_id: string }>(
    `select review_id from merchant_reviews where merchant_id = 'm2'`,
  );
  assert.deepEqual(m2.rows.map((r) => r.review_id), [bakeryReview]);
  const m1 = await db.query<{ review_id: string }>(
    `select review_id from merchant_reviews where merchant_id = 'm1'`,
  );
  assert.ok(m1.rows.length > 0);
  assert.ok(!m1.rows.some((r) => r.review_id === bakeryReview));
});

test("reviews carry no payout or reward data (FR-27)", async () => {
  const cols = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_name = 'reviews' and column_name ~ '(pay|reward|amount|cents|cap|floor|percent)'`,
  );
  assert.deepEqual(cols.rows, []);
});
