// Ticket 7 — settings engine (BRD v1.6 CFG-01, CFG-02, CFG-12, CFG-13).
// Server-only. Takes an Sql argument so tests run it on PGlite.
//
// Startup validation (CFG-01): `checkStoredConfig` validates every stored
// version that is (or will be) in force. One that no longer validates is
// marked rejected and logged, so the database falls back to the last valid
// version. If no stored version is valid, the built-in pilot preset is used.
// Nothing here ever throws the app over: callers get a usable config.
import type { Sql } from "../db.ts";
import { RECEIPT_CODE_LIMITS, type ReceiptCodeLimits } from "../receipt-codes/limits.ts";
import { PILOT_PRESET, type AppConfig } from "./preset.ts";
import { diffConfig, validateConfig, type ConfigChange } from "./validate.ts";

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface LoadedConfig {
  versionId: string | null;
  config: AppConfig;
  /** "builtin" = no valid stored version; the pilot preset from code is in use. */
  source: "db" | "builtin";
}

/** Validate stored versions in force or pending; reject (and log) any that fail. Returns the rejected ids. */
export async function checkStoredConfig(sql: Sql): Promise<string[]> {
  const rows = await sql.query<{ id: string; settings: unknown }>(
    `select id, settings from config_versions where status = 'accepted' order by effective_at desc, created_at desc`,
  );
  const rejected: string[] = [];
  for (const r of rows) {
    const v = validateConfig(r.settings);
    if (!v.ok) {
      const why = `${v.guardrail ? "Tries to override a guardrail. " : ""}${v.errors.join(" ")}`.slice(0, 2000);
      const res = await sql.query<{ r: string }>(`select trufolks_reject_config_version($1, $2) as r`, [r.id, why]);
      if (res[0]?.r === "ok") rejected.push(r.id);
    }
  }
  return rejected;
}

/** The settings in force now (global). */
export async function loadEffectiveConfig(sql: Sql): Promise<LoadedConfig> {
  const rows = await sql.query<{ version_id: string; settings: unknown }>(`select * from trufolks_effective_config()`);
  const v = rows[0] ? validateConfig(rows[0].settings) : null;
  if (rows[0] && v?.ok) return { versionId: rows[0].version_id, config: v.value, source: "db" };
  return { versionId: null, config: PILOT_PRESET, source: "builtin" };
}

/** The settings an offer is pinned to (with the same fallback). */
export async function loadCampaignConfig(sql: Sql, campaignId: string): Promise<LoadedConfig> {
  const rows = await sql.query<{ version_id: string; settings: unknown }>(`select * from trufolks_campaign_config($1)`, [campaignId]);
  const v = rows[0] ? validateConfig(rows[0].settings) : null;
  if (rows[0] && v?.ok) return { versionId: rows[0].version_id, config: v.value, source: "db" };
  return { versionId: null, config: PILOT_PRESET, source: "builtin" };
}

/** Receipt-code limits with the fraud-check settings applied (CFG-11). */
export function codeLimitsFrom(config: AppConfig): ReceiptCodeLimits {
  const f = config.fraud;
  return {
    ...RECEIPT_CODE_LIMITS,
    codeLifetimeSeconds: f.code_lifetime_seconds,
    failureWindowSeconds: f.failure_window_seconds,
    maxFailuresPerDevice: f.max_failures_per_device,
    maxFailuresPerIp: f.max_failures_per_ip,
    newDeviceWindowSeconds: f.new_device_window_seconds,
    maxNewDevicesPerIp: f.max_new_devices_per_ip,
    purchaseClockSkewSeconds: f.purchase_clock_skew_seconds,
  };
}

export type SaveResult =
  | { outcome: "ok"; versionId: string; effectiveAt: string; coolingOff: boolean; changes: ConfigChange[] }
  | { outcome: "invalid"; errors: string[]; guardrail: boolean }
  | { outcome: "reason_missing" | "pending_exists" | "no_change" };

/** Save new settings: validated first; a refusal is logged too (CFG-01). */
export async function saveConfig(sql: Sql, input: { actorId: string; settings: unknown; reason: string }): Promise<SaveResult> {
  const reason = (input.reason ?? "").trim();
  if (!reason) return { outcome: "reason_missing" };
  const v = validateConfig(input.settings);
  if (!v.ok) {
    let attempt: string;
    try {
      attempt = JSON.stringify(input.settings ?? null).slice(0, 20000);
    } catch {
      attempt = "null";
    }
    await sql.query(`select trufolks_log_config_refusal($1, $2::jsonb, $3)`, [
      input.actorId,
      attempt,
      `${v.guardrail ? "Guardrail: " : ""}${v.errors.join(" ")} Reason given: ${reason}`.slice(0, 4000),
    ]);
    return { outcome: "invalid", errors: v.errors, guardrail: v.guardrail };
  }
  const current = await loadEffectiveConfig(sql);
  const changes = diffConfig(current.config, v.value);
  if (changes.length === 0) return { outcome: "no_change" };
  const rows = await sql.query<{ r_outcome: string; r_version_id: string | null; r_effective_at: unknown; r_cooling_off: boolean }>(
    `select * from trufolks_create_config_version($1, $2::jsonb, $3, $4::jsonb)`,
    [input.actorId, JSON.stringify(v.value), reason, JSON.stringify(changes)],
  );
  const r = rows[0];
  if (r?.r_outcome === "ok" && r.r_version_id) {
    return { outcome: "ok", versionId: r.r_version_id, effectiveAt: iso(r.r_effective_at) ?? "", coolingOff: r.r_cooling_off, changes };
  }
  return { outcome: r?.r_outcome === "pending_exists" ? "pending_exists" : "no_change" };
}

export interface LogEntry {
  at: string;
  event: string;
  key: string | null;
  /** JSON text of the old / new value (so it can travel to the page as-is). */
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  actorName: string | null;
  versionId: string | null;
  coolingOffStartedAt: string | null;
  effectiveAt: string | null;
}

export interface SettingsAdminView {
  effective: LoadedConfig & { since: string | null };
  pending: { versionId: string; effectiveAt: string; coolingOffStartedAt: string | null; reason: string } | null;
  rejected: { versionId: string; at: string; reason: string }[];
  log: LogEntry[];
  /** Posted reviews whose disclosure isn't complete yet (gap 21). */
  incompleteDisclosures: number;
}

export async function getSettingsAdminView(sql: Sql): Promise<SettingsAdminView> {
  const effective = await loadEffectiveConfig(sql);
  const since = effective.versionId
    ? (await sql.query<{ effective_at: unknown }>(`select effective_at from config_versions where id = $1`, [effective.versionId]))[0]
        ?.effective_at
    : null;
  const pendingRows = await sql.query<{
    id: string;
    effective_at: unknown;
    cooling_off_started_at: unknown;
    reason: string;
  }>(
    `select id, effective_at, cooling_off_started_at, reason from config_versions
      where status = 'accepted' and effective_at > now() order by effective_at desc limit 1`,
  );
  const rejected = await sql.query<{ id: string; rejected_at: unknown; rejected_reason: string | null }>(
    `select id, rejected_at, rejected_reason from config_versions where status = 'rejected' order by rejected_at desc limit 20`,
  );
  const log = await sql.query<{
    at: unknown;
    event: string;
    setting_key: string | null;
    old_value: unknown;
    new_value: unknown;
    reason: string | null;
    actor_name: string | null;
    version_id: string | null;
    cooling_off_started_at: unknown;
    effective_at: unknown;
  }>(
    `select l.at, l.event, l.setting_key, l.old_value, l.new_value, l.reason, u.display_name as actor_name,
            l.version_id, l.cooling_off_started_at, l.effective_at
       from config_log l left join users u on u.id = l.actor_user_id
      order by l.at desc, l.id desc limit 100`,
  );
  const incomplete = await sql.query<{ n: number }>(
    `select count(*)::int as n from reviews where coalesce(disclosure ->> 'complete', 'false') = 'false'`,
  );
  const p = pendingRows[0];
  return {
    effective: { ...effective, since: iso(since) },
    pending: p
      ? {
          versionId: p.id,
          effectiveAt: iso(p.effective_at) ?? "",
          coolingOffStartedAt: iso(p.cooling_off_started_at),
          reason: p.reason,
        }
      : null,
    rejected: rejected.map((r) => ({ versionId: r.id, at: iso(r.rejected_at) ?? "", reason: r.rejected_reason ?? "" })),
    log: log.map((l) => ({
      at: iso(l.at) ?? "",
      event: l.event,
      key: l.setting_key,
      oldValue: l.old_value === null || l.old_value === undefined ? null : JSON.stringify(l.old_value),
      newValue: l.new_value === null || l.new_value === undefined ? null : JSON.stringify(l.new_value),
      reason: l.reason,
      actorName: l.actor_name,
      versionId: l.version_id,
      coolingOffStartedAt: iso(l.cooling_off_started_at),
      effectiveAt: iso(l.effective_at),
    })),
    incompleteDisclosures: Number(incomplete[0]?.n ?? 0),
  };
}

/** Finish every earlier review whose disclosure can be completed now (gap 21). Logged. */
export async function finishPendingDisclosures(sql: Sql, input: { actorId: string }): Promise<number> {
  const rows = await sql.query<{ n: number }>(`select trufolks_complete_pending_disclosures($1) as n`, [input.actorId]);
  return Number(rows[0]?.n ?? 0);
}

export interface OfferRoom {
  claims: number;
  maxReviews: number;
  committedCents: number;
  poolCents: number;
}

/** How much of an offer's cap is used (CFG-04). Claims not turned down; owed + pending rewards. */
export async function offerRoom(sql: Sql, campaignId: string): Promise<OfferRoom | null> {
  const rows = await sql.query<{ r_claims: number; r_max_reviews: number | null; r_committed_cents: number; r_pool_cents: number | null }>(
    `select * from trufolks_campaign_room($1, 0)`,
    [campaignId],
  );
  const r = rows[0];
  if (!r || r.r_max_reviews === null || r.r_pool_cents === null) return null;
  return { claims: Number(r.r_claims), maxReviews: Number(r.r_max_reviews), committedCents: Number(r.r_committed_cents), poolCents: Number(r.r_pool_cents) };
}
