// Ticket 4 — plain reasons for every review outcome (BRD v1.6 NFR-06, P8).
// Safe to import anywhere.

export const REVIEW_OUTCOMES = [
  "ok",
  "not_found",
  "not_verified",
  "rejected",
  "already_reviewed",
  "invalid",
  "unavailable",
] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

const REVIEW_MESSAGES: Record<Exclude<ReviewOutcome, "ok">, string> = {
  not_found: "We couldn't find that purchase on your account.",
  not_verified: "We're still checking your receipt. You can write your review once it's confirmed.",
  rejected: "We couldn't confirm this purchase from the receipt, so it can't be reviewed here.",
  already_reviewed: "You've already posted a review for this purchase.",
  invalid: "Please choose a star rating and answer all three questions.",
  unavailable: "We couldn't save your review right now. Nothing was posted. Please try again in a minute.",
};

export function reviewMessage(outcome: ReviewOutcome): string | null {
  return outcome === "ok" ? null : REVIEW_MESSAGES[outcome];
}

/** HON-02: shown before the person writes. */
export const RATING_BLIND_STATEMENT =
  "You're not paid for a good rating. A 1-star review gets the same as a 5-star one, as long as you answer all three questions honestly.";
