// Ticket 4 — review server functions (BRD v1.6 FR-11, FR-13–FR-15, HON-02,
// LEG-01, AI-05, NFR-06). Thin wrappers: rules live in engine.ts and
// migration 0006. Server-only modules are imported INSIDE handlers so they
// never reach the browser bundle. Review text is never logged.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { REVIEW_LIMITS } from "./limits.ts";
import { reviewMessage, type ReviewOutcome } from "./messages.ts";

function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
}

function text(data: unknown, name: string, max: number): string {
  const v = field(data, name);
  // Cut far above the real limit so an oversized field is still refused as too long.
  return typeof v === "string" ? v.slice(0, max + 1) : "";
}

function fail(reason: Exclude<ReviewOutcome, "ok">) {
  return { ok: false as const, reason, message: reviewMessage(reason) ?? "" };
}

function logFailure(where: string, err: unknown) {
  console.error(`[reviews] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
}

/** The signed-in person's own purchase and, if posted, their review. */
export const getReviewStart = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ purchaseId: text(data, "purchaseId", 100) }))
  .handler(async ({ data, context }) => {
    try {
      const { getSql } = await import("@/lib/db");
      const engine = await import("./engine.ts");
      const r = await engine.getReviewStart(await getSql(), { purchaseId: data.purchaseId, userId: context.userId });
      if (r.outcome !== "ok") return fail("not_found");
      return { ok: true as const, start: r.start };
    } catch (err) {
      logFailure("start", err);
      return fail("unavailable");
    }
  });

/** Post a review. The disclosure is attached by the database, never sent from here. */
export const submitReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    const rating = field(data, "rating");
    return {
      purchaseId: text(data, "purchaseId", 100),
      rating: typeof rating === "number" ? rating : Number.NaN,
      whatUsed: text(data, "whatUsed", REVIEW_LIMITS.maxShortFieldChars),
      howLong: text(data, "howLong", REVIEW_LIMITS.maxShortFieldChars),
      honestThought: text(data, "honestThought", REVIEW_LIMITS.maxThoughtChars),
    };
  })
  .handler(async ({ data, context }) => {
    try {
      const { getSql } = await import("@/lib/db");
      const engine = await import("./engine.ts");
      const r = await engine.submitReview(await getSql(), {
        purchaseId: data.purchaseId,
        userId: context.userId,
        fields: { rating: data.rating, whatUsed: data.whatUsed, howLong: data.howLong, honestThought: data.honestThought },
        limits: REVIEW_LIMITS,
      });
      if (r.outcome !== "ok") return { ...fail(r.outcome), errors: r.errors ?? {} };
      return { ok: true as const, review: r.review };
    } catch (err) {
      logFailure("submit", err);
      return fail("unavailable");
    }
  });
