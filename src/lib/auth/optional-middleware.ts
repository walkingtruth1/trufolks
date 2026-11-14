import { createMiddleware } from "@tanstack/react-start";

/**
 * Like `authMiddleware`, but a signed-out visitor is allowed through with
 * `userId: null`. Use it ONLY for reads that have a public answer (an opted-in
 * profile, review or product page) and pass `context.userId` to the engine,
 * which applies the visibility rule (migration 0011). Never use it for writes.
 *
 * A cross-site request is treated as signed out, so another site can't read a
 * friend's view with the visitor's cookie.
 */
export const optionalAuthMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { getSessionUser } = await import("./verify.server");
    // The answer depends on who is asking: never let a shared cache keep it.
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader("Cache-Control", "private, no-store");
    setResponseHeader("Vary", "Cookie, Authorization");
    let userId: string | null = null;
    try {
      assertSameSiteRequest();
      const user = await getSessionUser(context.bearerToken);
      userId = user?.id ?? null;
    } catch {
      userId = null;
    }
    return next({ context: { userId } });
  });
