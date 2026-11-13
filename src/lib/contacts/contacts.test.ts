// Ticket 5 — contacts and the contacts feed against a throwaway in-memory
// PGlite with the real 0002 + 0004 + 0005 + 0006 + 0007 migrations.
// Reviews are posted through the real trufolks_submit_review, so the
// disclosure is the real one from trufolks_review_disclosure:
//   * a campaign purchase → disclosure.complete = false (reward not set, gap 18)
//   * a no-campaign purchase → disclosure.complete = true
// Purchases are inserted directly as verified receipt-photo purchases (the
// receipt-code path is covered by the Ticket 3/4 tests).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { pgliteSql } from "../receipt-codes/test-support.ts";
import { submitReview } from "../reviews/engine.ts";
import { REVIEW_LIMITS } from "../reviews/limits.ts";
import {
  acceptInvite,
  changeContact,
  contactFeed,
  contactPlaces,
  createInvite,
  encodeFeedCursor,
  getInviteState,
  listContacts,
  lookupInvite,
  parseFeedCursor,
  personHistory,
  revokeInvite,
} from "./engine.ts";
import { hashInviteToken, isInviteTokenShape, newInviteToken } from "./invite-token.ts";
import { CONTACT_LIMITS } from "./limits.ts";
import { contactMessage, CONTACT_OUTCOMES } from "./messages.ts";

let db: PGlite;
let sql: Sql;
let seq = 0;

before(async () => {
  db = new PGlite();
  await db.waitReady;
  for (const name of [
    "0002_foundation.sql",
    "0004_receipt_codes.sql",
    "0005_receipt_photos.sql",
    "0006_reviews.sql",
    "0007_contacts_feed.sql",
  ]) {
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into users (id, display_name) values
      ('owner1', 'Cafe Owner'), ('owner2', 'Bakery Owner');
    insert into merchants (id, owner_user_id, name, verification_status, terms_accepted_at, walkthrough_accepted_at) values
      ('m1', 'owner1', 'Corner Cafe', 'verified', now(), now()),
      ('m2', 'owner2', 'Main St Bakery', 'verified', now(), now());
    insert into campaigns (id, merchant_id, name, campaign_type, starts_at, ends_at, status) values
      ('c1', 'm1', 'Pilot', 'A', now() - interval '1 day', now() + interval '14 days', 'live');
  `);
  sql = pgliteSql(db);
});

after(async () => {
  await db.close();
});

async function person(name: string): Promise<string> {
  seq += 1;
  const id = `p${seq}`;
  await sql.query(`insert into users (id, display_name) values ($1, $2)`, [id, name]);
  return id;
}

/** A verified purchase and a posted review. `campaign` → incomplete disclosure. */
async function review(
  userId: string,
  opts: { merchant?: string; campaign?: boolean; rating?: number; at?: string } = {},
): Promise<string> {
  seq += 1;
  const purchaseId = `vp${seq}`;
  await sql.query(
    `insert into verified_purchases (id, user_id, merchant_id, campaign_id, product_label, order_value_cents,
                                     verification_method, verification_status, purchased_at, verified_at)
     values ($1, $2, $3, $4, 'Flat white', 450, 'receipt_photo', 'verified', now() - interval '1 hour', now())`,
    [purchaseId, userId, opts.merchant ?? "m1", opts.campaign ? "c1" : null],
  );
  const r = await submitReview(sql, {
    purchaseId,
    userId,
    fields: { rating: opts.rating ?? 4, whatUsed: "A flat white", howLong: "One cup", honestThought: "Good, a bit hot." },
    limits: REVIEW_LIMITS,
  });
  assert.equal(r.outcome, "ok");
  const id = (r as { review: { reviewId: string } }).review.reviewId;
  if (opts.at) {
    // Spread reviews out in time for ordering tests. created_at is locked by
    // the FR-15 trigger, so lift it for this one test-only statement.
    await db.exec(`alter table reviews disable trigger reviews_locked`);
    await sql.query(`update reviews set created_at = $2 where id = $1`, [id, opts.at]);
    await db.exec(`alter table reviews enable trigger reviews_locked`);
  }
  return id;
}

async function connect(a: string, b: string): Promise<void> {
  const inv = await createInvite(sql, { userId: a, limits: CONTACT_LIMITS });
  assert.equal(inv.outcome, "ok");
  const acc = await acceptInvite(sql, { token: (inv as { token: string }).token, userId: b });
  assert.equal(acc.outcome, "ok");
}

// ------------------------------------------------------------------ tokens and messages

test("invite tokens are 43 url-safe characters and only their SHA-256 is stored", async () => {
  const t = newInviteToken();
  assert.ok(isInviteTokenShape(t));
  assert.notEqual(newInviteToken(), t);
  assert.match(hashInviteToken(t), /^[0-9a-f]{64}$/);
  assert.equal(isInviteTokenShape("short"), false);
  assert.equal(isInviteTokenShape(`${t}/`), false);
  assert.equal(isInviteTokenShape(null), false);

  const a = await person("Ana");
  const inv = await createInvite(sql, { userId: a, limits: CONTACT_LIMITS, token: t });
  assert.equal(inv.outcome, "ok");
  const stored = await sql.query<{ token_hash: string }>(`select token_hash from contact_invites where user_id = $1`, [a]);
  assert.deepEqual(
    stored.map((s) => s.token_hash),
    [hashInviteToken(t)],
  );
  const raw = await sql.query(`select 1 from contact_invites where token_hash = $1`, [t]);
  assert.equal(raw.length, 0);
});

test("every contacts outcome except ok has a plain message", () => {
  for (const o of CONTACT_OUTCOMES) {
    if (o === "ok") assert.equal(contactMessage(o), null);
    else assert.ok((contactMessage(o) ?? "").length > 10, o);
  }
});

test("feed cursor round-trips and refuses junk", () => {
  const at = new Date("2026-11-01T10:00:00.000Z").toISOString();
  assert.deepEqual(parseFeedCursor(encodeFeedCursor(at, "r1")), { createdAt: at, reviewId: "r1" });
  for (const bad of [null, 5, "", "~r1", "not-a-date~r1", `${at}~`, "x".repeat(300)]) {
    assert.equal(parseFeedCursor(bad), null, String(bad));
  }
});

// ------------------------------------------------------------------ invite links

test("accepting an invite makes two people mutual contacts", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  const inv = await createInvite(sql, { userId: a, limits: CONTACT_LIMITS });
  assert.equal(inv.outcome, "ok");
  const token = (inv as { token: string }).token;

  assert.deepEqual(await lookupInvite(sql, { token, userId: b }), { outcome: "ok", inviterName: "Ana" });
  assert.deepEqual(await lookupInvite(sql, { token, userId: a }), { outcome: "own_invite", inviterName: "Ana" });
  assert.equal((await acceptInvite(sql, { token, userId: a })).outcome, "own_invite");

  const acc = await acceptInvite(sql, { token, userId: b });
  assert.deepEqual(acc, { outcome: "ok", inviterId: a });
  assert.deepEqual(
    (await listContacts(sql, { userId: a })).contacts.map((c) => c.name),
    ["Ben"],
  );
  assert.deepEqual(
    (await listContacts(sql, { userId: b })).contacts.map((c) => c.name),
    ["Ana"],
  );
  assert.equal((await acceptInvite(sql, { token, userId: b })).outcome, "already_contacts");

  // The same link works for several people the inviter knows.
  const c = await person("Cleo");
  assert.equal((await acceptInvite(sql, { token, userId: c })).outcome, "ok");
  assert.deepEqual(
    (await listContacts(sql, { userId: a })).contacts.map((x) => x.name),
    ["Ben", "Cleo"],
  );
  const events = await sql.query<{ event: string }>(
    `select event from contact_events where user_id in ($1, $2, $3) order by at, event`,
    [a, b, c],
  );
  assert.deepEqual(
    events.map((e) => e.event).sort(),
    ["accepted", "accepted", "invite_created"],
  );
});

test("a new link turns the old one off; a turned-off, expired or unknown link does nothing", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  const first = (await createInvite(sql, { userId: a, limits: CONTACT_LIMITS })) as { token: string };
  const second = (await createInvite(sql, { userId: a, limits: CONTACT_LIMITS })) as { token: string };
  assert.equal((await lookupInvite(sql, { token: first.token, userId: b })).outcome, "not_found");
  assert.equal((await acceptInvite(sql, { token: first.token, userId: b })).outcome, "not_found");
  assert.ok(await getInviteState(sql, { userId: a }));

  assert.equal(await revokeInvite(sql, { userId: a }), "ok");
  assert.equal(await revokeInvite(sql, { userId: a }), "not_found");
  assert.equal(await getInviteState(sql, { userId: a }), null);
  assert.equal((await acceptInvite(sql, { token: second.token, userId: b })).outcome, "not_found");

  const short = (await createInvite(sql, { userId: a, limits: { ...CONTACT_LIMITS, inviteLifetimeSeconds: 1 } })) as {
    token: string;
  };
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await acceptInvite(sql, { token: short.token, userId: b })).outcome, "not_found");

  assert.equal((await acceptInvite(sql, { token: newInviteToken(), userId: b })).outcome, "not_found");
  assert.equal((await acceptInvite(sql, { token: "../../etc", userId: b })).outcome, "not_found");
  assert.equal((await listContacts(sql, { userId: b })).contacts.length, 0);
});

test("an invite's owner, hash and dates can't be changed, and invites can't be deleted", async () => {
  const a = await person("Ana");
  await createInvite(sql, { userId: a, limits: CONTACT_LIMITS });
  await assert.rejects(sql.query(`update contact_invites set expires_at = now() + interval '9 years' where user_id = $1`, [a]));
  await assert.rejects(sql.query(`update contact_invites set user_id = 'owner1' where user_id = $1`, [a]));
  await assert.rejects(sql.query(`delete from contact_invites where user_id = $1`, [a]));
  await assert.rejects(sql.query(`delete from contact_events where user_id = $1`, [a]));
});

test("a deleted account's invite link stops working", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  const inv = (await createInvite(sql, { userId: a, limits: CONTACT_LIMITS })) as { token: string };
  await sql.query(`update users set deleted_at = now() where id = $1`, [a]);
  assert.equal((await acceptInvite(sql, { token: inv.token, userId: b })).outcome, "not_found");
});

// ------------------------------------------------------------------ remove / block

test("removing a contact removes both sides", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  await connect(a, b);
  assert.equal(await changeContact(sql, { userId: b, otherId: a, action: "remove" }), "ok");
  assert.equal((await listContacts(sql, { userId: a })).contacts.length, 0);
  assert.equal((await listContacts(sql, { userId: b })).contacts.length, 0);
  assert.equal(await changeContact(sql, { userId: b, otherId: a, action: "remove" }), "not_found");
});

test("blocking: the blocked person loses sight and can't reconnect; the blocker must unblock", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  await connect(a, b);
  await review(a, { campaign: false });

  assert.equal(await changeContact(sql, { userId: a, otherId: b, action: "block" }), "ok");
  assert.equal((await contactFeed(sql, { viewerId: b, limits: CONTACT_LIMITS })).reviews.length, 0);
  assert.equal((await personHistory(sql, { viewerId: b, personId: a, limits: CONTACT_LIMITS })).outcome, "not_contact");
  assert.equal((await listContacts(sql, { userId: b })).contacts.length, 0);
  assert.deepEqual(
    (await listContacts(sql, { userId: a })).blocked.map((x) => x.name),
    ["Ben"],
  );

  // Ana's old link: Ben is told only that it doesn't work (the block isn't revealed).
  const inv = (await createInvite(sql, { userId: a, limits: CONTACT_LIMITS })) as { token: string };
  assert.equal((await lookupInvite(sql, { token: inv.token, userId: b })).outcome, "not_found");
  assert.equal((await acceptInvite(sql, { token: inv.token, userId: b })).outcome, "not_found");
  // Ben's link to Ana: Ana is told she blocked him.
  const benInv = (await createInvite(sql, { userId: b, limits: CONTACT_LIMITS })) as { token: string };
  assert.equal((await acceptInvite(sql, { token: benInv.token, userId: a })).outcome, "you_blocked");

  // Unblocking doesn't reconnect; a fresh accept does.
  assert.equal(await changeContact(sql, { userId: a, otherId: b, action: "unblock" }), "ok");
  assert.equal((await listContacts(sql, { userId: a })).contacts.length, 0);
  assert.equal((await acceptInvite(sql, { token: inv.token, userId: b })).outcome, "ok");
  assert.equal((await contactFeed(sql, { viewerId: b, limits: CONTACT_LIMITS })).reviews.length, 1);
});

test("you can only block or remove your own contacts, and never yourself", async () => {
  const a = await person("Ana");
  const stranger = await person("Stranger");
  assert.equal(await changeContact(sql, { userId: a, otherId: stranger, action: "block" }), "not_found");
  assert.equal(await changeContact(sql, { userId: a, otherId: a, action: "block" }), "not_found");
  assert.equal(await changeContact(sql, { userId: a, otherId: stranger, action: "unblock" }), "not_found");
});

// ------------------------------------------------------------------ the feed (P1, FR-16, LEG-01)

test("gap 19: a review whose disclosure isn't complete is never shown to contacts", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  await connect(a, b);
  const incomplete = await review(a, { campaign: true });
  const complete = await review(a, { campaign: false });

  const stored = await sql.query<{ id: string; complete: boolean }>(
    `select id, (disclosure ->> 'complete')::boolean as complete from reviews where id in ($1, $2)`,
    [incomplete, complete],
  );
  assert.deepEqual(Object.fromEntries(stored.map((s) => [s.id, s.complete])), { [incomplete]: false, [complete]: true });

  // The SQL rule itself.
  const raw = await sql.query<{ review_id: string }>(`select review_id from trufolks_contact_reviews($1)`, [b]);
  assert.deepEqual(
    raw.map((r) => r.review_id),
    [complete],
  );
  // The feed, the places list and the history all go through it.
  assert.deepEqual(
    (await contactFeed(sql, { viewerId: b, limits: CONTACT_LIMITS })).reviews.map((r) => r.reviewId),
    [complete],
  );
  assert.deepEqual(
    (await contactPlaces(sql, { viewerId: b })).map((p) => p.reviewCount),
    [1],
  );
  const h = await personHistory(sql, { viewerId: b, personId: a, limits: CONTACT_LIMITS });
  assert.equal(h.outcome, "ok");
  assert.deepEqual(
    (h as { history: { reviews: { reviewId: string }[] } }).history.reviews.map((r) => r.reviewId),
    [complete],
  );

  // On her own page Ana sees both, with the hidden one marked.
  const mine = await personHistory(sql, { viewerId: a, personId: a, limits: CONTACT_LIMITS });
  assert.equal(mine.outcome, "ok");
  const shown = Object.fromEntries(
    (mine as { history: { reviews: { reviewId: string; shownToContacts: boolean }[] } }).history.reviews.map((r) => [
      r.reviewId,
      r.shownToContacts,
    ]),
  );
  assert.deepEqual(shown, { [incomplete]: false, [complete]: true });
});

test("gap 19: a missing, malformed or not-rating-blind disclosure is hidden too", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  await connect(a, b);
  const ids = [await review(a), await review(a), await review(a)];
  await db.exec(`alter table reviews disable trigger reviews_locked`);
  await sql.query(`update reviews set disclosure = '{"complete": "true", "rating_blind": true}'::jsonb where id = $1`, [ids[0]]);
  await sql.query(`update reviews set disclosure = '{"complete": true, "rating_blind": false}'::jsonb where id = $1`, [ids[1]]);
  await sql.query(`update reviews set disclosure = '[true]'::jsonb where id = $1`, [ids[2]]);
  await db.exec(`alter table reviews enable trigger reviews_locked`);
  assert.equal((await contactFeed(sql, { viewerId: b, limits: CONTACT_LIMITS })).reviews.length, 0);
  // Even if one slipped past the SQL with complete = true but couldn't be read, the engine drops it.
  await db.exec(`alter table reviews disable trigger reviews_locked`);
  await sql.query(`update reviews set disclosure = '{"complete": true, "rating_blind": true}'::jsonb where id = $1`, [ids[0]]);
  await db.exec(`alter table reviews enable trigger reviews_locked`);
  assert.equal((await sql.query(`select 1 from trufolks_contact_reviews($1)`, [b])).length, 1);
  assert.equal((await contactFeed(sql, { viewerId: b, limits: CONTACT_LIMITS })).reviews.length, 0);
});

test("P1: only mutual contacts see a review — not strangers, not the business, not a one-sided row", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  const stranger = await person("Stranger");
  await connect(a, b);
  const r = await review(a);

  assert.deepEqual(
    (await contactFeed(sql, { viewerId: b, limits: CONTACT_LIMITS })).reviews.map((x) => x.reviewId),
    [r],
  );
  for (const viewer of [stranger, "owner1"]) {
    assert.equal((await contactFeed(sql, { viewerId: viewer, limits: CONTACT_LIMITS })).reviews.length, 0);
    assert.equal(
      (await personHistory(sql, { viewerId: viewer, personId: a, limits: CONTACT_LIMITS })).outcome,
      "not_contact",
    );
  }
  // A one-sided 'accepted' row (no invite accepted) shows nothing.
  await sql.query(`insert into contacts (owner_user_id, contact_user_id, status) values ($1, $2, 'accepted')`, [stranger, a]);
  assert.equal((await contactFeed(sql, { viewerId: stranger, limits: CONTACT_LIMITS })).reviews.length, 0);
  // Your own reviews aren't in your feed (they're on your own page).
  assert.equal((await contactFeed(sql, { viewerId: a, limits: CONTACT_LIMITS })).reviews.length, 0);
});

test("a deleted account's reviews disappear from contacts' feeds", async () => {
  const a = await person("Ana");
  const b = await person("Ben");
  await connect(a, b);
  await review(a);
  await sql.query(`update users set deleted_at = now() where id = $1`, [a]);
  assert.equal((await contactFeed(sql, { viewerId: b, limits: CONTACT_LIMITS })).reviews.length, 0);
  assert.equal((await listContacts(sql, { userId: b })).contacts.length, 0);
});

test("the feed is newest first, every rating included, and pages with a cursor", async () => {
  const viewer = await person("Viewer");
  const a = await person("Ana");
  const c = await person("Cleo");
  await connect(viewer, a);
  await connect(c, viewer);
  const r1 = await review(a, { rating: 1, at: "2026-11-01T10:00:00Z" });
  const r2 = await review(c, { rating: 5, at: "2026-11-02T10:00:00Z", merchant: "m2" });
  const r3 = await review(a, { rating: 3, at: "2026-11-03T10:00:00Z" });

  const limits = { ...CONTACT_LIMITS, feedPageSize: 2 };
  const p1 = await contactFeed(sql, { viewerId: viewer, limits });
  assert.deepEqual(
    p1.reviews.map((r) => r.reviewId),
    [r3, r2],
  );
  assert.ok(p1.nextCursor);
  const p2 = await contactFeed(sql, { viewerId: viewer, before: p1.nextCursor, limits });
  assert.deepEqual(
    p2.reviews.map((r) => r.reviewId),
    [r1],
  );
  assert.equal(p2.nextCursor, null);
  assert.equal(p2.reviews[0].rating, 1);

  // Card fields (FR-16) and the author id for the history link (FR-17).
  const card = p1.reviews[0];
  assert.equal(card.reviewerName, "Ana");
  assert.equal(card.authorId, a);
  assert.equal(card.merchantName, "Corner Cafe");
  assert.equal(card.productLabel, "Flat white");
  assert.equal(card.verifiedPurchase, true);
  assert.equal(card.disclosure?.complete, true);
  assert.equal(card.createdAt, "2026-11-03T10:00:00.000Z");

  // One business only (from the places list).
  assert.deepEqual(
    (await contactFeed(sql, { viewerId: viewer, merchantId: "m2", limits: CONTACT_LIMITS })).reviews.map((r) => r.reviewId),
    [r2],
  );

  // FR-18: places your contacts reviewed, most recently reviewed first.
  const places = await contactPlaces(sql, { viewerId: viewer });
  assert.deepEqual(
    places.map((p) => [p.merchantName, p.reviewCount, p.contactCount]),
    [
      ["Corner Cafe", 2, 1],
      ["Main St Bakery", 1, 1],
    ],
  );
});

test("FR-17: a contact's full history shows every rating, with a count per star", async () => {
  const viewer = await person("Viewer");
  const a = await person("Ana");
  await connect(a, viewer);
  for (const rating of [5, 5, 5, 1]) await review(a, { rating });
  await review(a, { rating: 2, campaign: true }); // not complete → not shown to contacts

  const h = await personHistory(sql, { viewerId: viewer, personId: a, limits: CONTACT_LIMITS });
  assert.equal(h.outcome, "ok");
  const history = (h as { history: { person: { name: string; isSelf: boolean }; reviews: unknown[]; ratingCounts: number[] } })
    .history;
  assert.deepEqual(history.person, { userId: a, name: "Ana", isSelf: false });
  assert.equal(history.reviews.length, 4);
  assert.deepEqual(history.ratingCounts, [1, 0, 0, 0, 3]);

  assert.equal((await personHistory(sql, { viewerId: viewer, personId: "nobody", limits: CONTACT_LIMITS })).outcome, "not_contact");
});

test("contact rows still can't point at yourself, and no follower counts exist anywhere", async () => {
  const a = await person("Ana");
  await assert.rejects(sql.query(`insert into contacts (owner_user_id, contact_user_id, status) values ($1, $1, 'accepted')`, [a]));
  const cols = await sql.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public'
        and (column_name like '%follower%' or (column_name like '%rank%' and column_name <> 'recency_rank'))`,
  );
  assert.deepEqual(cols, []);
});
