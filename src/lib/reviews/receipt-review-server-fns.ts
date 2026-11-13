// v1.8 (REV-18-02) — the server function behind Add a review's "Add your
// receipt" step. FormData, because it carries the receipt photo. Thin wrapper:
// rules live in receipt-review.ts and migration 0012. Review text, photos and
// store names are never logged.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { RECEIPT_PHOTO_LIMITS } from "@/lib/receipt-codes/limits";
import { REVIEW_LIMITS } from "./limits.ts";
import { receiptReviewMessage, type ReceiptReviewOutcome } from "./receipt-review-messages.ts";

function str(data: FormData, name: string, max: number): string {
  const v = data.get(name);
  // Cut above the real limit so an oversized field is still refused as too long.
  return typeof v === "string" ? v.slice(0, max + 1) : "";
}

function fail(reason: Exclude<ReceiptReviewOutcome, "ok">, errors: Record<string, string> = {}) {
  return { ok: false as const, reason, message: receiptReviewMessage(reason) ?? "", errors };
}

/**
 * FormData: rating, whatUsed, howLong, honestThought, storeName, purchasedOn
 * (YYYY-MM-DD), photo (compressed), header (optional: start of the original file).
 */
export const submitReceiptReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: FormData) => {
    if (!(data instanceof FormData)) return null;
    const photo = data.get("photo");
    const header = data.get("header");
    return {
      rating: Number(str(data, "rating", 2)),
      whatUsed: str(data, "whatUsed", REVIEW_LIMITS.maxShortFieldChars),
      howLong: str(data, "howLong", REVIEW_LIMITS.maxShortFieldChars),
      honestThought: str(data, "honestThought", REVIEW_LIMITS.maxThoughtChars),
      storeName: str(data, "storeName", REVIEW_LIMITS.maxStoreNameChars),
      purchasedOn: str(data, "purchasedOn", 10),
      photo: photo instanceof Blob ? photo : null,
      header: header instanceof Blob ? header : null,
    };
  })
  .handler(async ({ data, context }) => {
    try {
      if (!data) return fail("invalid");
      if (!data.photo) return fail("bad_photo");
      if (data.photo.size > RECEIPT_PHOTO_LIMITS.maxPhotoBytes) return fail("too_big");
      const headerBlob = data.header ? data.header.slice(0, RECEIPT_PHOTO_LIMITS.maxHeaderBytes) : null;
      const { getSql } = await import("@/lib/db");
      const engine = await import("./receipt-review.ts");
      const r = await engine.submitReceiptReview(await getSql(), {
        userId: context.userId,
        fields: { rating: data.rating, whatUsed: data.whatUsed, howLong: data.howLong, honestThought: data.honestThought },
        storeName: data.storeName,
        purchasedOn: data.purchasedOn,
        photo: new Uint8Array(await data.photo.arrayBuffer()),
        header: headerBlob ? new Uint8Array(await headerBlob.arrayBuffer()) : null,
        limits: REVIEW_LIMITS,
        photoLimits: RECEIPT_PHOTO_LIMITS,
      });
      if (r.outcome !== "ok") return fail(r.outcome, r.errors ?? {});
      return { ok: true as const, purchaseId: r.purchaseId };
    } catch (err) {
      console.error("[receipt-review] submit failed:", err instanceof Error ? err.message : "unknown error");
      return fail("unavailable");
    }
  });
