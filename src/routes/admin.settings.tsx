// Ticket 7 — settings at /admin/settings (BRD v1.6 §20 CFG-01–CFG-13; gap 21).
// Plain, unstyled (STITCH-UI-01). Admin only; every rule is enforced on the server.
//
// * Shows the settings in force, any change waiting out its 24-hour
//   cooling-off, versions rejected when checked, and the toggle log.
// * Edit and save with a reason. Offer settings apply to NEW offers (live
//   offers keep theirs). Global settings wait 24h while any offer is live.
// * Locked settings (guardrails and open decisions) are shown but can't be edited.
// * "Finish earlier disclosures" completes reviews posted before their
//   disclosure could be complete (e.g. before the wording was approved).
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { SettingsAdminView } from "@/lib/config/engine";
import { formatFieldValue, getPath, parseFieldInput, setPath, SETTING_FIELDS, type Field } from "@/lib/config/fields";
import { configMessage, LOG_EVENT_LABELS } from "@/lib/config/messages";
import type { AppConfig } from "@/lib/config/preset";
import { finishDisclosures, getSettingsForAdmin, saveSettings } from "@/lib/config/server-fns";

export const Route = createFileRoute("/admin/settings")({ component: AdminSettings });

const UNAVAILABLE = configMessage("unavailable") ?? "";

function when(isoTime: string | null): string {
  if (!isoTime) return "—";
  const d = new Date(isoTime);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function show(v: string | null): string {
  return v === null ? "—" : v;
}

type State =
  | { kind: "loading" }
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; view: SettingsAdminView };

function AdminSettings() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    const r = await getSettingsForAdmin().catch(() => null);
    if (!r) return setState({ kind: "error", message: UNAVAILABLE });
    if (!r.ok) return setState(r.reason === "not_allowed" ? { kind: "refused", message: r.message } : { kind: "error", message: r.message });
    setState({ kind: "ok", view: r.view });
  }, []);

  useEffect(() => {
    if (!isPending && userId) void load();
  }, [isPending, userId, load]);

  if (isPending || (userId && state.kind === "loading")) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!userId) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p>Please sign in.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: "/admin/settings" }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }
  if (state.kind === "refused" || state.kind === "error") {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
        <p role="alert">{state.message}</p>
      </main>
    );
  }
  if (state.kind !== "ok") return null;
  const { view } = state;

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>
      <p>
        Starting values, not decisions. Offer settings apply to offers made after the change; live offers keep theirs.
        Changes to who sees reviews, the disclosure wording and fraud checks wait 24 hours while any offer is live.
      </p>
      <p className="mt-2">
        In force: {view.effective.source === "builtin" ? "built-in pilot preset (no valid saved settings)" : view.effective.versionId} since{" "}
        {when(view.effective.since)}.
      </p>
      {view.pending ? (
        <p className="mt-2 border p-2">
          A change is waiting: it takes effect {when(view.pending.effectiveAt)} (cooling-off started{" "}
          {when(view.pending.coolingOffStartedAt)}). Reason: {view.pending.reason}
        </p>
      ) : null}
      {view.rejected.length > 0 ? (
        <div role="alert" className="mt-2 border p-2">
          <p className="font-semibold">Saved settings rejected when checked (the last valid ones are used):</p>
          <ul>
            {view.rejected.map((r) => (
              <li key={r.versionId}>
                {when(r.at)} — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FinishDisclosures count={view.incompleteDisclosures} onDone={load} />
      <Editor base={view.effective.config} disabled={Boolean(view.pending)} onSaved={load} />

      <h2 className="mt-8 text-xl font-semibold">Log</h2>
      {view.log.length === 0 ? <p>No entries.</p> : null}
      <ul className="mt-2">
        {view.log.map((l, i) => (
          <li key={`${l.at}-${i}`} className="mt-2 border-b pb-2">
            <p>
              {when(l.at)} · {LOG_EVENT_LABELS[l.event] ?? l.event}
              {l.actorName ? ` · by ${l.actorName}` : ""}
            </p>
            {l.key ? (
              <p>
                {l.key}: {show(l.oldValue)} → {show(l.newValue)}
              </p>
            ) : null}
            {l.event === "disclosures_completed" ? <p>Finished: {show(l.newValue)}</p> : null}
            {l.reason ? <p>Why: {l.reason}</p> : null}
            {l.coolingOffStartedAt ? <p>Cooling-off from {when(l.coolingOffStartedAt)}</p> : null}
            {l.effectiveAt && l.event === "changed" ? <p>Takes effect {when(l.effectiveAt)}</p> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}

function FinishDisclosures({ count, onDone }: { count: number; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (count === 0 && !message) return null;
  async function run() {
    if (busy) return;
    setBusy(true);
    const r = await finishDisclosures().catch(() => null);
    setMessage(!r || !r.ok ? (r?.message ?? UNAVAILABLE) : `Finished ${r.finished} of ${count}. The rest can't be finished yet.`);
    await onDone();
    setBusy(false);
  }
  return (
    <div className="mt-4 border p-2">
      <p>
        {count} posted {count === 1 ? "review has" : "reviews have"} a disclosure that isn't complete, so contacts can't see{" "}
        {count === 1 ? "it" : "them"}. Once the amount is known and the wording is approved, you can finish them. This is logged.
      </p>
      <button type="button" onClick={() => void run()} disabled={busy} className="mt-2 rounded border px-4 py-2">
        {busy ? "Finishing…" : "Finish earlier disclosures"}
      </button>
      {message ? <p role="status" className="mt-2">{message}</p> : null}
    </div>
  );
}

function Editor({ base, disabled, onSaved }: { base: AppConfig; disabled: boolean; onSaved: () => Promise<void> }) {
  const [inputs, setInputs] = useState<Record<string, string | boolean>>(() => initialInputs(base));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => setInputs(initialInputs(base)), [base]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    setMessage(null);
    setErrors([]);
    let next = base;
    const bad: string[] = [];
    for (const f of SETTING_FIELDS) {
      if (f.kind === "locked") continue;
      const v = parseFieldInput(f, inputs[f.path] ?? "");
      if (v === null) bad.push(`${f.label}: please check the value.`);
      else next = setPath(next, f.path, v);
    }
    if (bad.length) {
      setErrors(bad);
      return;
    }
    setBusy(true);
    const r = await saveSettings({ data: { settings: next, reason } }).catch(() => null);
    if (!r) setMessage(UNAVAILABLE);
    else if (!r.ok) {
      setMessage(r.message);
      setErrors(r.errors ?? []);
    } else {
      setReason("");
      setMessage(
        r.coolingOff
          ? `Saved ${r.changed} change(s). An offer is live, so they take effect ${when(r.effectiveAt)}.`
          : `Saved ${r.changed} change(s). In force now; offer settings apply to new offers.`,
      );
      await onSaved();
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6" noValidate>
      <h2 className="text-xl font-semibold">Change settings</h2>
      {disabled ? <p>A change is waiting to take effect, so you can't make another one yet.</p> : null}
      {(["offer", "global"] as const).map((scope) => (
        <fieldset key={scope} className="mt-4 border p-3">
          <legend className="font-semibold">{scope === "offer" ? "Offer settings (apply to new offers)" : "Global settings (24h wait while an offer is live)"}</legend>
          {SETTING_FIELDS.filter((f) => f.scope === scope).map((f) => (
            <FieldInput key={f.path} field={f} base={base} value={inputs[f.path]} onChange={(v) => setInputs((s) => ({ ...s, [f.path]: v }))} />
          ))}
        </fieldset>
      ))}
      <label className="mt-4 block">
        Why are you making this change? (goes in the log)
        <textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full border px-2 py-1" rows={2} />
      </label>
      <button type="submit" disabled={busy || disabled} className="mt-2 rounded border px-4 py-2">
        {busy ? "Saving…" : "Save settings"}
      </button>
      {message ? <p role="status" className="mt-2">{message}</p> : null}
      {errors.length > 0 ? (
        <ul role="alert" className="mt-2 list-disc pl-6">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

function initialInputs(base: AppConfig): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of SETTING_FIELDS) {
    const v = getPath(base, f.path);
    out[f.path] = f.kind === "bool" ? v === true : formatFieldValue(f, v);
  }
  return out;
}

function FieldInput({
  field: f,
  base,
  value,
  onChange,
}: {
  field: Field;
  base: AppConfig;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const help = f.help ? <span className="block text-sm">{f.help}</span> : null;
  if (f.kind === "locked") {
    return (
      <div className="mt-2">
        <span>{f.label}: </span>
        <span className="font-mono">{formatFieldValue(f, getPath(base, f.path))}</span> (locked)
        {help}
      </div>
    );
  }
  if (f.kind === "bool") {
    return (
      <label className="mt-2 block">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {f.label}
        {help}
      </label>
    );
  }
  if (f.kind === "choice") {
    return (
      <label className="mt-2 block">
        {f.label}{" "}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="border px-2 py-1">
          {(f.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {help}
      </label>
    );
  }
  if (f.kind === "lines") {
    return (
      <label className="mt-2 block">
        {f.label}
        <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={5} className="mt-1 block w-full border px-2 py-1" />
        {help}
      </label>
    );
  }
  const prefix = f.kind === "money" ? "$" : "";
  const suffix = f.kind === "percent" ? "%" : (f.unit ?? "");
  return (
    <label className="mt-2 block">
      {f.label}{" "}
      <span className="whitespace-nowrap">
        {prefix}
        <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="w-28 border px-2 py-1" inputMode="decimal" /> {suffix}
      </span>
      {help}
    </label>
  );
}
