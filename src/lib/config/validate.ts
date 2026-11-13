// Ticket 7 — settings validation (BRD v1.6 CFG-01, CFG-12, §20B). Pure; safe
// to import anywhere. STRICT: every key must be known, every value in range.
//
// Guardrails (CFG-12) can't be turned off by any preset: rating-blind payout
// (PAY-01, HON-01), verified purchase (FR-06–FR-08a), disclosure (LEG-01–LEG-03)
// and merchant reply-only (MER-07, RES-01). A preset that tries to touch one is
// rejected with `guardrail: true`. Open decisions (§17, §20B) are not closed
// here: Type B, public visibility and a video payout tier are refused because
// they aren't built or decided, not given a default.
import type { AppConfig } from "./preset.ts";

export type ValidationResult = { ok: true; value: AppConfig } | { ok: false; errors: string[]; guardrail: boolean };

/** Keys that would override a guardrail if they appeared anywhere in a preset. */
const GUARDRAIL_KEYS: Record<string, string> = {
  rating: "Payout can never depend on the star rating (PAY-01).",
  rating_multiplier: "Payout can never depend on the star rating (PAY-01).",
  rating_bonus: "Payout can never depend on the star rating (PAY-01).",
  min_rating: "Payout can never depend on the star rating (PAY-01).",
  reads_rating: "Payout can never depend on the star rating (PAY-01).",
  positive_bonus: "No extra benefit for a positive review (PAY-03).",
  require_verified_purchase: "A verified purchase is always required (FR-06–FR-08a).",
  allow_unverified: "A verified purchase is always required (FR-06–FR-08a).",
  disclosure_enabled: "The disclosure is always attached (LEG-01).",
  hide_disclosure: "The disclosure is always attached (LEG-01).",
  merchant_can_remove: "Businesses can only reply, never remove (MER-07).",
  merchant_can_hide: "Businesses can only reply, never remove (MER-07).",
  merchant_can_approve: "Businesses can't approve reviews before they count (Journey C).",
  draw: "There is no draw or chance mode (D1).",
  lottery: "There is no draw or chance mode (D1).",
  odds: "There is no draw or chance mode (D1).",
};

const SECTION_KEYS: Record<string, string[]> = {
  payout: ["mode", "percent_bp", "floor_cents", "cap_cents", "currency", "hold_days"],
  campaign: ["max_reviews", "max_days", "pool_cents"],
  eligibility: ["types"],
  review_format: ["text_qualifies", "video", "video_extra_tier"],
  funding: ["model", "platform_fee_waived"],
  split_test: ["enabled", "unit"],
  visibility: ["scope"],
  disclosure: ["wording_version", "wording_approved", "lines"],
  fraud: [
    "single_use_codes",
    "photo_for_handout_codes",
    "device_binding",
    "code_lifetime_seconds",
    "failure_window_seconds",
    "max_failures_per_device",
    "max_failures_per_ip",
    "new_device_window_seconds",
    "max_new_devices_per_ip",
    "purchase_clock_skew_seconds",
  ],
};

const REQUIRED_PLACEHOLDERS = ["{percent}", "{floor}", "{cap}", "{amount}"];
const ALLOWED_PLACEHOLDERS = new Set(["{merchant}", ...REQUIRED_PLACEHOLDERS]);

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function findGuardrailKeys(v: unknown, path: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x, i) => findGuardrailKeys(x, `${path}[${i}]`, out));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      const rule = GUARDRAIL_KEYS[k.toLowerCase()];
      if (rule) out.push(`${path ? `${path}.` : ""}${k}: ${rule}`);
      findGuardrailKeys(x, path ? `${path}.${k}` : k, out);
    }
  }
}

export function validateConfig(input: unknown): ValidationResult {
  const errors: string[] = [];
  const guard: string[] = [];
  findGuardrailKeys(input, "", guard);
  if (!isObj(input)) return { ok: false, errors: ["Settings must be an object."], guardrail: false };

  const int = (path: string, v: unknown, min: number, max: number) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) errors.push(`${path} must be a whole number from ${min} to ${max}.`);
  };
  const exact = (path: string, v: unknown, want: unknown, why: string, isGuardrail = false) => {
    if (v !== want) (isGuardrail ? guard : errors).push(`${path} must be ${JSON.stringify(want)}: ${why}`);
  };
  const oneOf = (path: string, v: unknown, options: unknown[]) => {
    if (!options.includes(v)) errors.push(`${path} must be one of ${options.map((o) => JSON.stringify(o)).join(", ")}.`);
  };
  const bool = (path: string, v: unknown) => {
    if (typeof v !== "boolean") errors.push(`${path} must be true or false.`);
  };

  for (const k of Object.keys(input)) {
    if (k !== "schema" && !(k in SECTION_KEYS)) errors.push(`Unknown setting "${k}".`);
  }
  exact("schema", input.schema, 1, "this is settings format 1.");
  for (const [section, keys] of Object.entries(SECTION_KEYS)) {
    const s = input[section];
    if (!isObj(s)) {
      errors.push(`${section} is missing.`);
      continue;
    }
    for (const k of Object.keys(s)) if (!keys.includes(k)) errors.push(`Unknown setting "${section}.${k}".`);
  }
  if (errors.length > 0 || guard.length > 0) return { ok: false, errors: [...guard, ...errors], guardrail: guard.length > 0 };

  const c = input as unknown as AppConfig;
  // CFG-03 / PAY-08 — the guarantee is the formula; it never reads a rating.
  exact("payout.mode", c.payout.mode, "guaranteed_formula", "guaranteed, rating-blind payout is a guardrail (PAY-01, D1).", true);
  int("payout.percent_bp", c.payout.percent_bp, 1, 10000);
  int("payout.floor_cents", c.payout.floor_cents, 0, 100_000);
  int("payout.cap_cents", c.payout.cap_cents, 1, 100_000);
  if (Number.isInteger(c.payout.floor_cents) && Number.isInteger(c.payout.cap_cents) && c.payout.floor_cents > c.payout.cap_cents) {
    errors.push("payout.floor_cents can't be more than payout.cap_cents.");
  }
  if (typeof c.payout.currency !== "string" || !/^[A-Z]{3}$/.test(c.payout.currency)) errors.push("payout.currency must be a 3-letter code.");
  int("payout.hold_days", c.payout.hold_days, 0, 365);
  // CFG-04
  int("campaign.max_reviews", c.campaign.max_reviews, 1, 100_000);
  int("campaign.max_days", c.campaign.max_days, 1, 366);
  int("campaign.pool_cents", c.campaign.pool_cents, 1, 100_000_000);
  if (Number.isInteger(c.campaign.pool_cents) && Number.isInteger(c.payout.floor_cents) && c.campaign.pool_cents < c.payout.floor_cents) {
    errors.push("campaign.pool_cents must cover at least one reward (the floor).");
  }
  // CFG-05 — Type B payout is open (§17): not offered until decided.
  if (!Array.isArray(c.eligibility.types) || c.eligibility.types.length !== 1 || c.eligibility.types[0] !== "A") {
    errors.push('eligibility.types must be ["A"]: Type B payout is still undecided (§17).');
  }
  // CFG-06 — the text path must exist (FR-12); no video tier until decided (D2).
  exact("review_format.text_qualifies", c.review_format.text_qualifies, true, "a text review must always qualify (FR-12).");
  oneOf("review_format.video", c.review_format.video, ["optional", "off"]);
  exact("review_format.video_extra_tier", c.review_format.video_extra_tier, false, "no extra video payout tier (D2, pilot-locked).");
  // CFG-08
  exact("funding.model", c.funding.model, "merchant_prefunded", "the only funding model built (PAY-06).");
  bool("funding.platform_fee_waived", c.funding.platform_fee_waived);
  // CFG-09 — never by individual inside a friend group.
  bool("split_test.enabled", c.split_test.enabled);
  oneOf("split_test.unit", c.split_test.unit, ["merchant", "cohort"]);
  // CFG-07 — every new review starts Friends only; owners widen it per review (v1.7).
  exact("visibility.scope", c.visibility.scope, "contacts_only", "new reviews always start Friends only (P1, FR-03); owners make a review public one at a time.");
  // CFG-10 / LEG-03 — the disclosure must state the formula, the amount and that it's the same for any rating.
  const d = c.disclosure;
  if (typeof d.wording_version !== "string" || !d.wording_version.trim() || d.wording_version.length > 40) {
    errors.push("disclosure.wording_version must be a short label.");
  }
  bool("disclosure.wording_approved", d.wording_approved);
  if (!Array.isArray(d.lines) || d.lines.length < 1 || d.lines.length > 8 || d.lines.some((l) => typeof l !== "string" || !l.trim() || l.length > 300)) {
    errors.push("disclosure.lines must be 1 to 8 non-empty lines of up to 300 characters.");
  } else {
    const all = d.lines.join("\n");
    const missing = REQUIRED_PLACEHOLDERS.filter((p) => !all.includes(p));
    if (missing.length) guard.push(`disclosure.lines must include ${missing.join(", ")}: the disclosure states the formula and the amount (LEG-03).`);
    if (!/1 star/i.test(all) || !/\b5\b/.test(all)) {
      guard.push("disclosure.lines must say the amount is the same for 1 star or 5 (LEG-03).");
    }
    const unknown = (all.match(/\{[a-z_]+\}/g) ?? []).filter((p) => !ALLOWED_PLACEHOLDERS.has(p));
    if (unknown.length) errors.push(`disclosure.lines uses unknown placeholders: ${[...new Set(unknown)].join(", ")}.`);
  }
  // CFG-11 / CFG-12 — the fraud switches are part of "verified purchase" and stay on.
  exact("fraud.single_use_codes", c.fraud.single_use_codes, true, "single-use codes are a guardrail (HON-07, FR-08).", true);
  exact("fraud.photo_for_handout_codes", c.fraud.photo_for_handout_codes, true, "the receipt photo check is a guardrail (FR-08a).", true);
  exact("fraud.device_binding", c.fraud.device_binding, true, "device binding is a guardrail (HON-07).", true);
  int("fraud.code_lifetime_seconds", c.fraud.code_lifetime_seconds, 60, 366 * 86400);
  int("fraud.failure_window_seconds", c.fraud.failure_window_seconds, 60, 86400);
  int("fraud.max_failures_per_device", c.fraud.max_failures_per_device, 1, 1000);
  int("fraud.max_failures_per_ip", c.fraud.max_failures_per_ip, 1, 10000);
  int("fraud.new_device_window_seconds", c.fraud.new_device_window_seconds, 60, 7 * 86400);
  int("fraud.max_new_devices_per_ip", c.fraud.max_new_devices_per_ip, 1, 10000);
  int("fraud.purchase_clock_skew_seconds", c.fraud.purchase_clock_skew_seconds, 0, 86400);

  if (errors.length > 0 || guard.length > 0) return { ok: false, errors: [...guard, ...errors], guardrail: guard.length > 0 };
  return { ok: true, value: c };
}

export interface ConfigChange {
  key: string;
  old: unknown;
  new: unknown;
}

/** Every changed leaf, as dotted keys (arrays compared whole). */
export function diffConfig(before: unknown, after: unknown, prefix = ""): ConfigChange[] {
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => diffConfig(before[k], after[k], prefix ? `${prefix}.${k}` : k));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ key: prefix, old: before ?? null, new: after ?? null }];
}
