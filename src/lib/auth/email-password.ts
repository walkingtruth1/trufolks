/**
 * Local email/password sign-in (this app's own Better Auth database).
 *
 * TruFolks (Ticket 2a): ON — the only sign-in method in the pilot.
 *
 * requireEmailVerification is OFF for now: verifying an address needs an email
 * service, and the spending ceiling is $0. Flip it to true once an email sender
 * is approved. Password reset is also not built yet (logged gap).
 */
export const emailAndPasswordEnabled = true;
export const requireEmailVerification = false;
export const minPasswordLength = 8;

/** Passed to Better Auth's `emailAndPassword` option by `server.ts`. */
export const emailAndPasswordOptions = {
  enabled: emailAndPasswordEnabled,
  requireEmailVerification,
  minPasswordLength,
};
