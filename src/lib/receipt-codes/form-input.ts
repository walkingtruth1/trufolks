// Ticket 3b-2 — small pure helpers for the scan page and the admin page.
// No browser or server APIs, so they are safe anywhere and easy to test.

/** Largest amount a person can type (matches the engine's own check). */
const MAX_CENTS = 100_000_000;

/**
 * "12", "12.5", "12.50", "$1,234.56" → integer cents. Null for anything else
 * (blank, negative, more than 2 decimals, letters, exponents, too large).
 * Commas are only allowed as thousands separators.
 */
export function dollarsToCents(input: string): number | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (s.startsWith("$")) s = s.slice(1).trim();
  if (!s) return null;
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ""));
  const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** Integer cents → "$12.50" style text for display (admin page). */
export function formatCents(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date → the value a `datetime-local` input expects, in local time ("YYYY-MM-DDTHH:mm"). */
export function toDateTimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value (read as local time) → ISO timestamp, or null. */
export function localDateTimeToIso(value: string): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  // Reject rolled-over dates such as 2026-02-31.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  if (date.getHours() !== h || date.getMinutes() !== mi) return null;
  return date.toISOString();
}

/** "/sign-in" + "/r/ABC" → "/sign-in?next=%2Fr%2FABC". No next → the path alone. */
export function authLinkWithNext(path: "/sign-in" | "/sign-up", next: string | null | undefined): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

/** Fit width × height inside maxSide on the longest side, never enlarging. */
export function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0) || longest <= maxSide) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** What the scan page shows for a signed-in person, given getMyClaim's answer. */
export type ClaimView = "form" | "photo" | "checking" | "confirmed" | "turned_down";

export function claimView(
  claim: { ok: true; status: "pending" | "verified" | "rejected"; hasPhoto: boolean } | { ok: false },
): ClaimView {
  if (!claim.ok) return "form";
  if (claim.status === "verified") return "confirmed";
  if (claim.status === "rejected") return "turned_down";
  return claim.hasPhoto ? "checking" : "photo";
}

/** Retention seconds → whole days, for the "deleted after N days" line. */
export function retentionDays(seconds: number): number {
  return Math.max(1, Math.round(seconds / 86_400));
}
