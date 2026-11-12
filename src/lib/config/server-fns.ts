// Ticket 7 — settings server functions (BRD v1.6 CFG-01, CFG-12, CFG-13;
// gap 21). Admin only. Thin wrappers: rules live in engine.ts, validate.ts and
// migration 0009. Server-only modules are imported INSIDE handlers.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { configMessage, type ConfigOutcome } from "./messages.ts";

function fail(reason: Exclude<ConfigOutcome, "ok">, extra: Record<string, unknown> = {}) {
  return { ok: false as const, reason, message: configMessage(reason) ?? "", errors: [] as string[], guardrail: false, ...extra };
}

function logFailure(where: string, err: unknown) {
  console.error(`[config] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
}

async function adminDeps(userId: string) {
  const { getConfiguredSql } = await import("./runtime.ts");
  const { findAuthEmail, isAdminCaller } = await import("@/lib/receipt-codes/admin.ts");
  const { sql } = await getConfiguredSql();
  const admin = await isAdminCaller(userId, { lookupEmail: (id) => findAuthEmail(sql, id) });
  return { sql, admin, engine: await import("./engine.ts") };
}

/** Settings in force, any pending change, rejections, the log and unfinished disclosures. */
export const getSettingsForAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, admin, engine } = await adminDeps(context.userId);
      if (!admin) return fail("not_allowed");
      return { ok: true as const, view: await engine.getSettingsAdminView(sql) };
    } catch (err) {
      logFailure("view", err);
      return fail("unavailable");
    }
  });

/** Save new settings with a reason. Validated; refusals are logged. */
export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    return { settings: d.settings, reason: typeof d.reason === "string" ? d.reason.slice(0, 1000) : "" };
  })
  .handler(async ({ data, context }) => {
    try {
      const { sql, admin, engine } = await adminDeps(context.userId);
      if (!admin) return fail("not_allowed");
      const r = await engine.saveConfig(sql, { actorId: context.userId, settings: data.settings, reason: data.reason });
      if (r.outcome === "invalid") return fail("invalid", { errors: r.errors, guardrail: r.guardrail });
      if (r.outcome !== "ok") return fail(r.outcome);
      const { invalidateConfigCache } = await import("./runtime.ts");
      invalidateConfigCache();
      return { ok: true as const, effectiveAt: r.effectiveAt, coolingOff: r.coolingOff, changed: r.changes.length };
    } catch (err) {
      logFailure("save", err);
      return fail("unavailable");
    }
  });

/** Finish the disclosures of earlier reviews that can be completed now (gap 21). Logged. */
export const finishDisclosures = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, admin, engine } = await adminDeps(context.userId);
      if (!admin) return fail("not_allowed");
      return { ok: true as const, finished: await engine.finishPendingDisclosures(sql, { actorId: context.userId }) };
    } catch (err) {
      logFailure("finish disclosures", err);
      return fail("unavailable");
    }
  });
