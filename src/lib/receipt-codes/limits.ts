// Ticket 3a — receipt code limits (BRD v1.6 HON-07, FR-08, CFG-11).
//
// CFG-11 (Ticket 7): every value here is a PLACEHOLDER PRESET, not a decision.
// Ticket 7 moves them into the toggle system (immutable log, startup
// validation, 24-hour cooling-off for live campaigns). Until then they are
// named in one place so nothing is hard-coded elsewhere. No money values here.

export interface ReceiptCodeLimits {
  /** Uses per code. The database refuses anything but 1 until reuse is designed (HON-04). */
  maxUsesPerCode: number;
  /** A code expires at the earlier of campaign end or issue time + this. */
  codeLifetimeSeconds: number;
  /** Rolling window for counting failed scans / claims. */
  failureWindowSeconds: number;
  /** Failed scans / claims allowed per device inside the window. */
  maxFailuresPerDevice: number;
  /** Failed scans / claims allowed per network address inside the window. */
  maxFailuresPerIp: number;
  /** Rolling window for counting new devices per network address. */
  newDeviceWindowSeconds: number;
  /** New devices allowed per network address inside that window. */
  maxNewDevicesPerIp: number;
  /** Most codes a merchant can make in one request. */
  maxCodesPerBatch: number;
  /** Slack allowed on the typed purchase time vs. the campaign window / now. */
  purchaseClockSkewSeconds: number;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** CFG-11 placeholder presets (Ticket 7). */
export const RECEIPT_CODE_LIMITS: Readonly<ReceiptCodeLimits> = Object.freeze({
  maxUsesPerCode: 1,
  codeLifetimeSeconds: 14 * DAY,
  failureWindowSeconds: 15 * MINUTE,
  maxFailuresPerDevice: 5,
  maxFailuresPerIp: 20,
  newDeviceWindowSeconds: 1 * HOUR,
  maxNewDevicesPerIp: 10,
  maxCodesPerBatch: 200,
  purchaseClockSkewSeconds: 10 * MINUTE,
});

/** CFG-11 placeholder preset (Ticket 7): device cookie lifetime (browsers cap near 400 days). */
export const DEVICE_TOKEN_MAX_AGE_SECONDS = 400 * DAY;

/** Name of the long-lived device cookie (HON-07). Not a session cookie. */
export const DEVICE_COOKIE_NAME = "tf_device";

/** Ticket 3b-1 — receipt photo limits. CFG-11 placeholder presets (Ticket 7), not decisions. */
export interface ReceiptPhotoLimits {
  /** Largest compressed receipt photo accepted. */
  maxPhotoBytes: number;
  /** Largest slice of the original file's header accepted (only its date is read). */
  maxHeaderBytes: number;
  /** Photo bytes are deleted this long after upload; the hash and dates stay. */
  retentionSeconds: number;
  /** Slack when comparing the photo's own time to the campaign / typed purchase time. */
  exifSlackSeconds: number;
}

export const RECEIPT_PHOTO_LIMITS: Readonly<ReceiptPhotoLimits> = Object.freeze({
  maxPhotoBytes: 400 * 1024,
  maxHeaderBytes: 128 * 1024,
  retentionSeconds: 60 * DAY,
  exifSlackSeconds: 12 * HOUR,
});
