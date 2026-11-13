// Ticket 4 — review field limits. CFG placeholder presets for Ticket 7, not
// decisions. They only stop absurdly long input; they are not quality rules.

export interface ReviewLimits {
  /** "What did you use or buy?" and "How long / how much?" */
  maxShortFieldChars: number;
  /** "One honest thought" */
  maxThoughtChars: number;
  /** "Where did you buy it?" for a receipt without a TruFolks code (v1.8). */
  maxStoreNameChars: number;
  /** Receipts without a code one person can send in 24 hours (v1.8; keeps the check queue sane). */
  maxReceiptOnlyPerDay: number;
}

export const REVIEW_LIMITS: Readonly<ReviewLimits> = Object.freeze({
  maxShortFieldChars: 200,
  maxThoughtChars: 2000,
  maxStoreNameChars: 80,
  maxReceiptOnlyPerDay: 10,
});
