// Ticket 8 — plain words for payouts (BRD v1.6 FR-20, HON-09, NFR-06, P8). Safe to import anywhere.
import { formatCents } from "../receipt-codes/form-input.ts";

export const PAYOUT_OUTCOMES = [
  "ok",
  "not_found",
  "wrong_status",
  "invalid",
  "window_passed",
  "needs_flag",
  "over_pool",
  "not_allowed",
  "unavailable",
] as const;
export type PayoutOutcome = (typeof PAYOUT_OUTCOMES)[number];

const PAYOUT_MESSAGES: Record<Exclude<PayoutOutcome, "ok">, string> = {
  not_found: "We couldn't find that payout or offer.",
  wrong_status: "That can't be done to this payout in its current state. The list has been refreshed.",
  invalid: "Please fill in every box. A reason (or how it was paid) is needed for the log.",
  window_passed: "The return window has passed, so this payout can't be forfeited for a return.",
  needs_flag: "Put the payout on hold with a flag first, then forfeit it once the breach is proven.",
  over_pool: "That deposit would take the offer over its budget setting.",
  not_allowed: "This page is for the TruFolks team only.",
  unavailable: "Something went wrong on our side. Nothing was changed. Please try again in a minute.",
};

export function payoutMessage(outcome: PayoutOutcome): string | null {
  return outcome === "ok" ? null : PAYOUT_MESSAGES[outcome];
}

export type PayoutStatus = "held" | "released" | "forfeited" | "paid";

export interface PayoutStatusInput {
  status: PayoutStatus;
  amountCents: number;
  currency: string;
  holdUntil: string;
  flagged: boolean;
  forfeitKind: "returned" | "policy_breach" | null;
  paidAt: string | null;
  paidMethod: string | null;
}

function day(isoTime: string): string {
  const d = new Date(isoTime);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** FR-20: the reward status in plain words, always with the amount. */
export function payoutStatusText(p: PayoutStatusInput): string {
  const amount = formatCents(p.amountCents, p.currency);
  if (p.status === "paid") return `Paid: ${amount} on ${day(p.paidAt ?? "")}${p.paidMethod ? ` (${p.paidMethod})` : ""}.`;
  if (p.status === "released") return `Ready: ${amount}. The TruFolks team will pay you.`;
  if (p.status === "forfeited") {
    return p.forfeitKind === "returned"
      ? `Not paid (${amount} forfeited): the purchase was returned within the return window. Your review stays up.`
      : `Not paid (${amount} forfeited): the TruFolks team found a breach of the rules. Your review stays up.`;
  }
  if (p.flagged) return `On hold: ${amount}. The TruFolks team is checking something about this purchase.`;
  return `Qualified and held: ${amount}, held until ${day(p.holdUntil)} in case the purchase is returned. It's the same whatever rating you gave.`;
}
