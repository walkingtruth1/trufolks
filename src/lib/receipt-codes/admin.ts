// Ticket 3b-1 — who may verify purchases (BRD v1.6 RES-01, AI-06). Server-only.
//
// A plain allowlist of user ids in TRUFOLKS_ADMIN_USER_IDS (comma-separated),
// set in Vercel env and the local env — never in the repo. User ids, not
// emails: email verification is off (gap 6), so an email proves nothing.
// A proper admin role and the full Resolution tools come in a later ticket.

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
