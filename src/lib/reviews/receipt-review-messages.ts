// v1.8 (REV-18-02) — outcomes of sending a review with a receipt photo and no
// TruFolks code. Safe to import anywhere.
import { photoMessage, type PhotoOutcome } from "../receipt-codes/messages.ts";

export const RECEIPT_REVIEW_OUTCOMES = [
  "ok",
  "not_found",
  "invalid",
  "bad_store",
  "bad_date",
  "too_many",
  "bad_photo",
  "too_big",
  "duplicate_photo",
  "unavailable",
] as const;
export type ReceiptReviewOutcome = (typeof RECEIPT_REVIEW_OUTCOMES)[number];

const MESSAGES: Partial<Record<ReceiptReviewOutcome, string>> = {
  not_found: "Please log in again, then send your review.",
  invalid: "Please choose a star rating and answer all three questions.",
  bad_store: "Please say where you bought it (up to 80 characters).",
  bad_date: "Please give the date on your receipt. It can't be in the future or more than 2 years ago.",
  too_many: "You've sent a lot of receipts today. Please try again tomorrow.",
};

export function receiptReviewMessage(outcome: ReceiptReviewOutcome): string | null {
  if (outcome === "ok") return null;
  return MESSAGES[outcome] ?? photoMessage(outcome as PhotoOutcome) ?? photoMessage("unavailable");
}

/** Shown before sending: what happens to a review with a receipt and no code. */
export const RECEIPT_ONLY_NOTE =
  "Our team checks your receipt first. Once it's confirmed, your review posts as a Verified purchase, exactly as you wrote it. Without a TruFolks code there's nothing paid back.";
