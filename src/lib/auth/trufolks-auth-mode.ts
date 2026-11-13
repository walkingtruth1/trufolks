/**
 * TruFolks auth mode (Tickets 2a/2c, BRD v1.6).
 *
 * TruFolks signs people in with email + password only (no social login in the
 * pilot). Grok's Google/X broker sign-in was removed in Ticket 2c. Grok's
 * automatic viewer sign-in (gate identity) is still in the template code and
 * is switched OFF here; it only starts if this switch is deliberately flipped.
 */
export const grokGateIdentityEnabled: boolean = false;

export type AuthModeInput = {
  /** VITE_AUTH_ENABLED === "false" */
  authDisabled: boolean;
  emailPassword: boolean;
};

/** Real sign-in is enforced when auth isn't disabled and email/password is on. */
export function resolveAuthConfigured(input: AuthModeInput): boolean {
  return !input.authDisabled && input.emailPassword;
}

/**
 * The template's shared fake "dev-user" is only ever allowed inside tests
 * (NODE_ENV=test). Everywhere else an unauthenticated request is refused.
 */
export function devUserAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv === "test";
}
