// Ticket 3b-1 — who may verify purchases (BRD v1.6 RES-01, AI-06). Server-only.
//
// A plain allowlist of user ids in TRUFOLKS_ADMIN_USER_IDS (comma-separated),
// set in Vercel env and the local env — never in the repo. User ids, not
// emails: email verification is off (gap 6), so an email proves nothing.
// A proper admin role and the full Resolution tools come in a later ticket.

import type { Sql } from "../db.ts";

/** Parse the allowlist. Blank entries and the shared dev user are ignored. */
export function parseAdminUserIds(value: string | undefined | null): Set<string> {
  const ids = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const id = part.trim();
    if (id && id !== "dev-user" && id.length <= 200) ids.add(id);
  }
  return ids;
}

/** True when this signed-in user is on the admin allowlist. */
export function isAdmin(
  userId: string | null | undefined,
  allowlist: string | undefined | null = process.env.TRUFOLKS_ADMIN_USER_IDS,
): boolean {
  return Boolean(userId) && parseAdminUserIds(allowlist).has(userId as string);
}

// ---------------------------------------------------------------- Ticket 3b-2: local dev only
//
// Locally the in-memory database is wiped on every restart, so user ids
// change and can't be put in TRUFOLKS_ADMIN_USER_IDS ahead of time. On a
// developer's computer only, TRUFOLKS_ADMIN_EMAILS_DEV (comma-separated
// emails) also counts. It is ignored unless NODE_ENV is "development" or
// "test", so it fails closed everywhere else, production included.

/** True only on a developer's computer (vite dev) or in tests. */
export function devOnlyEnv(nodeEnv: string | undefined | null): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

/** Parse the dev email list: trimmed, lower case, must look like an email. */
export function parseAdminEmails(value: string | undefined | null): Set<string> {
  const emails = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const email = part.trim().toLowerCase();
    if (email.length <= 320 && /^[^@\s]+@[^@\s]+$/.test(email)) emails.add(email);
  }
  return emails;
}

/** The login email for a user id (Better Auth "user" table), or null. */
export async function findAuthEmail(sql: Sql, userId: string): Promise<string | null> {
  const rows = await sql.query<{ email: string }>(`select "email" from "user" where "id" = $1`, [userId]);
  return rows[0]?.email ?? null;
}

/**
 * Is this signed-in caller an admin? The user-id allowlist first (everywhere);
 * then, on a developer's computer only, the dev email list. The email is only
 * looked up when that list is in use.
 */
export async function isAdminCaller(
  userId: string | null | undefined,
  opts: {
    lookupEmail: (userId: string) => Promise<string | null>;
    env?: { NODE_ENV?: string; TRUFOLKS_ADMIN_USER_IDS?: string; TRUFOLKS_ADMIN_EMAILS_DEV?: string };
  },
): Promise<boolean> {
  const env = opts.env ?? process.env;
  if (!userId || userId === "dev-user") return false;
  if (isAdmin(userId, env.TRUFOLKS_ADMIN_USER_IDS)) return true;
  if (!devOnlyEnv(env.NODE_ENV)) return false;
  const emails = parseAdminEmails(env.TRUFOLKS_ADMIN_EMAILS_DEV);
  if (emails.size === 0) return false;
  const email = await opts.lookupEmail(userId);
  return Boolean(email) && emails.has((email as string).trim().toLowerCase());
}
