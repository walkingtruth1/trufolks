// Ticket 3a — plain reasons for every receipt code outcome (BRD v1.6 FR-10,
// NFR-06, P8). Never a raw technical message. Safe to import anywhere.
import { RECEIPT_CODE_LIMITS, RECEIPT_PHOTO_LIMITS } from "./limits.ts";

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
  "campaign_full",
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
  "not_funded",
  "bad_count",
  "unavailable",
] as const;
export type GenerateOutcome = (typeof GENERATE_OUTCOMES)[number];

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
  // Ticket 7 (CFG-04, FR-21): the offer reached its cap.
  campaign_full: "This offer is full: it has reached the most reviews it can pay back. This code can't be used.",
  own_business:
    "People who own or work for this business can't be paid back for reviewing it.",
  purchase_outside_window: "That purchase date is outside this offer's dates.",
  // Ticket 7: the wait is a setting now (CFG-11), so the message doesn't name a number.
  rate_limited: "Too many tries. Please wait a few minutes and try again.",
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
  // Ticket 8 (MER-06): the business funds the pool before any code is made.
  not_funded: "This offer has no money deposited yet, so no codes can be made. The TruFolks team records your deposit first.",
  bad_count: `You can make between 1 and ${RECEIPT_CODE_LIMITS.maxCodesPerBatch} codes at a time.`,
  unavailable: "We couldn't make codes right now. Please try again in a minute.",
};

export function codeMessage(outcome: CodeOutcome): string | null {
  return outcome === "ok" ? null : CODE_MESSAGES[outcome];
}

export function generateMessage(outcome: GenerateOutcome): string | null {
  return outcome === "ok" ? null : GENERATE_MESSAGES[outcome];
}

/** Outcomes of uploading a receipt photo (Ticket 3b-1). */
export const PHOTO_OUTCOMES = [
  "ok",
  "bad_photo",
  "too_big",
  "not_found",
  "already_decided",
  "duplicate_photo",
  "unavailable",
] as const;
export type PhotoOutcome = (typeof PHOTO_OUTCOMES)[number];

/** Outcomes of an admin deciding a purchase (Ticket 3b-1). Shown to admins only. */
export const DECIDE_OUTCOMES = [
  "ok",
  "not_allowed",
  "not_found",
  "already_decided",
  "own_purchase",
  "no_photo",
  "bad_value",
  "reason_required",
  "code_not_usable",
  "bad_decision",
  "unavailable",
] as const;
export type DecideOutcome = (typeof DECIDE_OUTCOMES)[number];

const maxPhotoKb = Math.round(RECEIPT_PHOTO_LIMITS.maxPhotoBytes / 1024);

const PHOTO_MESSAGES: Record<Exclude<PhotoOutcome, "ok">, string> = {
  bad_photo: "That file isn't a photo we can use. Please take a clear photo of your receipt.",
  too_big: `That photo is too large (the limit is ${maxPhotoKb} KB). Please try again.`,
  not_found: "We couldn't find that purchase on your account.",
  already_decided: "Your receipt has already been checked, so a new photo isn't needed.",
  duplicate_photo: "This receipt photo has already been used. Please take a photo of your own receipt.",
  unavailable: "We couldn't save your photo right now. Please try again in a minute.",
};

const DECIDE_MESSAGES: Record<Exclude<DecideOutcome, "ok">, string> = {
  not_allowed: "This page is for the TruFolks team only.",
  not_found: "We couldn't find that purchase.",
  already_decided: "This purchase has already been decided.",
  own_purchase: "You can't check your own purchase. Ask another team member.",
  no_photo: "There's no receipt photo yet, so this purchase can't be approved.",
  bad_value: "Please enter the amount shown on the receipt.",
  reason_required: "Please give a reason for turning this purchase down.",
  code_not_usable: "This purchase's code has been switched off, so it can't be approved.",
  bad_decision: "Please choose approve or turn down.",
  unavailable: "We couldn't save that right now. Please try again in a minute.",
};

export function photoMessage(outcome: PhotoOutcome): string | null {
  return outcome === "ok" ? null : PHOTO_MESSAGES[outcome];
}

export function decideMessage(outcome: DecideOutcome): string | null {
  return outcome === "ok" ? null : DECIDE_MESSAGES[outcome];
}
