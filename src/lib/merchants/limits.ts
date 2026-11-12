// Ticket 6 — merchant dashboard limits. CFG placeholder presets for Ticket 7,
// not decisions. Safe to import anywhere.

export interface MerchantLimits {
  /** Most recent reviews listed on the dashboard (pilot cap is 50 per merchant). */
  dashboardReviewsMax: number;
  /** Suggested number of codes in one batch (the hard cap is RECEIPT_CODE_LIMITS.maxCodesPerBatch). */
  defaultCodeBatch: number;
}

export const MERCHANT_LIMITS: Readonly<MerchantLimits> = Object.freeze({
  dashboardReviewsMax: 200,
  defaultCodeBatch: 10,
});
