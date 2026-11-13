// Ticket 5 — contacts limits. CFG placeholder presets for Ticket 7, not
// decisions. Safe to import anywhere.

export interface ContactLimits {
  /** How long an invite link keeps working. */
  inviteLifetimeSeconds: number;
  /** Reviews per page of the contacts feed. */
  feedPageSize: number;
  /** Most reviews shown on one person's history page (pilot scale is far below this). */
  historyMax: number;
}

export const CONTACT_LIMITS: Readonly<ContactLimits> = Object.freeze({
  inviteLifetimeSeconds: 30 * 24 * 60 * 60,
  feedPageSize: 20,
  historyMax: 500,
});
