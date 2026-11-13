// Ticket 3b-2 — shrink a receipt photo in the browser before upload (FR-08a).
// BROWSER-ONLY: uses createImageBitmap and canvas. Never import on the server.
//
// Re-encoding through a canvas strips EXIF, so the start of the ORIGINAL file
// is sent separately as `header`; the server reads only its "taken at" time
// (never location). Sizes come from RECEIPT_PHOTO_LIMITS.
import { RECEIPT_PHOTO_LIMITS } from "./limits.ts";
import { scaledSize } from "./form-input.ts";

/** Longest side to aim for, then a smaller fallback. Readable receipt text at phone size. */
const SIDES = [1600, 1200] as const;
const QUALITIES = [0.7, 0.6, 0.5, 0.4] as const;

export type CompressResult =
  | { ok: true; photo: Blob; header: Blob }
  | { ok: false; reason: "bad_photo" | "too_big" };

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

export async function compressReceiptPhoto(file: File): Promise<CompressResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "bad_photo" };
  }
  try {
    const header = file.slice(0, RECEIPT_PHOTO_LIMITS.maxHeaderBytes);
    for (const side of SIDES) {
      const { width, height } = scaledSize(bitmap.width, bitmap.height, side);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, reason: "bad_photo" };
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const q of QUALITIES) {
        const blob = await toJpeg(canvas, q);
        if (!blob) return { ok: false, reason: "bad_photo" };
        if (blob.size <= RECEIPT_PHOTO_LIMITS.maxPhotoBytes) return { ok: true, photo: blob, header };
      }
    }
    return { ok: false, reason: "too_big" };
  } finally {
    bitmap.close();
  }
}

/** The FormData uploadReceiptPhoto expects. */
export function receiptPhotoForm(purchaseId: string, photo: Blob, header: Blob): FormData {
  const form = new FormData();
  form.set("purchaseId", purchaseId);
  form.set("photo", photo, "receipt.jpg");
  form.set("header", header, "header.bin");
  return form;
}
