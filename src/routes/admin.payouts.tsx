// Ticket 8 — payouts and deposits at /admin/payouts (BRD v1.6 FR-22, HON-09,
// MER-06, RES-01(c), D6). Plain, unstyled (STITCH-UI-01). Admin only; every
// rule is enforced on the server and every action is logged with a reason.
//
// * Deposits: record money the business paid in for an offer (MER-06). No
//   codes can be made before there's a deposit.
// * Payouts: due ones are released when this page loads. Flag (hold) / clear,
//   forfeit (returned in the window, or a proven breach after a flag), mark
//   paid (how, and a reference). Paying itself happens outside TruFolks during
//   the concierge pilot (D6 is open). Reviews are never hidden or changed here.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { AdminOffer, AdminPayout } from "@/lib/payouts/engine";
import { payoutMessage, payoutStatusText } from "@/lib/payouts/messages";
import { actOnPayoutForAdmin, getPayoutsForAdmin, recordDepositForAdmin } from "@/lib/payouts/server-fns";
import { dollarsToCents, formatCents } from "@/lib/receipt-codes/form-input";
import { percentText } from "@/lib/config/preset";

export const Route = createFileRoute("/admin/payouts")({ component: AdminPayouts });

const UNAVAILABLE = payoutMessage("unavailable") ?? "";

function when(isoTime: string | null): string {
  if (!isoTime) return "—";
  const d = new Date(isoTime);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

type State =
  | { kind: "loading" }
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; payouts: AdminPayout[]; offers: AdminOffer[] };

function AdminPayouts() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getPayoutsForAdmin().catch(() => null);
    if (!r) return setState({ kind: "error", message: UNAVAILABLE });
    if (!r.ok) return setState(r.reason === "not_allowed" ? { kind: "refused", message: r.message } : { kind: "error", message: r.message });
    setState({ kind: "ok", payouts: r.payouts, offers: r.offers });
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
          <Link to="/sign-in" search={{ next: "/admin/payouts" }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }
  if (state.kind === "refused" || state.kind === "error") {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-2xl font-semibold">Payouts</h1>
        <p role="alert">{state.message}</p>
      </main>
    );
  }
  if (state.kind !== "ok") return null;

  const done = async (msg: string | null) => {
    setNotice(msg);
    await load();
  };

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Payouts</h1>
      <p>
        Payouts are the same for every rating. They're held for the return window, then released here. You pay people by
        hand during the pilot and record it. A review is never hidden or changed from this page.
      </p>
      {notice ? <p role="status" className="mt-2">{notice}</p> : null}

      <h2 className="mt-6 text-xl font-semibold">Offers and deposits</h2>
      {state.offers.length === 0 ? <p>No offers yet.</p> : null}
      {state.offers.map((o) => (
        <section key={o.campaignId} className="mt-4 border p-3">
          <p className="font-semibold">
            {o.merchantName} — {o.name} ({o.status}, ends {when(o.endsAt)})
          </p>
          <p>
            Deposited {formatCents(o.depositedCents)} of at most {o.poolSettingCents === null ? "—" : formatCents(o.poolSettingCents)}. Owed and
            pending: {formatCents(o.committedCents)}. Claims: {o.claims}
            {o.maxReviews === null ? "" : ` of ${o.maxReviews}`}.
          </p>
          {o.deposits.length > 0 ? (
            <ul className="mt-1">
              {o.deposits.map((d, i) => (
                <li key={`${d.at}-${i}`}>
                  {when(d.at)} · {formatCents(d.amountCents)} · {d.note} · by {d.byName}
                </li>
              ))}
            </ul>
          ) : null}
          <DepositForm campaignId={o.campaignId} onDone={done} />
        </section>
      ))}

      <h2 className="mt-8 text-xl font-semibold">Payouts</h2>
      {state.payouts.length === 0 ? <p>No payouts yet.</p> : null}
      {state.payouts.map((p) => (
        <section key={p.payoutId} className="mt-4 border p-3">
          <p className="font-semibold">
            {p.personName} ({p.personEmail ?? "no email"}) — {p.merchantName}, {p.productLabel}
          </p>
          <p>
            Receipt {formatCents(p.orderValueCents, p.currency)} × {percentText(p.formula.percentBp)} (at least{" "}
            {formatCents(p.formula.floorCents, p.currency)}, at most {formatCents(p.formula.capCents, p.currency)}) ={" "}
            {formatCents(p.amountCents, p.currency)}
          </p>
          <p>{payoutStatusText(p)}</p>
          {p.flagReason ? <p>Flag: {p.flagReason}</p> : null}
          {p.forfeitReason ? <p>Forfeit reason: {p.forfeitReason}</p> : null}
          {p.paidReference ? <p>Paid reference: {p.paidReference}</p> : null}
          <Actions payout={p} onDone={done} />
        </section>
      ))}
    </main>
  );
}

function DepositForm({ campaignId, onDone }: { campaignId: string; onDone: (msg: string | null) => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const cents = dollarsToCents(amount);
    if (cents === null || cents <= 0) {
      setError("Please type the amount received, e.g. 250.00.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await recordDepositForAdmin({ data: { campaignId, amountCents: cents, note } }).catch(() => null);
    if (!r || !r.ok) setError(r?.message ?? UNAVAILABLE);
    else {
      setAmount("");
      setNote("");
      await onDone(`Deposit of ${formatCents(cents)} recorded.`);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-2" noValidate>
      <label className="block">
        Deposit received ($)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="ml-2 w-28 border px-2 py-1" />
      </label>
      <label className="mt-1 block">
        How it was received (for the log)
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-full border px-2 py-1" />
      </label>
      <button type="submit" disabled={busy} className="mt-2 rounded border px-4 py-2">
        {busy ? "Saving…" : "Record deposit"}
      </button>
      {error ? <p role="alert" className="mt-1">{error}</p> : null}
    </form>
  );
}

type Kind = "flag" | "clear_flag" | "forfeit_returned" | "forfeit_breach" | "paid";

function Actions({ payout: p, onDone }: { payout: AdminPayout; onDone: (msg: string | null) => Promise<void> }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: { kind: Kind; label: string }[] = [];
  if (p.status === "held" && !p.flagged) options.push({ kind: "flag", label: "Put on hold (flag)" });
  if (p.status === "released") options.push({ kind: "flag", label: "Put on hold (flag)" }, { kind: "paid", label: "Mark paid" });
  if (p.status === "held" && p.flagged) options.push({ kind: "clear_flag", label: "Clear flag" }, { kind: "forfeit_breach", label: "Forfeit: proven breach" });
  if (p.status === "held" && new Date(p.holdUntil).getTime() > Date.now()) options.push({ kind: "forfeit_returned", label: "Forfeit: returned" });
  if (options.length === 0) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !kind) return;
    setBusy(true);
    setError(null);
    const data =
      kind === "paid"
        ? { payoutId: p.payoutId, kind: "paid", method: reason, reference }
        : kind === "forfeit_returned" || kind === "forfeit_breach"
          ? { payoutId: p.payoutId, kind: "forfeit", forfeitKind: kind === "forfeit_returned" ? "returned" : "policy_breach", reason }
          : { payoutId: p.payoutId, kind, reason };
    const r = await actOnPayoutForAdmin({ data }).catch(() => null);
    if (!r || !r.ok) {
      setError(r?.message ?? UNAVAILABLE);
      if (r && !r.ok && r.reason === "wrong_status") await onDone(null);
    } else {
      setKind(null);
      setReason("");
      setReference("");
      await onDone("Done. It's in the log.");
    }
    setBusy(false);
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.kind} type="button" onClick={() => setKind(o.kind)} className="rounded border px-2">
            {o.label}
          </button>
        ))}
      </div>
      {kind ? (
        <form onSubmit={onSubmit} className="mt-2" noValidate>
          <label className="block">
            {kind === "paid" ? "How it was paid (e.g. store credit, cash)" : "Reason (for the log)"}
            <input value={reason} maxLength={kind === "paid" ? 200 : 1000} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full border px-2 py-1" />
          </label>
          {kind === "paid" ? (
            <label className="mt-1 block">
              Reference (optional)
              <input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} className="mt-1 block w-full border px-2 py-1" />
            </label>
          ) : null}
          <button type="submit" disabled={busy} className="mt-2 rounded border px-4 py-2">
            {busy ? "Saving…" : "Confirm"}
          </button>
          <button type="button" onClick={() => setKind(null)} className="ml-2 mt-2 rounded border px-4 py-2">
            Cancel
          </button>
          {error ? <p role="alert" className="mt-1">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
