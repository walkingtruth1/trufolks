/**
 * Which origins this app's Better Auth answers to, by environment (QA-PR3).
 *
 * - Vercel preview (`VERCEL_ENV=preview`): every deployment gets its own URL
 *   (`VERCEL_URL`) plus a stable branch URL (`VERCEL_BRANCH_URL`), so a single
 *   fixed BETTER_AUTH_URL would reject sign-in on the other one. Trust exactly
 *   those hosts (and BETTER_AUTH_URL's, if set) — never a wildcard.
 * - Deployed elsewhere (production): only BETTER_AUTH_URL.
 * - Local `npm run dev`: loopback on port 8080 only.
 *
 * Pure (reads only the env object passed in) so it is unit-tested.
 */
export type AuthEnv = Partial<
  Record<"VERCEL_ENV" | "VERCEL_URL" | "VERCEL_BRANCH_URL" | "BETTER_AUTH_URL", string>
>;

export type DynamicBaseURL = {
  allowedHosts: string[];
  protocol: "https" | "auto";
  fallback: string;
};

export type AuthOrigins = {
  baseURL: string | DynamicBaseURL;
  trustedOrigins: string[];
};

export const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** A bare host from either "host" or "https://host/…" input. */
function hostOf(v: string): string | undefined {
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).host || undefined;
  } catch {
    return undefined;
  }
}

export function resolveAuthOrigins(env: AuthEnv): AuthOrigins {
  const explicit = clean(env.BETTER_AUTH_URL);

  if (clean(env.VERCEL_ENV) === "preview") {
    const hosts = [clean(env.VERCEL_BRANCH_URL), clean(env.VERCEL_URL), explicit]
      .map((v) => (v ? hostOf(v) : undefined))
      .filter((h): h is string => Boolean(h));
    const unique = [...new Set(hosts)];
    if (unique.length > 0) {
      return {
        baseURL: { allowedHosts: unique, protocol: "https", fallback: `https://${unique[0]}` },
        trustedOrigins: unique.map((h) => `https://${h}`),
      };
    }
  }

  if (explicit) return { baseURL: explicit, trustedOrigins: [explicit] };

  return {
    baseURL: {
      allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      protocol: "auto",
      fallback: "http://localhost:8080",
    },
    trustedOrigins: LOCAL_DEV_ORIGINS,
  };
}

/**
 * On Vercel the server runs as many short-lived instances, so a random
 * per-process signing secret would sign people out between requests. Require
 * BETTER_AUTH_SECRET there; keep the process-stable random secret locally.
 */
export function missingDeploySecret(env: Record<string, string | undefined>): boolean {
  return Boolean(clean(env.VERCEL)) && !clean(env.BETTER_AUTH_SECRET);
}
