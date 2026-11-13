// Ticket 7 — the settings form: one entry per setting, in plain words.
// Pure; safe to import anywhere. Values shown as dollars / percent are stored
// as cents / basis points. Locked settings are shown but can't be edited here
// (guardrails, CFG-12, or open decisions, §20B) — the validator refuses them anyway.
import type { AppConfig } from "./preset.ts";

export type FieldKind = "int" | "money" | "percent" | "bool" | "text" | "lines" | "choice" | "locked";

export interface Field {
  path: string;
  label: string;
  kind: FieldKind;
  /** "offer" = pinned when an offer is made; "global" = applies to live offers (24h wait while one is live). */
  scope: "offer" | "global";
  help?: string;
  choices?: string[];
  /** For "int": unit shown after the box. */
  unit?: string;
}

export const SETTING_FIELDS: Field[] = [
  { path: "payout.mode", label: "Payout mode", kind: "locked", scope: "offer", help: "Guaranteed and rating-blind. Can't be changed (PAY-01)." },
  { path: "payout.percent_bp", label: "Percentage back", kind: "percent", scope: "offer", help: "PAY-08 percentage of the confirmed order value." },
  { path: "payout.floor_cents", label: "Least paid back", kind: "money", scope: "offer" },
  { path: "payout.cap_cents", label: "Most paid back", kind: "money", scope: "offer" },
  { path: "payout.currency", label: "Currency", kind: "text", scope: "offer", help: "3-letter code, e.g. USD." },
  { path: "payout.hold_days", label: "Payout held for (return window)", kind: "int", scope: "offer", unit: "days", help: "HON-09; used by the payout ledger (Ticket 8)." },
  { path: "campaign.max_reviews", label: "Most reviews per offer", kind: "int", scope: "offer" },
  { path: "campaign.max_days", label: "Most days an offer can run", kind: "int", scope: "offer", unit: "days" },
  { path: "campaign.pool_cents", label: "Offer budget (pool)", kind: "money", scope: "offer", help: "Most a business pays back in one offer." },
  { path: "eligibility.types", label: "Offer types", kind: "locked", scope: "offer", help: "New-purchase offers only. Type B payout is still undecided." },
  { path: "review_format.text_qualifies", label: "Text reviews qualify", kind: "locked", scope: "offer", help: "Always on (FR-12)." },
  { path: "review_format.video", label: "Video", kind: "choice", choices: ["optional", "off"], scope: "offer", help: "Video reviews aren't built yet." },
  { path: "review_format.video_extra_tier", label: "Extra pay for video", kind: "locked", scope: "offer", help: "Off in the pilot (D2)." },
  { path: "funding.model", label: "Who funds the pool", kind: "locked", scope: "offer", help: "The business funds it upfront (PAY-06)." },
  { path: "funding.platform_fee_waived", label: "TruFolks fee waived", kind: "bool", scope: "offer" },
  { path: "split_test.enabled", label: "Split test on", kind: "bool", scope: "offer" },
  { path: "split_test.unit", label: "Split by", kind: "choice", choices: ["merchant", "cohort"], scope: "offer", help: "Never by individual." },
  { path: "visibility.scope", label: "Who sees reviews", kind: "locked", scope: "global", help: "Contacts only. Wider sharing isn't built." },
  { path: "disclosure.wording_version", label: "Disclosure wording label", kind: "text", scope: "global" },
  {
    path: "disclosure.wording_approved",
    label: "Wording approved by the lawyer",
    kind: "bool",
    scope: "global",
    help: "Reviews are shown to contacts only when this is on.",
  },
  {
    path: "disclosure.lines",
    label: "Disclosure wording (one line each)",
    kind: "lines",
    scope: "global",
    help: "Must use {percent}, {floor}, {cap} and {amount}, and say it's the same for 1 star or 5. {merchant} is optional.",
  },
  { path: "fraud.single_use_codes", label: "Codes work once", kind: "locked", scope: "global", help: "Always on." },
  { path: "fraud.photo_for_handout_codes", label: "Receipt photo for handout codes", kind: "locked", scope: "global", help: "Always on." },
  { path: "fraud.device_binding", label: "Code tied to one phone", kind: "locked", scope: "global", help: "Always on." },
  { path: "fraud.code_lifetime_seconds", label: "Code works for at most", kind: "int", scope: "global", unit: "seconds" },
  { path: "fraud.failure_window_seconds", label: "Failed tries counted over", kind: "int", scope: "global", unit: "seconds" },
  { path: "fraud.max_failures_per_device", label: "Failed tries allowed per phone", kind: "int", scope: "global" },
  { path: "fraud.max_failures_per_ip", label: "Failed tries allowed per network", kind: "int", scope: "global" },
  { path: "fraud.new_device_window_seconds", label: "New phones counted over", kind: "int", scope: "global", unit: "seconds" },
  { path: "fraud.max_new_devices_per_ip", label: "New phones allowed per network", kind: "int", scope: "global" },
  { path: "fraud.purchase_clock_skew_seconds", label: "Purchase time slack", kind: "int", scope: "global", unit: "seconds" },
];

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** A copy of the settings with one value replaced. */
export function setPath(obj: AppConfig, path: string, value: unknown): AppConfig {
  const copy = structuredClone(obj) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let o = copy;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
  return copy as unknown as AppConfig;
}

/** Turn what was typed into the stored value. Null = not a valid entry. */
export function parseFieldInput(field: Field, raw: string | boolean): unknown {
  if (field.kind === "bool") return raw === true;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (field.kind === "int") return /^\d+$/.test(text) ? Number(text) : null;
  if (field.kind === "money") {
    const m = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
  }
  if (field.kind === "percent") {
    const m = /^(\d+)(?:\.(\d{1,2}))?%?$/.exec(text);
    return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
  }
  if (field.kind === "lines") {
    const lines = (typeof raw === "string" ? raw : "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines;
  }
  return text;
}

/** The stored value as the form shows it. */
export function formatFieldValue(field: Field, value: unknown): string {
  if (field.kind === "money" && typeof value === "number") return (value / 100).toFixed(2);
  if (field.kind === "percent" && typeof value === "number") return String(value / 100);
  if (field.kind === "lines" && Array.isArray(value)) return value.join("\n");
  if (Array.isArray(value)) return value.join(", ");
  return value === undefined || value === null ? "" : String(value);
}
