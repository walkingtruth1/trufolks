// Ticket 6 — merchant dashboard and concierge set-up server functions (BRD
// v1.6 FR-24, MER-01, MER-02, MER-05, MER-07, §13, P5, NFR-06). Thin wrappers:
// rules live in engine.ts and migration 0008. Server-only modules are imported
// INSIDE handlers so they never reach the browser bundle. Making receipt codes
// reuses `generateReceiptCodes` from the receipt-code server functions.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { MERCHANT_LIMITS } from "./limits.ts";
import { merchantMessage, type MerchantOutcome } from "./messages.ts";

function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
}

function text(data: unknown, name: string, max: number): string {
  const v = field(data, name);
  // Cut just above the real limit so an oversized field is still refused.
  return typeof v === "string" ? v.slice(0, max + 1) : "";
}

function fail(reason: Exclude<MerchantOutcome, "ok">) {
  return { ok: false as const, reason, message: merchantMessage(reason) ?? "" };
}

function logFailure(where: string, err: unknown) {
  console.error(`[merchants] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
}

async function deps() {
  const { getSql } = await import("@/lib/db");
  const engine = await import("./engine.ts");
  return { sql: await getSql(), engine };
}

async function callerIsAdmin(userId: string): Promise<boolean> {
  const { findAuthEmail, isAdminCaller } = await import("@/lib/receipt-codes/admin.ts");
  return isAdminCaller(userId, {
    lookupEmail: async (id) => {
      const { getSql } = await import("@/lib/db");
      return findAuthEmail(await getSql(), id);
    },
  });
}

/** The signed-in owner's businesses, offers, numbers and reviews. Empty if they own none. */
export const getMerchantDashboard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, engine } = await deps();
      const businesses = await engine.getDashboard(sql, { userId: context.userId, limits: MERCHANT_LIMITS });
      return { ok: true as const, businesses };
    } catch (err) {
      logFailure("dashboard", err);
      return fail("unavailable");
    }
  });

/** The owner accepts the MER-02 statement or the MER-07 walkthrough. */
export const acceptMerchantStatement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown): { merchantId: string; what: "terms" | "walkthrough" | null } => {
    const what = field(data, "what");
    return {
      merchantId: text(data, "merchantId", 100),
      what: what === "terms" || what === "walkthrough" ? what : null,
    };
  })
  .handler(async ({ data, context }) => {
    if (!data.what) return fail("invalid");
    try {
      const { sql, engine } = await deps();
      const r = await engine.acceptMerchant(sql, { userId: context.userId, merchantId: data.merchantId, what: data.what });
      if (r !== "ok" && r !== "already") return fail(r);
      return { ok: true as const };
    } catch (err) {
      logFailure("accept", err);
      return fail("unavailable");
    }
  });

// ------------------------------------------------------------------ admin only

/** Every business, for the TruFolks team. */
export const listBusinessesForAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_allowed");
      const { sql, engine } = await deps();
      return { ok: true as const, businesses: await engine.listBusinessesForAdmin(sql) };
    } catch (err) {
      logFailure("admin list", err);
      return fail("unavailable");
    }
  });

/** Add a business for an existing account (found by login email), after checking it in person (MER-01). */
export const createBusinessForAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    ownerEmail: text(data, "ownerEmail", 320),
    name: text(data, "name", 120),
    businessType: text(data, "businessType", 80),
  }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_allowed");
      const { sql, engine } = await deps();
      const r = await engine.adminCreateBusiness(sql, { adminId: context.userId, ...data });
      if (r.outcome !== "ok") return fail(r.outcome);
      return { ok: true as const, merchantId: r.merchantId };
    } catch (err) {
      logFailure("admin create business", err);
      return fail("unavailable");
    }
  });

/** Create a live Type A offer for a business (pilot preset). Dates are ISO strings. */
export const createOfferForAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    merchantId: text(data, "merchantId", 100),
    name: text(data, "name", 120),
    startsAt: text(data, "startsAt", 40) || null,
    endsAt: text(data, "endsAt", 40) || null,
  }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_allowed");
      const { sql, engine } = await deps();
      const r = await engine.adminCreateOffer(sql, { adminId: context.userId, ...data });
      if (r.outcome !== "ok") return fail(r.outcome);
      return { ok: true as const, campaignId: r.campaignId };
    } catch (err) {
      logFailure("admin create offer", err);
      return fail("unavailable");
    }
  });
