// Ticket 5 — contacts and contacts feed server functions (BRD v1.6 FR-02,
// FR-16–FR-18, P1, LEG-01, NFR-06). Thin wrappers: rules live in engine.ts and
// migration 0007. Server-only modules are imported INSIDE handlers so they
// never reach the browser bundle. Tokens and review text are never logged.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { CONTACT_LIMITS } from "./limits.ts";
import { contactMessage, type ContactOutcome } from "./messages.ts";

function field(data: unknown, name: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[name] : undefined;
}

function text(data: unknown, name: string, max: number): string {
  const v = field(data, name);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function fail(reason: Exclude<ContactOutcome, "ok">) {
  return { ok: false as const, reason, message: contactMessage(reason) ?? "" };
}

function logFailure(where: string, err: unknown) {
  console.error(`[contacts] ${where} failed:`, err instanceof Error ? err.message : "unknown error");
}

async function deps() {
  const { getSql } = await import("@/lib/db");
  const engine = await import("./engine.ts");
  return { sql: await getSql(), engine };
}

/** Your contacts page: your invite link's dates, your contacts, the people you blocked, and places. */
export const getContactsHome = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, engine } = await deps();
      const [invite, list, places] = await Promise.all([
        engine.getInviteState(sql, { userId: context.userId }),
        engine.listContacts(sql, { userId: context.userId }),
        engine.contactPlaces(sql, { viewerId: context.userId }),
      ]);
      return { ok: true as const, invite, contacts: list.contacts, blocked: list.blocked, places, myUserId: context.userId };
    } catch (err) {
      logFailure("home", err);
      return fail("unavailable");
    }
  });

/** Make a new invite link (the old one stops working). The raw token is returned once. */
export const createInviteLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, engine } = await deps();
      const r = await engine.createInvite(sql, { userId: context.userId, limits: CONTACT_LIMITS });
      if (r.outcome !== "ok") return fail("unavailable");
      return { ok: true as const, token: r.token, expiresAt: r.expiresAt };
    } catch (err) {
      logFailure("create invite", err);
      return fail("unavailable");
    }
  });

/** Turn your invite link off. */
export const revokeInviteLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { sql, engine } = await deps();
      await engine.revokeInvite(sql, { userId: context.userId });
      return { ok: true as const };
    } catch (err) {
      logFailure("revoke invite", err);
      return fail("unavailable");
    }
  });

/** What an invite link would do for you. Changes nothing. */
export const getInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ token: text(data, "token", 100) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const r = await engine.lookupInvite(sql, { token: data.token, userId: context.userId });
      if (r.outcome === "not_found") return fail("not_found");
      return { ok: true as const, status: r.outcome, inviterName: r.inviterName };
    } catch (err) {
      logFailure("look up invite", err);
      return fail("unavailable");
    }
  });

/** Accept an invite: you and the person who sent it become contacts. */
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ token: text(data, "token", 100) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const r = await engine.acceptInvite(sql, { token: data.token, userId: context.userId });
      if (r.outcome !== "ok") return fail(r.outcome);
      return { ok: true as const, inviterId: r.inviterId };
    } catch (err) {
      logFailure("accept invite", err);
      return fail("unavailable");
    }
  });

/** Remove, block or unblock one of your contacts. */
export const changeContact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown): { userId: string; action: "remove" | "block" | "unblock" | null } => {
    const action = field(data, "action");
    return {
      userId: text(data, "userId", 100),
      action: action === "remove" || action === "block" || action === "unblock" ? action : null,
    };
  })
  .handler(async ({ data, context }) => {
    if (!data.action) return fail("not_contact");
    try {
      const { sql, engine } = await deps();
      const r = await engine.changeContact(sql, { userId: context.userId, otherId: data.userId, action: data.action });
      if (r !== "ok") return fail("not_contact");
      return { ok: true as const };
    } catch (err) {
      logFailure("change contact", err);
      return fail("unavailable");
    }
  });

/** Your contacts' reviews, newest first. Only reviews with the full disclosure (LEG-01). */
export const getContactFeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({
    before: text(data, "before", 200) || null,
    merchantId: text(data, "merchantId", 100) || null,
  }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const page = await engine.contactFeed(sql, {
        viewerId: context.userId,
        before: data.before,
        merchantId: data.merchantId,
        limits: CONTACT_LIMITS,
      });
      return { ok: true as const, ...page };
    } catch (err) {
      logFailure("feed", err);
      return fail("unavailable");
    }
  });

/** One person's full review history: yours, or a contact's (FR-17). */
export const getPersonHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => ({ userId: text(data, "userId", 100) }))
  .handler(async ({ data, context }) => {
    try {
      const { sql, engine } = await deps();
      const r = await engine.personHistory(sql, {
        viewerId: context.userId,
        personId: data.userId,
        limits: CONTACT_LIMITS,
      });
      if (r.outcome !== "ok") return fail("not_contact");
      return { ok: true as const, history: r.history };
    } catch (err) {
      logFailure("history", err);
      return fail("unavailable");
    }
  });
