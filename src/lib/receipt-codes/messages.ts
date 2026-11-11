// Ticket 3a — plain reasons for every receipt code outcome (BRD v1.6 FR-10,
// NFR-06, P8). Never a raw technical message. Safe to import anywhere.
import { RECEIPT_CODE_LIMITS } from "./limits.ts";

/** Outcomes of scanning or claiming a code. 'ok' needs no message. */
export const CODE_OUTCOMES = [
  "ok",
  "malformed",
  "not_found",
  "expired",
  "used",
  "suspended",
  "other_device",
  "campaign_not_live",
  "campaign_not_started",
  "campaign_ended",
  "own_business",
  "purchase_outside_window",
  "rate_limited",
  "device_missing",
  "invalid_details",
  "unavailable",
] as const;
export type CodeOutcome = (typeof CODE_OUTCOMES)[number];

/** Outcomes of a merchant making codes. */
export const GENERATE_OUTCOMES = [
  "ok",
  "campaign_not_found",
  "merchant_not_verified",
  "terms_not_accepted",
  "walkthrough_not_accepted",
  "campaign_not_live",
  "campaign_ended",
  "bad_count",
  "unavailable",
] as const;
export type GenerateOutcome = (typeof GENERATE_OUTCOMES)[number];

const waitMinutes = Math.ceil(RECEIPT_CODE_LIMITS.failureWindowSeconds / 60);

const CODE_MESSAGES: Record<Exclude<CodeOutcome, "ok">, string> = {
  malformed: "That code doesn't look right. Check it against your receipt for typos and try again.",
  not_found: "We couldn't find that code. Check it against your receipt and try again.",
  expired: "This code has expired, so it can't be used for a paid-back review.",
  used: "This code has already been used.",
  suspended: "This code has been switched off, so it can't be used for a paid-back review.",
  other_device: "This code was already opened on another phone. Each code works on one phone only.",
  campaign_not_live: "This offer isn't running right now, so this code can't be used.",
  campaign_not_started: "This offer hasn't started yet. Please try again once it starts.",
  campaign_ended: "This offer has ended, so this code can't be used.",
  own_business:
    "People who own or work for this business can't be paid back for reviewing it.",
  purchase_outside_window: "That purchase date is outside this offer's dates.",
  rate_limited: `Too many tries. Please wait ${waitMinutes} minutes and try again.`,
  device_missing: "Please open your code link on this phone again, then try once more.",
  invalid_details: "Please fill in what you bought, what it cost and when you bought it.",
  unavailable:
    "We couldn't check your code right now. Please try again in a minute. Your code is still safe to use.",
};

const GENERATE_MESSAGES: Record<Exclude<GenerateOutcome, "ok">, string> = {
  campaign_not_found: "We couldn't find that campaign.",
  merchant_not_verified: "Your business needs to be verified before you can make receipt codes.",
  terms_not_accepted: "Please accept the reward rules before making receipt codes.",
  walkthrough_not_accepted:
    "Please finish the mixed-ratings walkthrough before making receipt codes.",
  campaign_not_live: "This campaign is switched off, so no new codes can be made for it.",
  campaign_ended: "This campaign has ended, so no new codes can be made for it.",
  bad_count: `You can make between 1 and ${RECEIPT_CODE_LIMITS.maxCodesPerBatch} codes at a time.`,
  unavailable: "We couldn't make codes right now. Please try again in a minute.",
};

export function codeMessage(outcome: CodeOutcome): string | null {
  return outcome === "ok" ? null : CODE_MESSAGES[outcome];
}

export function generateMessage(outcome: GenerateOutcome): string | null {
  return outcome === "ok" ? null : GENERATE_MESSAGES[outcome];
}
