// Ticket 7 — server-only: the database plus checked settings, for server
// functions. On first use in each process (and again every minute) it runs
// startup validation (CFG-01): invalid stored versions are rejected and logged,
// and the last valid one is used. It never throws because of settings: if the
// check itself fails, the built-in pilot preset is used and the error is logged.
import type { Sql } from "@/lib/db";
import type { LoadedConfig } from "./engine.ts";
import { PILOT_PRESET } from "./preset.ts";

const RECHECK_MS = 60_000;

const g = globalThis as typeof globalThis & {
  __trufolksConfig__?: { at: number; loaded: Promise<LoadedConfig> };
};

export async function getConfiguredSql(): Promise<{ sql: Sql; loaded: LoadedConfig }> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const now = Date.now();
  if (!g.__trufolksConfig__ || now - g.__trufolksConfig__.at > RECHECK_MS) {
    g.__trufolksConfig__ = {
      at: now,
      loaded: (async () => {
        try {
          const engine = await import("./engine.ts");
          const rejected = await engine.checkStoredConfig(sql);
          if (rejected.length > 0) console.error(`[config] rejected ${rejected.length} invalid settings version(s); using the last valid one`);
          return await engine.loadEffectiveConfig(sql);
        } catch (err) {
          console.error("[config] check failed; using the built-in pilot preset:", err instanceof Error ? err.message : "unknown error");
          g.__trufolksConfig__ = undefined;
          return { versionId: null, config: PILOT_PRESET, source: "builtin" as const };
        }
      })(),
    };
  }
  return { sql, loaded: await g.__trufolksConfig__.loaded };
}

/** Forget the cached settings (after an admin saves new ones). */
export function invalidateConfigCache(): void {
  g.__trufolksConfig__ = undefined;
}
