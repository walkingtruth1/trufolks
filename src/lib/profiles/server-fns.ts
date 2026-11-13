// v1.7 — My Profile, Top 5, Shop, catalog and sharing server functions. Thin
// wrappers: rules live in engine.ts and migration 0011. Owner writes use
// authMiddleware and act only on context.userId. Public reads use
// optionalAuthMiddleware and hand the (possibly null) viewer to the engine,
// which applies the visibility rule. Server-only modules are imported INSIDE
// handlers so they never reach the browser bundle. Review text is never logged.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { optionalAuthMiddleware } from "@/lib/auth/optional-middleware";
import type { ProfileOutcome } from "./engine.ts";
import { profileMessage } from "./messages.ts";

function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
}

function text(data: unknown, name: string, max: number): string {
  const v = field(data, name);
  return typeof v === "string" ? v.slice(0, max + 1) : "";
}

function fail(reason: Exclude<ProfileOutcome, "ok">) {
  return { ok: false as const, reason, message: profileMessage(reason) ?? "" };
}

function done(outcome: ProfileOutcome) {
  return outcome === "ok" ? { ok: true as const } : fail(outcome);
}

function logFailure(where: string, err: unknown) {
  console.error(`[profiles] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
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

// ------------------------------------------------------------------ owner

/** My Profile: the owner's full view, plus what they can pin. */
export const getMyProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, engine } = await deps();
      await engine.ensureProfile(sql, context.userId);
      const r = await engine.getProfileView(sql, { ownerId: context.userId, viewerId: context.userId });
      if (r.outcome !== "ok") return fail("not_found");
      return { ok: true as const, view: r.view };
    } catch (err) {
      logFailure("my profile", err);
      return fail("unavailable");
    }
  });

export const updateProfileBio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ bio: text(data, "bio", 280) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      return done(await engine.setBio(sql, { userId: context.userId, bio: data.bio }));
    } catch (err) {
      logFailure("bio", err);
      return fail("unavailable");
    }
  });

export const updateDisplayName = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ name: text(data, "name", 60) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      return done(await engine.setDisplayName(sql, { userId: context.userId, name: data.name }));
    } catch (err) {
      logFailure("display name", err);
      return fail("unavailable");
    }
  });

export const setShopItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ reviewId: text(data, "reviewId", 100), on: field(data, "on") === true }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      return done(await engine.setShopItem(sql, { userId: context.userId, reviewId: data.reviewId, on: data.on }));
    } catch (err) {
      logFailure("shop item", err);
      return fail("unavailable");
    }
  });

export const setProfileAudience = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ audience: text(data, "audience", 10) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      return done(await engine.setProfileAudience(sql, { userId: context.userId, audience: data.audience }));
    } catch (err) {
      logFailure("profile audience", err);
      return fail("unavailable");
    }
  });

export const setReviewAudience = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ reviewId: text(data, "reviewId", 100), audience: text(data, "audience", 10) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      return done(
        await engine.setReviewAudience(sql, { userId: context.userId, reviewId: data.reviewId, audience: data.audience }),
      );
    } catch (err) {
      logFailure("review audience", err);
      return fail("unavailable");
    }
  });

export const saveTopPicks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => {
    const ids = field(data, "reviewIds");
    return {
      list: text(data, "list", 10),
      reviewIds: Array.isArray(ids) ? ids.slice(0, 6).map((x) => (typeof x === "string" ? x.slice(0, 101) : "")) : [],
    };
  })
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      return done(await engine.setTopPicks(sql, { userId: context.userId, list: data.list, reviewIds: data.reviewIds }));
    } catch (err) {
      logFailure("top picks", err);
      return fail("unavailable");
    }
  });

/** Add a review: the shopper's own purchases with status and next step. */
export const getMyPurchases = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, engine } = await deps();
      return { ok: true as const, purchases: await engine.myPurchases(sql, { userId: context.userId }) };
    } catch (err) {
      logFailure("purchases", err);
      return fail("unavailable");
    }
  });

/** Link one of your reviews to a catalog record (or queue a new one). */
export const linkReviewToProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    reviewId: text(data, "reviewId", 100),
    kind: text(data, "kind", 10),
    brand: text(data, "brand", 80),
    model: text(data, "model", 120),
    variant: text(data, "variant", 80),
    category: text(data, "category", 60),
    gtin: text(data, "gtin", 20),
    mpn: text(data, "mpn", 60),
    offerSeller: text(data, "offerSeller", 80),
    offerUrl: text(data, "offerUrl", 500),
  }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const { reviewId, ...fields } = data;
      const r = await engine.linkReviewProduct(sql, { userId: context.userId, reviewId, fields });
      if (r.outcome !== "ok") return fail(r.outcome);
      return { ok: true as const, status: r.status };
    } catch (err) {
      logFailure("link product", err);
      return fail("unavailable");
    }
  });

export const requestCatalogCorrection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ slug: text(data, "slug", 120), note: text(data, "note", 500) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      return done(await engine.requestCorrection(sql, { userId: context.userId, slug: data.slug, note: data.note }));
    } catch (err) {
      logFailure("correction", err);
      return fail("unavailable");
    }
  });

// ------------------------------------------------------------------ public reads

/** A profile by handle, as this visitor may see it. The owner may preview as a friend or as anyone. */
export const getProfile = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .inputValidator((data: unknown) => {
    const raw = field(data, "as");
    const as: "friend" | "anonymous" | null = raw === "friend" || raw === "anonymous" ? raw : null;
    return { handle: text(data, "handle", 60), as };
  })
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const r = await engine.getProfileView(sql, { handle: data.handle, viewerId: context.userId, previewAs: data.as });
      if (r.outcome !== "ok") return fail("not_found");
      return { ok: true as const, view: r.view, signedIn: context.userId !== null };
    } catch (err) {
      logFailure("profile", err);
      return fail("unavailable");
    }
  });

export const getReview = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .inputValidator((data: unknown) => ({ reviewId: text(data, "reviewId", 100) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const r = await engine.getReviewPage(sql, { reviewId: data.reviewId, viewerId: context.userId });
      if (r.outcome !== "ok") return fail("not_found");
      return { ok: true as const, review: r.review, isOwner: r.relation === "owner", signedIn: context.userId !== null };
    } catch (err) {
      logFailure("review", err);
      return fail("unavailable");
    }
  });

export const getProduct = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .inputValidator((data: unknown) => ({ slug: text(data, "slug", 120) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const r = await engine.getProductPage(sql, { slug: data.slug, viewerId: context.userId });
      if (r.outcome === "moved") return { ok: true as const, moved: r.slug };
      if (r.outcome !== "ok") return fail("not_found");
      return { ok: true as const, page: r.page, signedIn: context.userId !== null };
    } catch (err) {
      logFailure("product", err);
      return fail("unavailable");
    }
  });

// ------------------------------------------------------------------ catalog admin (TruFolks team)

export const getCatalogAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_found");
      const { sql, engine } = await deps();
      return { ok: true as const, ...(await engine.catalogAdminView(sql)) };
    } catch (err) {
      logFailure("catalog admin", err);
      return fail("unavailable");
    }
  });

export const decideCatalogProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    productId: text(data, "productId", 100),
    action: text(data, "action", 10),
    targetId: text(data, "targetId", 100) || null,
  }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_found");
      const { sql, engine } = await deps();
      return done(await engine.adminDecideProduct(sql, { adminId: context.userId, ...data }));
    } catch (err) {
      logFailure("decide product", err);
      return fail("unavailable");
    }
  });

export const updateCatalogProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    productId: text(data, "productId", 100),
    kind: text(data, "kind", 10),
    brand: text(data, "brand", 80),
    model: text(data, "model", 120),
    variant: text(data, "variant", 80),
    category: text(data, "category", 60),
    gtin: text(data, "gtin", 20),
    mpn: text(data, "mpn", 60),
    releaseYear: text(data, "releaseYear", 4),
    releaseYearVerified: field(data, "releaseYearVerified") === true,
  }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_found");
      const { sql, engine } = await deps();
      const { productId, ...fields } = data;
      return done(await engine.adminUpdateProduct(sql, { adminId: context.userId, productId, fields }));
    } catch (err) {
      logFailure("update product", err);
      return fail("unavailable");
    }
  });

export const decideSellerOffer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    offerId: text(data, "offerId", 100),
    action: text(data, "action", 10),
    referralCommission: field(data, "referralCommission") === true,
  }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_found");
      const { sql, engine } = await deps();
      return done(await engine.adminDecideOffer(sql, { adminId: context.userId, ...data }));
    } catch (err) {
      logFailure("decide offer", err);
      return fail("unavailable");
    }
  });

export const addSellerOffer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    productId: text(data, "productId", 100),
    sellerName: text(data, "sellerName", 80),
    url: text(data, "url", 500),
    kind: text(data, "kind", 10),
    referralCommission: field(data, "referralCommission") === true,
  }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_found");
      const { sql, engine } = await deps();
      return done(await engine.adminAddOffer(sql, { adminId: context.userId, ...data }));
    } catch (err) {
      logFailure("add offer", err);
      return fail("unavailable");
    }
  });

export const resolveCatalogCorrection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ correctionId: text(data, "correctionId", 100), action: text(data, "action", 10) }))
  .handler(async ({ data, context }) => {
    try {
      if (!(await callerIsAdmin(context.userId))) return fail("not_found");
      const { sql, engine } = await deps();
      return done(await engine.adminResolveCorrection(sql, { adminId: context.userId, ...data }));
    } catch (err) {
      logFailure("resolve correction", err);
      return fail("unavailable");
    }
  });
