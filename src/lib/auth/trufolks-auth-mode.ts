/**
 * TruFolks auth mode (Ticket 2a, BRD v1.6).
 *
 * TruFolks signs people in with email + password only (no social login in the
 * pilot). The Grok App Builder template this repo started from also ships two
 * Grok sign-in paths; both are switched OFF here and only start if these
 * switches are deliberately flipped:
 *   - Grok federation: Google / X sign-in via the Grok auth broker.
 *   - Grok gate identity: automatic sign-in for visitors arriving from Grok.
 */
export const grokFederationEnabled: boolean = false;
export const grokGateIdentityEnabled: boolean = false;

export type AuthModeInput = {
  /** VITE_AUTH_ENABLED === "false" */
  authDisabled: boolean;
  emailPassword: boolean;
  grokFederation: boolean;
  grokCredsPresent: boolean;
};

/** Real sign-in is enforced when auth isn't disabled and at least one method is on. */
export function resolveAuthConfigured(input: AuthModeInput): boolean {
  if (input.authDisabled) return false;
  return input.emailPassword || (input.grokFederation && input.grokCredsPresent);
}

/**
 * The template's shared fake "dev-user" is only ever allowed inside tests
 * (NODE_ENV=test). Everywhere else an unauthenticated request is refused.
 */
export function devUserAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv === "test";
}
