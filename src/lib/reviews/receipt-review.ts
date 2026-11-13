// v1.8 (REV-18-02) — send a review with a photo of ANY receipt, no TruFolks
// code. Server-only. One database call creates the receipt-only purchase, keeps
// the review waiting, and stores the photo (migration 0012). The team checks the
// receipt as usual; once confirmed, the review posts by itself as written.
import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";
import { readExifTakenAt, sniffImageType } from "../receipt-codes/exif.ts";
import type { ReceiptPhotoLimits } from "../receipt-codes/limits.ts";
import type { ReviewLimits } from "./limits.ts";
import type { ReceiptReviewOutcome } from "./receipt-review-messages.ts";
import { checkReviewInput, type ReviewField } from "./review-input.ts";

export type ReceiptReviewField = ReviewField | "storeName" | "purchasedOn";

export type ReceiptReviewResult =
  | { outcome: "ok"; purchaseId: string }
  | { outcome: Exclude<ReceiptReviewOutcome, "ok">; errors?: Partial<Record<ReceiptReviewField, string>> };

/** "YYYY-MM-DD" from a date input → noon UTC that day (so time zones never shift the date). */
export function purchaseDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : d;
}

export async function submitReceiptReview(
  sql: Sql,
  input: {
    userId: string;
    fields: Partial<Record<ReviewField, unknown>>;
    storeName: unknown;
    purchasedOn: unknown;
    photo: Uint8Array | null;
    header: Uint8Array | null;
    limits: ReviewLimits;
    photoLimits: ReceiptPhotoLimits;
  },
): Promise<ReceiptReviewResult> {
  if (!input.userId) return { outcome: "not_found" };
  const check = checkReviewInput(input.fields, input.limits);
  const errors: Partial<Record<ReceiptReviewField, string>> = check.ok ? {} : { ...check.errors };
  const store = typeof input.storeName === "string" ? input.storeName.trim() : "";
  if (!store || store.length > input.limits.maxStoreNameChars) errors.storeName = "Please say where you bought it.";
  const when = purchaseDate(input.purchasedOn);
  if (!when) errors.purchasedOn = "Please give the date on your receipt.";
  if (!check.ok) return { outcome: "invalid", errors };
  if (errors.storeName) return { outcome: "bad_store", errors };
  if (errors.purchasedOn || !when) return { outcome: "bad_date", errors };

  const photo = input.photo;
  if (!photo || photo.length === 0) return { outcome: "bad_photo" };
  if (photo.length > input.photoLimits.maxPhotoBytes) return { outcome: "too_big" };
  const mimeType = sniffImageType(photo);
  if (!mimeType) return { outcome: "bad_photo" };
  const header =
    input.header && input.header.length > 0 ? input.header.subarray(0, input.photoLimits.maxHeaderBytes) : null;
  const exif = readExifTakenAt(header ?? photo);
  const sha256 = createHash("sha256").update(photo).digest("hex");

  const v = check.value;
  const rows = await sql.query<{ r_outcome: ReceiptReviewOutcome; r_purchase_id: string | null }>(
    `select * from trufolks_submit_receipt_review($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $15, $16)`,
    [
      input.userId,
      store,
      when.toISOString(),
      v.rating,
      v.whatUsed,
      v.howLong,
      v.honestThought,
      input.limits.maxShortFieldChars,
      input.limits.maxThoughtChars,
      input.limits.maxReceiptOnlyPerDay,
      mimeType,
      Buffer.from(photo),
      sha256,
      exif ? exif.takenAt.toISOString() : null,
      exif ? exif.hasOffset : false,
      input.photoLimits.retentionSeconds,
    ],
  );
  const outcome = rows[0]?.r_outcome ?? "unavailable";
  if (outcome === "ok" && rows[0]?.r_purchase_id) return { outcome: "ok", purchaseId: rows[0].r_purchase_id };
  return { outcome: outcome === "ok" ? "unavailable" : outcome };
}
