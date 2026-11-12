// Ticket 3b-2 — server function behind the dev-only /dev/seed page.
// Refused unless NODE_ENV is "development" or "test" AND the caller is an
// admin (locally: TRUFOLKS_ADMIN_EMAILS_DEV). Server-only modules are imported
// inside the handler so they never reach the browser bundle. Codes are
// returned once and never logged.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const runDevSeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const { devOnlyEnv, findAuthEmail, isAdminCaller } = await import("@/lib/receipt-codes/admin.ts");
      if (!devOnlyEnv(process.env.NODE_ENV)) {
        return { ok: false as const, message: "This page only works on a developer's computer." };
      }
      const { getSql } = await import("@/lib/db");
      const sql = await getSql();
      const admin = await isAdminCaller(context.userId, { lookupEmail: (id) => findAuthEmail(sql, id) });
      if (!admin) return { ok: false as const, message: "This page is for the TruFolks team only." };
      const { getServerHashKeys } = await import("@/lib/receipt-codes/codes.ts");
      const { RECEIPT_CODE_LIMITS } = await import("@/lib/receipt-codes/limits.ts");
      const { seedDevData } = await import("./seed.ts");
      const r = await seedDevData(sql, { keys: getServerHashKeys(), limits: RECEIPT_CODE_LIMITS });
      return { ok: true as const, ...r };
    } catch (err) {
      console.error("[dev-seed] failed:", err instanceof Error ? err.message : "unknown error");
      return { ok: false as const, message: "Couldn't make test data. Check the dev server window." };
    }
  });
