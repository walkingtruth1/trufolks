// Ticket 2a — email/password auth + users link (BRD v1.6 FR-01).
// Runs Better Auth against a throwaway in-memory PGlite with the real
// migrations applied. No network, no real secrets, no real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { pgliteDialect } from "./pglite-dialect.ts";
import { emailAndPasswordOptions, requireEmailVerification } from "./email-password.ts";
import {
  devUserAllowed,
  grokGateIdentityEnabled,
  resolveAuthConfigured,
} from "./trufolks-auth-mode.ts";

const MIGRATIONS = ["0001_auth.sql", "0002_foundation.sql", "0003_link_users_to_auth.sql"];

function makeAuth(db: PGlite) {
  return betterAuth({
    baseURL: "http://localhost:8080",
    secret: "test-only-secret-never-used-outside-this-test-0123456789",
    database: { dialect: pgliteDialect(() => db), type: "postgres" },
    emailAndPassword: emailAndPasswordOptions,
  });
}

let pg: PGlite;
let auth: ReturnType<typeof makeAuth>;
const email = "ana@example.test";
const password = "correct-horse-1";
let anaId = "";

before(async () => {
  pg = new PGlite();
  await pg.waitReady;
  for (const name of MIGRATIONS) {
    await pg.exec(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  auth = makeAuth(pg);
});

after(async () => {
  await pg.close();
});

test("sign-up creates exactly one TruFolks users row with the display name", async () => {
  const res = await auth.api.signUpEmail({ body: { name: "Ana Test", email, password } });
  anaId = res.user.id;
  const rows = await pg.query<{ display_name: string }>(
    "select display_name from users where id = $1",
    [anaId],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].display_name, "Ana Test");
});

test("sign-in works with the right password and fails with a wrong one", async () => {
  const ok = await auth.api.signInEmail({ body: { email, password } });
  assert.equal(ok.user.id, anaId);
  await assert.rejects(auth.api.signInEmail({ body: { email, password: "wrong-password-1" } }));
});

test("a duplicate email cannot sign up", async () => {
  await assert.rejects(
    auth.api.signUpEmail({ body: { name: "Ana Again", email, password: "another-pass-1" } }),
  );
});

test("passwords shorter than 8 characters are rejected", async () => {
  await assert.rejects(
    auth.api.signUpEmail({ body: { name: "Short", email: "short@example.test", password: "1234567" } }),
  );
});

test("a TruFolks users row cannot exist without a login", async () => {
  await assert.rejects(
    pg.query("insert into users (id, display_name) values ('no-login', 'Ghost')"),
  );
});

test("a login cannot be deleted while its TruFolks profile exists", async () => {
  await assert.rejects(pg.query(`delete from "user" where id = $1`, [anaId]));
});

test("Grok viewer sign-in is off; email/password alone enforces auth", () => {
  assert.equal(grokGateIdentityEnabled, false);
  assert.equal(requireEmailVerification, false);
  assert.equal(
    resolveAuthConfigured({ authDisabled: false, emailPassword: true }),
    true,
  );
  assert.equal(resolveAuthConfigured({ authDisabled: false, emailPassword: false }), false);
  assert.equal(
    resolveAuthConfigured({ authDisabled: true, emailPassword: true }),
    false,
  );
});

test("the fake dev user is refused everywhere except tests", () => {
  assert.equal(devUserAllowed(undefined), false);
  assert.equal(devUserAllowed("development"), false);
  assert.equal(devUserAllowed("production"), false);
  assert.equal(devUserAllowed("test"), true);
});
