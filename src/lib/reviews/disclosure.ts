// Ticket 4 (updated in Ticket 7) — read and show the system-attached
// disclosure (BRD v1.6 LEG-01, LEG-03, P4). Pure. The disclosure itself is
// built by the database from the purchase and settings (migrations 0006,
// 0009); this file only turns it into plain lines. The person can't edit or
// remove it.
//
// Version 2 (Ticket 7) carries the PAY-08 formula, the amount for this review
// and the wording lines from the disclosure-wording setting (CFG-10). It is
// `complete` only when the amount is known AND the wording is marked
// lawyer-approved; contacts never see an incomplete one (LEG-01, gap 19).
// Version 1 (Ticket 4) disclosures are still read.
import { formatCents } from "../receipt-codes/form-input.ts";
import { percentText } from "../config/preset.ts";

export interface Disclosure {
  version: number;
  incentive: boolean;
  ratingBlind: boolean;
  merchantName: string;
  campaignName: string | null;
  verifiedPurchase: boolean;
  reward: {
    status: "none" | "not_set" | "set";
    amountCents: number | null;
    formula: { percentBp: number; floorCents: number; capCents: number; currency: string } | null;
  };
  wording: { version: string; approved: boolean; lines: string[] } | null;
  complete: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Read the stored JSON. Null if it isn't a disclosure we understand. */
export function parseDisclosure(json: unknown): Disclosure | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const d = json as Record<string, unknown>;
  const reward = d.reward && typeof d.reward === "object" ? (d.reward as Record<string, unknown>) : null;
  const status = reward?.status;
  if (
    typeof d.version !== "number" ||
    typeof d.incentive !== "boolean" ||
    d.rating_blind !== true ||
    typeof d.merchant_name !== "string" ||
    typeof d.verified_purchase !== "boolean" ||
    typeof d.complete !== "boolean" ||
    (status !== "none" && status !== "not_set" && status !== "set")
  ) {
    return null;
  }
  const f = reward?.formula && typeof reward.formula === "object" ? (reward.formula as Record<string, unknown>) : null;
  const formula =
    f && num(f.percent_bp) !== null && num(f.floor_cents) !== null && num(f.cap_cents) !== null
      ? {
          percentBp: f.percent_bp as number,
          floorCents: f.floor_cents as number,
          capCents: f.cap_cents as number,
          currency: typeof f.currency === "string" ? f.currency : "USD",
        }
      : null;
  const w = d.wording && typeof d.wording === "object" ? (d.wording as Record<string, unknown>) : null;
  const wording =
    w && Array.isArray(w.lines) && w.lines.every((l) => typeof l === "string")
      ? { version: typeof w.version === "string" ? w.version : "", approved: w.approved === true, lines: w.lines as string[] }
      : null;
  const amount = num(reward?.amount_cents);
  // A "set" reward must carry its amount and formula, or we can't state it (LEG-03).
  if (status === "set" && (amount === null || formula === null)) return null;
  return {
    version: d.version,
    incentive: d.incentive,
    ratingBlind: true,
    merchantName: d.merchant_name,
    campaignName: typeof d.campaign_name === "string" ? d.campaign_name : null,
    verifiedPurchase: d.verified_purchase,
    reward: { status, amountCents: amount, formula },
    wording,
    complete: d.complete,
  };
}

/** The disclosure as people see it, in plain lines. */
export function disclosureLines(d: Disclosure): string[] {
  if (!d.incentive) return ["No one paid for this review."];
  const f = d.reward.formula;
  if (d.reward.status === "set" && f && d.reward.amountCents !== null && d.wording && d.wording.lines.length > 0) {
    const money = (cents: number) => formatCents(cents, f.currency);
    const values: Record<string, string> = {
      "{merchant}": d.merchantName,
      "{percent}": percentText(f.percentBp),
      "{floor}": money(f.floorCents),
      "{cap}": money(f.capCents),
      "{amount}": money(d.reward.amountCents),
    };
    return d.wording.lines.map((line) => line.replace(/\{[a-z_]+\}/g, (p) => values[p] ?? p));
  }
  const lines = [
    `${d.merchantName} pays people back for honest reviews of things they bought.`,
    "The amount is the same whether they give 1 star or 5.",
  ];
  if (d.reward.status === "not_set") lines.push("The amount for this review isn't set yet.");
  return lines;
}
