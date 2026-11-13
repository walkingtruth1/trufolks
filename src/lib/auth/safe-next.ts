// Ticket 3b-1 — safe "return to" path after sign-in / sign-up (BRD v1.6 Journey A).
// Only paths on this site are allowed, so a link can't bounce people to
// another website (no open redirect). Pure; safe to import anywhere.

const BASE = "https://trufolks.invalid";

/** A same-site path to go to next, or the fallback. */
export function safeNextPath(input: unknown, fallback = "/profile"): string {
  if (typeof input !== "string") return fallback;
  const value = input.trim();
  if (!value || value.length > 300) return fallback;
  // Must be a plain path: one leading slash, no scheme, no "//host", no backslash tricks.
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
