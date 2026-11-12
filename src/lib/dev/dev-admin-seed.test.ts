// Ticket 3b-2 — the dev-only admin email list and the local test-data seed,
// on a throwaway in-memory PGlite with the real migrations 0001–0005.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { deriveHashKeys, hashIp } from "../receipt-codes/codes.ts";
import { ensureDevice, scanCode } from "../receipt-codes/engine.ts";
import { devOnlyEnv, findAuthEmail, isAdminCaller, parseAdminEmails } from "../receipt-codes/admin.ts";
import { RECEIPT_CODE_LIMITS } from "../receipt-codes/limits.ts";
import { pgliteSql } from "../receipt-codes/test-support.ts";
import { DEV_SEED, devSeedAllowed, seedDevData } from "./seed.ts";

const keys = deriveHashKeys("test-secret-not-real-0123456789abcdef");
let db: PGlite;
let sql: Sql;

before(async () => {
  db = new PGlite();
  await db.waitReady;
  for (const name of [
    "0001_auth.sql",
    "0002_foundation.sql",
    "0003_link_users_to_auth.sql",
    "0004_receipt_codes.sql",
    "0005_receipt_photos.sql",
  ]) {
    await db.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.exec(`
    insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values
      ('admin1', 'Admin', 'Admin@Example.com', false, now(), now()),
      ('buyer1', 'Buyer', 'buyer@example.com', false, now(), now());
  `);
  sql = pgliteSql(db);
});

after(async () => {
  await db.close();
});

const lookup = (id: string) => findAuthEmail(sql, id);

test("devOnlyEnv is true only for development and test", () => {
  assert.equal(devOnlyEnv("development"), true);
  assert.equal(devOnlyEnv("test"), true);
  for (const v of ["production", "", undefined, null, "Development", "staging"]) assert.equal(devOnlyEnv(v), false, String(v));
  assert.equal(devSeedAllowed("production"), false);
});

test("parseAdminEmails trims, lower-cases and drops junk", () => {
  assert.deepEqual([...parseAdminEmails(" A@Example.com , ,nope, b@x.io ")], ["a@example.com", "b@x.io"]);
  assert.equal(parseAdminEmails(undefined).size, 0);
  assert.equal(parseAdminEmails("a@b@c").size, 0);
});

test("findAuthEmail reads the login email", async () => {
  assert.equal(await findAuthEmail(sql, "buyer1"), "buyer@example.com");
  assert.equal(await findAuthEmail(sql, "nobody"), null);
});

test("dev email list works in development, case-insensitively", async () => {
  const env = { NODE_ENV: "development", TRUFOLKS_ADMIN_EMAILS_DEV: "admin@example.com" };
  assert.equal(await isAdminCaller("admin1", { lookupEmail: lookup, env }), true);
  assert.equal(await isAdminCaller("buyer1", { lookupEmail: lookup, env }), false);
  assert.equal(await isAdminCaller("nobody", { lookupEmail: lookup, env }), false);
});

test("dev email list is ignored in production and when NODE_ENV is unset", async () => {
  for (const NODE_ENV of ["production", undefined]) {
    const env = { NODE_ENV, TRUFOLKS_ADMIN_EMAILS_DEV: "admin@example.com" };
    assert.equal(await isAdminCaller("admin1", { lookupEmail: lookup, env }), false, String(NODE_ENV));
  }
});

test("the user-id allowlist works everywhere and needs no email lookup", async () => {
  const noLookup = async () => {
    throw new Error("should not look up");
  };
  const env = { NODE_ENV: "production", TRUFOLKS_ADMIN_USER_IDS: "admin1" };
  assert.equal(await isAdminCaller("admin1", { lookupEmail: noLookup, env }), true);
  // No dev list set → no lookup either.
  assert.equal(await isAdminCaller("buyer1", { lookupEmail: noLookup, env: { NODE_ENV: "development" } }), false);
});

test("the shared dev-user is never an admin", async () => {
  const env = { NODE_ENV: "development", TRUFOLKS_ADMIN_USER_IDS: "dev-user", TRUFOLKS_ADMIN_EMAILS_DEV: "dev@example.com" };
  assert.equal(await isAdminCaller("dev-user", { lookupEmail: async () => "dev@example.com", env }), false);
  assert.equal(await isAdminCaller(null, { lookupEmail: lookup, env }), false);
});

test("seedDevData makes a live offer with codes that scan, and can run again", async () => {
  const first = await seedDevData(sql, { keys, limits: RECEIPT_CODE_LIMITS });
  assert.equal(first.codes.length, DEV_SEED.codeCount);
  assert.equal(first.merchantName, DEV_SEED.merchantName);
  for (const c of first.codes) assert.equal(c.path, `/r/${c.printed}`);

  const second = await seedDevData(sql, { keys, limits: RECEIPT_CODE_LIMITS });
  assert.equal(second.codes.length, DEV_SEED.codeCount);
  assert.notDeepEqual(second.codes, first.codes);

  const counts = await sql.query<{ m: number; c: number; u: number }>(
    `select (select count(*)::int from merchants where id = $1) as m,
            (select count(*)::int from campaigns where id = $2) as c,
            (select count(*)::int from users where id = $3) as u`,
    [DEV_SEED.merchantId, DEV_SEED.campaignId, DEV_SEED.ownerUserId],
  );
  assert.deepEqual(counts[0], { m: 1, c: 1, u: 1 });

  const dev = await ensureDevice(sql, { rawToken: null, ipHash: hashIp("198.51.100.77", keys), limits: RECEIPT_CODE_LIMITS });
  assert.ok(dev.ok);
  const scan = await scanCode(sql, {
    rawCode: first.codes[0].path,
    deviceId: dev.deviceId,
    ipHash: hashIp("198.51.100.77", keys),
    keys,
    limits: RECEIPT_CODE_LIMITS,
  });
  assert.equal(scan.outcome, "ok");
});

test("the placeholder owner has no password, so it can't sign in", async () => {
  const rows = await sql.query<{ n: number }>(`select count(*)::int as n from "account" where "userId" = $1`, [DEV_SEED.ownerUserId]);
  assert.equal(rows[0].n, 0);
});
