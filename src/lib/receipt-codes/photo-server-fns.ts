// Ticket 3b-1 — receipt photo + admin review server functions (BRD v1.6 FR-08a,
// FR-09, RES-01, AI-06, NFR-04, NFR-06).
//
// Thin wrappers: rules live in photos.ts and the 0005 migration. Server-only
// modules are imported INSIDE handlers so they never reach the browser bundle.
// Plain messages only; photos and codes are never logged. Called by the scan
// page (/r/$code) and the admin page (/admin/purchases), Ticket 3b-2.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { RECEIPT_PHOTO_LIMITS } from "./limits.ts";
import { decideMessage, photoMessage, type DecideOutcome, type PhotoOutcome } from "./messages.ts";

function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
}

function text(data: unknown, name: string, max = 200): string {
  const v = field(data, name);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function logFailure(where: string, err: unknown) {
  console.error(`[receipt-photos] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
}

function photoFail(reason: Exclude<PhotoOutcome, "ok">) {
  return { ok: false as const, reason, message: photoMessage(reason) ?? "" };
}

function decideFail(reason: Exclude<DecideOutcome, "ok">) {
  return { ok: false as const, reason, message: decideMessage(reason) ?? "" };
}

/** Is the caller on the admin allowlist? (Locally, also the dev-only email list — see admin.ts.) */
async function callerIsAdmin(userId: string): Promise<boolean> {
  const { findAuthEmail, isAdminCaller } = await import("./admin.ts");
  return isAdminCaller(userId, {
    lookupEmail: async (id) => {
      const { getSql } = await import("@/lib/db");
      return findAuthEmail(await getSql(), id);
    },
  });
}

/**
 * The signed-in person's own claim on a code: lets the scan page show the
 * photo step again after a failed upload. Reveals nothing about other people's codes.
 */
export const getMyClaim = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ code: text(data, "code") }))
  .handler(async ({ data, context }) => {
    try {
      const { getSql } = await import("@/lib/db");
      const { getServerHashKeys } = await import("./codes.ts");
      const { findMyClaim } = await import("./photos.ts");
      const r = await findMyClaim(await getSql(), { rawCode: data.code, userId: context.userId, keys: getServerHashKeys() });
      if (r.outcome !== "ok") return { ok: false as const };
      return { ok: true as const, purchaseId: r.purchaseId, status: r.status, hasPhoto: r.hasPhoto };
    } catch (err) {
      logFailure("my-claim", err);
      return { ok: false as const };
    }
  });

/**
 * Upload the receipt photo for the person's own pending purchase.
 * FormData fields: purchaseId, photo (compressed image), header (optional:
 * the first bytes of the original file, read only for its "taken at" time).
 */
export const uploadReceiptPhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: FormData) => {
    if (!(data instanceof FormData)) return { purchaseId: "", photo: null, header: null };
    const purchaseId = data.get("purchaseId");
    const photo = data.get("photo");
    const header = data.get("header");
    return {
      purchaseId: typeof purchaseId === "string" ? purchaseId.slice(0, 100) : "",
      photo: photo instanceof Blob ? photo : null,
      header: header instanceof Blob ? header : null,
    };
  })
  .handler(async ({ data, context }) => {
    try {
      if (!data.photo) return photoFail("bad_photo");
      // Refuse oversized uploads before reading them into memory.
      if (data.photo.size > RECEIPT_PHOTO_LIMITS.maxPhotoBytes) return photoFail("too_big");
      const headerBlob = data.header ? data.header.slice(0, RECEIPT_PHOTO_LIMITS.maxHeaderBytes) : null;
      const { getSql } = await import("@/lib/db");
      const { storePhoto } = await import("./photos.ts");
      const r = await storePhoto(await getSql(), {
        purchaseId: data.purchaseId,
        userId: context.userId,
        photo: new Uint8Array(await data.photo.arrayBuffer()),
        header: headerBlob ? new Uint8Array(await headerBlob.arrayBuffer()) : null,
        limits: RECEIPT_PHOTO_LIMITS,
      });
      if (r.outcome !== "ok") return photoFail(r.outcome);
      return { ok: true as const, status: "pending_verification" as const };
    } catch (err) {
      logFailure("upload", err);
      return photoFail("unavailable");
    }
  });

/** Admin only: pending purchases with their flags (deletes expired photos first). */
export const listPendingPurchasesForReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return decideFail("not_allowed");
      const { getSql } = await import("@/lib/db");
      const { listPendingPurchases } = await import("./photos.ts");
      const purchases = await listPendingPurchases(await getSql(), { limits: RECEIPT_PHOTO_LIMITS });
      return { ok: true as const, purchases };
    } catch (err) {
      logFailure("list", err);
      return decideFail("unavailable");
    }
  });

/** Admin only: one purchase's receipt photo as a data URL, for viewing. */
export const getReceiptPhotoForReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ purchaseId: text(data, "purchaseId", 100) }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return decideFail("not_allowed");
      const { getSql } = await import("@/lib/db");
      const { getPhoto } = await import("./photos.ts");
      const photo = await getPhoto(await getSql(), data.purchaseId);
      if (!photo) return decideFail("no_photo");
      const url = `data:${photo.mimeType};base64,${Buffer.from(photo.bytes).toString("base64")}`;
      return { ok: true as const, url };
    } catch (err) {
      logFailure("photo", err);
      return decideFail("unavailable");
    }
  });

/** Admin only: approve (with the amount read off the receipt) or turn down (with a reason). */
export const decidePurchaseForReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    const d = field(data, "decision");
    const decision: "verified" | "rejected" | "" =
      d === "verified" ? "verified" : d === "rejected" ? "rejected" : "";
    const cents = field(data, "confirmedOrderValueCents");
    return {
      purchaseId: text(data, "purchaseId", 100),
      decision,
      reason: text(data, "reason", 500),
      confirmedOrderValueCents: typeof cents === "number" ? cents : null,
    };
  })
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return decideFail("not_allowed");
      if (data.decision === "") return decideFail("bad_decision");
      const { getSql } = await import("@/lib/db");
      const { decidePurchase } = await import("./photos.ts");
      const r = await decidePurchase(await getSql(), {
        purchaseId: data.purchaseId,
        adminUserId: context.userId,
        decision: data.decision,
        reason: data.reason,
        confirmedOrderValueCents: data.confirmedOrderValueCents,
        limits: RECEIPT_PHOTO_LIMITS,
      });
      if (r.outcome !== "ok") return decideFail(r.outcome);
      return { ok: true as const };
    } catch (err) {
      logFailure("decide", err);
      return decideFail("unavailable");
    }
  });
