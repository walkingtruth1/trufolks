// Ticket 3a — receipt code server functions (BRD v1.6 FR-06–FR-10, HON-07, NFR-06).
//
// Thin wrappers: every rule lives in engine.ts and the 0004 migration. Server-
// only modules (db, crypto, request helpers) are imported INSIDE handlers so
// they never reach the browser bundle. Every failure returns a plain message;
// nothing technical is shown to the person, and raw codes are never logged.
// Ticket 7: the fraud-check limits come from settings (CFG-11) via
// getConfiguredSql, and the scan returns the offer's PAY-08 formula so the
// buyer knows what they get back before buying (Type A, CFG-05).
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { DEVICE_COOKIE_NAME, DEVICE_TOKEN_MAX_AGE_SECONDS } from "./limits.ts";
import { codeMessage, generateMessage, type CodeOutcome, type GenerateOutcome } from "./messages.ts";

type Fail = { ok: false; reason: Exclude<CodeOutcome, "ok">; message: string };

function fail(reason: Exclude<CodeOutcome, "ok">): Fail {
  return { ok: false, reason, message: codeMessage(reason) ?? "" };
}

function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
}

function text(data: unknown, name: string, max = 200): string {
  const v = field(data, name);
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Device, network-address hash, keys and db for this request. */
async function requestContext(createDevice: boolean) {
  const { getCookie, setCookie, getRequestIP } = await import("@tanstack/react-start/server");
  const { getConfiguredSql } = await import("@/lib/config/runtime");
  const { codeLimitsFrom } = await import("@/lib/config/engine");
  const { getServerHashKeys, hashIp } = await import("./codes.ts");
  const { ensureDevice, findDevice } = await import("./engine.ts");

  const { sql, loaded } = await getConfiguredSql();
  const limits = codeLimitsFrom(loaded.config);
  const keys = getServerHashKeys();
  // Vercel sets X-Forwarded-For itself, so it can be trusted there.
  const ipHash = hashIp(getRequestIP({ xForwardedFor: true }), keys);
  const rawToken = getCookie(DEVICE_COOKIE_NAME);

  if (!createDevice) {
    return { sql, keys, ipHash, limits, deviceId: await findDevice(sql, rawToken), rateLimited: false };
  }
  const device = await ensureDevice(sql, { rawToken, ipHash, limits });
  if (!device.ok) return { sql, keys, ipHash, limits, deviceId: null, rateLimited: true };
  if (device.newRawToken) {
    // Long-lived device token (HON-07) — deliberately not a session cookie.
    setCookie(DEVICE_COOKIE_NAME, device.newRawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_TOKEN_MAX_AGE_SECONDS,
    });
  }
  return { sql, keys, ipHash, limits, deviceId: device.deviceId, rateLimited: false };
}

function logFailure(where: string, err: unknown) {
  console.error(`[receipt-codes] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
}

/**
 * Scan a code (FR-07). Works signed out, because the offer is explained before
 * sign-in (Journey A). Binds the code to this phone on the first valid scan.
 */
export const scanReceiptCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ({ code: text(data, "code") }))
  .handler(async ({ data }) => {
    try {
      const ctx = await requestContext(true);
      if (ctx.rateLimited || !ctx.deviceId) return fail("rate_limited");
      const { scanCode } = await import("./engine.ts");
      const r = await scanCode(ctx.sql, {
        rawCode: data.code,
        deviceId: ctx.deviceId,
        ipHash: ctx.ipHash,
        keys: ctx.keys,
        limits: ctx.limits,
      });
      if (r.outcome !== "ok") return fail(r.outcome);
      const { loadCampaignConfig } = await import("@/lib/config/engine");
      const payout = (await loadCampaignConfig(ctx.sql, r.campaignId)).config.payout;
      return {
        ok: true as const,
        merchantName: r.merchantName,
        campaignName: r.campaignName,
        campaignEndsAt: r.campaignEndsAt,
        formula: {
          percentBp: payout.percent_bp,
          floorCents: payout.floor_cents,
          capCents: payout.cap_cents,
          currency: payout.currency,
        },
      };
    } catch (err) {
      logFailure("scan", err);
      return fail("unavailable");
    }
  });

/**
 * Claim a scanned code for a purchase (FR-08). Signed in, same phone. Creates
 * a pending purchase only — no reward is promised or calculated here.
 */
export const claimReceiptCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    const cents = field(data, "orderValueCents");
    return {
      code: text(data, "code"),
      productLabel: text(data, "productLabel"),
      orderValueCents: typeof cents === "number" ? cents : Number.NaN,
      currency: text(data, "currency", 3) || "USD",
      purchasedAt: text(data, "purchasedAt", 40),
    };
  })
  .handler(async ({ data, context }) => {
    try {
      const ctx = await requestContext(false);
      const { claimCode } = await import("./engine.ts");
      const r = await claimCode(ctx.sql, {
        rawCode: data.code,
        deviceId: ctx.deviceId,
        userId: context.userId,
        ipHash: ctx.ipHash,
        details: {
          productLabel: data.productLabel,
          orderValueCents: data.orderValueCents,
          currency: data.currency,
          purchasedAt: data.purchasedAt,
        },
        keys: ctx.keys,
        limits: ctx.limits,
      });
      if (r.outcome !== "ok") return fail(r.outcome);
      return { ok: true as const, purchaseId: r.purchaseId, status: "pending_verification" as const };
    } catch (err) {
      logFailure("claim", err);
      return fail("unavailable");
    }
  });

/**
 * A merchant owner makes codes for their campaign (FR-06, MER-02, MER-07).
 * Returns the printable codes once; only hashes are kept.
 */
export const generateReceiptCodes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    const count = field(data, "count");
    const mode = field(data, "issueMode");
    return {
      campaignId: text(data, "campaignId", 100),
      count: typeof count === "number" ? count : Number.NaN,
      // Pilot default: handout codes, which always need the receipt photo check.
      issueMode: mode === "till_single_purchase" ? ("till_single_purchase" as const) : ("handout_batch" as const),
    };
  })
  .handler(async ({ data, context }) => {
    const failGen = (reason: Exclude<GenerateOutcome, "ok">) => ({
      ok: false as const,
      reason,
      message: generateMessage(reason) ?? "",
    });
    try {
      const { getConfiguredSql } = await import("@/lib/config/runtime");
      const { codeLimitsFrom } = await import("@/lib/config/engine");
      const { getServerHashKeys } = await import("./codes.ts");
      const { generateCodes } = await import("./engine.ts");
      const { sql, loaded } = await getConfiguredSql();
      // Ticket 8 (MER-06): no codes before the business has funded the offer.
      // (The database budget check also refuses claims on an unfunded offer.)
      const { offerDepositedCents } = await import("@/lib/payouts/engine");
      if ((await offerDepositedCents(sql, data.campaignId)) <= 0) return failGen("not_funded");
      const r = await generateCodes(sql, {
        userId: context.userId,
        campaignId: data.campaignId,
        count: data.count,
        issueMode: data.issueMode,
        keys: getServerHashKeys(),
        limits: codeLimitsFrom(loaded.config),
      });
      if (r.outcome !== "ok") return failGen(r.outcome);
      return { ok: true as const, codes: r.codes };
    } catch (err) {
      logFailure("generate", err);
      return failGen("unavailable");
    }
  });
