// Ticket 8 — payout server functions (BRD v1.6 FR-20, FR-22, HON-09, MER-06,
// RES-01(c)). Thin wrappers: rules live in engine.ts and migration 0010.
// Server-only modules are imported INSIDE handlers.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { payoutMessage, type PayoutOutcome } from "./messages.ts";

function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
}

function text(data: unknown, name: string, max: number): string {
  const v = field(data, name);
  return typeof v === "string" ? v.slice(0, max + 1) : "";
}

function fail(reason: Exclude<PayoutOutcome, "ok">) {
  return { ok: false as const, reason, message: payoutMessage(reason) ?? "" };
}

function logFailure(where: string, err: unknown) {
  console.error(`[payouts] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
}

async function deps(userId: string, needAdmin: boolean) {
  const { getConfiguredSql } = await import("@/lib/config/runtime");
  const { sql } = await getConfiguredSql();
  let admin = false;
  if (needAdmin) {
    const { findAuthEmail, isAdminCaller } = await import("@/lib/receipt-codes/admin.ts");
    admin = await isAdminCaller(userId, { lookupEmail: (id) => findAuthEmail(sql, id) });
  }
  return { sql, admin, engine: await import("./engine.ts") };
}

/** FR-20: the signed-in person's payouts, with status and amount. */
export const getMyPayouts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, engine } = await deps(context.userId, false);
      return {
        ok: true as const,
        payouts: await engine.myPayouts(sql, { userId: context.userId }),
      };
    } catch (err) {
      logFailure("mine", err);
      return fail("unavailable");
    }
  });

/** Every payout and every offer's deposits, for the TruFolks team. */
export const getPayoutsForAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, admin, engine } = await deps(context.userId, true);
      if (!admin) return fail("not_allowed");
      const payouts = await engine.adminPayouts(sql);
      const offers = await engine.adminOffers(sql);
      return { ok: true as const, payouts, offers };
    } catch (err) {
      logFailure("admin list", err);
      return fail("unavailable");
    }
  });

/** Record money received from the business for an offer (MER-06). */
export const recordDepositForAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    const cents = field(data, "amountCents");
    return {
      campaignId: text(data, "campaignId", 100),
      amountCents: typeof cents === "number" ? cents : Number.NaN,
      note: text(data, "note", 500),
    };
  })
  .handler(async ({ data, context }) => {
    try {
      const { sql, admin, engine } = await deps(context.userId, true);
      if (!admin) return fail("not_allowed");
      const r = await engine.recordDeposit(sql, { actorId: context.userId, ...data });
      if (r !== "ok") return fail(r);
      return { ok: true as const };
    } catch (err) {
      logFailure("deposit", err);
      return fail("unavailable");
    }
  });

/** Flag / clear / forfeit / mark paid. Every action needs a reason (or how it was paid) and is logged. */
export const actOnPayoutForAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    (
      data: unknown,
    ): {
      payoutId: string;
      kind: "flag" | "clear_flag" | "forfeit" | "paid" | null;
      forfeitKind: "returned" | "policy_breach" | null;
      reason: string;
      method: string;
      reference: string;
    } => {
      const kind = field(data, "kind");
      const fk = field(data, "forfeitKind");
      return {
        payoutId: text(data, "payoutId", 100),
        kind:
          kind === "flag" || kind === "clear_flag" || kind === "forfeit" || kind === "paid"
            ? kind
            : null,
        forfeitKind: fk === "returned" || fk === "policy_breach" ? fk : null,
        reason: text(data, "reason", 1000),
        method: text(data, "method", 200),
        reference: text(data, "reference", 200),
      };
    },
  )
  .handler(async ({ data, context }) => {
    if (!data.kind) return fail("invalid");
    try {
      const { sql, admin, engine } = await deps(context.userId, true);
      if (!admin) return fail("not_allowed");
      const action =
        data.kind === "forfeit"
          ? data.forfeitKind
            ? { kind: "forfeit" as const, forfeitKind: data.forfeitKind, reason: data.reason }
            : null
          : data.kind === "paid"
            ? { kind: "paid" as const, method: data.method, reference: data.reference }
            : { kind: data.kind, reason: data.reason };
      if (!action) return fail("invalid");
      const r = await engine.actOnPayout(sql, {
        actorId: context.userId,
        payoutId: data.payoutId,
        action,
      });
      if (r !== "ok") return fail(r);
      return { ok: true as const };
    } catch (err) {
      logFailure("act", err);
      return fail("unavailable");
    }
  });
