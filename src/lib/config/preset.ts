// Ticket 7 — the settings document and the BRD v1.6 §20 pilot preset.
// Safe to import anywhere. A preset is a STARTING VALUE, not a decision
// (§20B). The same document is seeded as version "pilot-preset-1" in
// migration 0009 (a test checks they match). It is also the built-in
// last-resort fallback if no stored version is valid (CFG-01).
import { formatCents } from "../receipt-codes/form-input.ts";

export interface AppConfig {
  schema: 1;
  /** CFG-03 / PAY-08: guaranteed, rating-blind formula. Pinned per offer. */
  payout: {
    mode: "guaranteed_formula";
    /** Percentage in basis points (2000 = 20%). */
    percent_bp: number;
    floor_cents: number;
    cap_cents: number;
    currency: string;
    /** HON-09: payout held until the return window passes (Ticket 8). */
    hold_days: number;
  };
  /** CFG-04: offer cap and length. Pinned per offer. */
  campaign: { max_reviews: number; max_days: number; pool_cents: number };
  /** CFG-05: Type A only until Type B payout is decided (§17). Pinned per offer. */
  eligibility: { types: "A"[] };
  /** CFG-06: text always qualifies (FR-12); video optional, no extra tier (D2). Pinned per offer. */
  review_format: { text_qualifies: true; video: "optional" | "off"; video_extra_tier: false };
  /** CFG-08: who funds the pool, fee waiver (Ticket 8). Pinned per offer. */
  funding: { model: "merchant_prefunded"; platform_fee_waived: boolean };
  /** CFG-09: split by merchant or cohort, never by individual. Pinned per offer. */
  split_test: { enabled: boolean; unit: "merchant" | "cohort" };
  /** CFG-07: global. Only contacts-only exists (P1); wider sharing isn't built. */
  visibility: { scope: "contacts_only" };
  /** CFG-10 / LEG-03: global. Lines with {merchant} {percent} {floor} {cap} {amount}. */
  disclosure: { wording_version: string; wording_approved: boolean; lines: string[] };
  /** CFG-11: global. The three switches are guardrails and must stay on (CFG-12). */
  fraud: {
    single_use_codes: true;
    photo_for_handout_codes: true;
    device_binding: true;
    code_lifetime_seconds: number;
    failure_window_seconds: number;
    max_failures_per_device: number;
    max_failures_per_ip: number;
    new_device_window_seconds: number;
    max_new_devices_per_ip: number;
    purchase_clock_skew_seconds: number;
  };
}

/** Sections that apply to live offers: changing them waits 24h while any offer is live (CFG-13). */
export const GLOBAL_SECTIONS = ["visibility", "disclosure", "fraud"] as const;

export const PILOT_PRESET_ID = "pilot-preset-1";

export const PILOT_PRESET: AppConfig = deepFreeze({
  schema: 1,
  payout: {
    mode: "guaranteed_formula",
    percent_bp: 2000,
    floor_cents: 200,
    cap_cents: 1500,
    currency: "USD",
    hold_days: 14,
  },
  campaign: { max_reviews: 50, max_days: 14, pool_cents: 25000 },
  eligibility: { types: ["A"] },
  review_format: { text_qualifies: true, video: "optional", video_extra_tier: false },
  funding: { model: "merchant_prefunded", platform_fee_waived: true },
  split_test: { enabled: false, unit: "merchant" },
  visibility: { scope: "contacts_only" },
  disclosure: {
    wording_version: "draft-1",
    wording_approved: false,
    lines: [
      "{merchant} pays people back for honest reviews of things they bought.",
      "The amount is the same whether they give 1 star or 5.",
      "How it is worked out: {percent} of what they spent, at least {floor} and at most {cap}.",
      "For this review: {amount}.",
    ],
  },
  fraud: {
    single_use_codes: true,
    photo_for_handout_codes: true,
    device_binding: true,
    code_lifetime_seconds: 14 * 86400,
    failure_window_seconds: 15 * 60,
    max_failures_per_device: 5,
    max_failures_per_ip: 20,
    new_device_window_seconds: 3600,
    max_new_devices_per_ip: 10,
    purchase_clock_skew_seconds: 10 * 60,
  },
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** PAY-08: min(cap, max(floor, order × percentage)), rounded to the nearest cent. Takes no rating (PAY-01). */
export function pay08Reward(
  orderValueCents: number,
  payout: Pick<AppConfig["payout"], "percent_bp" | "floor_cents" | "cap_cents">,
): number {
  const raw = Math.floor((orderValueCents * payout.percent_bp + 5000) / 10000);
  return Math.min(payout.cap_cents, Math.max(payout.floor_cents, raw));
}

/** "20%" / "12.5%" from basis points. */
export function percentText(bp: number): string {
  const p = bp / 100;
  return `${Number.isInteger(p) ? p : p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export interface FormulaView {
  percentBp: number;
  floorCents: number;
  capCents: number;
  currency: string;
}

/** The PAY-08 formula terms alone, for pages that already show one rating-blind statement (APP-17-02). */
export function formulaTermsText(f: FormulaView): string {
  return `You get back ${percentText(f.percentBp)} of what you spend — at least ${formatCents(f.floorCents, f.currency)} and at most ${formatCents(
    f.capCents,
    f.currency,
  )}.`;
}

/** The PAY-08 formula in plain words, for the buyer before they buy (Type A). */
export function formulaText(f: FormulaView): string {
  return `${formulaTermsText(f)} It's the same for 1 star or 5.`;
}
