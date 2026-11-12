// Ticket 6 — concierge set-up at /admin/merchants (BRD v1.6 MER-01, PILOT-01).
// Replaces the dev-only /dev/seed. Plain, unstyled (STITCH-UI-01).
//
// The TruFolks team, after checking a business in person, adds it for the
// owner's existing account (by login email) and creates its offer. The offer
// type and the most days it can run come from settings (CFG-05, CFG-04). The OWNER then accepts the statements and
// makes codes on /merchant — the team can't do that for them (MER-02, MER-07).
// Every rule is enforced on the server; every step is logged.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { AdminBusiness } from "@/lib/merchants/engine";
import { merchantMessage } from "@/lib/merchants/messages";
import { createBusinessForAdmin, createOfferForAdmin, listBusinessesForAdmin } from "@/lib/merchants/server-fns";
import { localDateTimeToIso, toDateTimeLocalValue } from "@/lib/receipt-codes/form-input";

export const Route = createFileRoute("/admin/merchants")({ component: AdminMerchants });

const UNAVAILABLE = merchantMessage("unavailable") ?? "";

function longDate(isoTime: string): string {
  const d = new Date(isoTime);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

type List =
  | { kind: "loading" }
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; businesses: AdminBusiness[] };

function AdminMerchants() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [list, setList] = useState<List>({ kind: "loading" });

  const load = useCallback(async () => {
    const r = await listBusinessesForAdmin().catch(() => null);
    if (!r) return setList({ kind: "error", message: UNAVAILABLE });
    if (!r.ok) return setList(r.reason === "not_allowed" ? { kind: "refused", message: r.message } : { kind: "error", message: r.message });
    setList({ kind: "ok", businesses: r.businesses });
  }, []);

  useEffect(() => {
    if (!isPending && userId) void load();
  }, [isPending, userId, load]);

  if (isPending || (userId && list.kind === "loading")) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!userId) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p>Please sign in.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: "/admin/merchants" }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }
  if (list.kind === "refused" || list.kind === "error") {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-2xl font-semibold">Businesses</h1>
        <p role="alert">{list.message}</p>
      </main>
    );
  }
  if (list.kind !== "ok") return null;

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Businesses</h1>
      <p>
        Add a business only after checking it in person (receipt sample, till, address, business details). The owner
        must already have a TruFolks account. They accept the terms and make codes themselves on their business page.
      </p>
      <AddBusiness onDone={load} />
      {list.businesses.length === 0 ? <p className="mt-6">No businesses yet.</p> : null}
      {list.businesses.map((b) => (
        <section key={b.merchantId} className="mt-6 border-t pt-4">
          <h2 className="text-xl font-semibold">{b.name}</h2>
          <p>
            Owner: {b.ownerName} ({b.ownerEmail ?? "no login email"})
            {b.businessType ? ` · ${b.businessType}` : ""}
          </p>
          <p>
            Walkthrough: {b.walkthroughAccepted ? "accepted" : "not yet"} · Terms: {b.termsAccepted ? "accepted" : "not yet"}
          </p>
          <h3 className="mt-2 font-semibold">Offers</h3>
          {b.offers.length === 0 ? <p>None yet.</p> : null}
          <ul>
            {b.offers.map((o) => (
              <li key={o.campaignId}>
                {o.name} — {longDate(o.startsAt)} to {longDate(o.endsAt)} ({o.status})
              </li>
            ))}
          </ul>
          <AddOffer merchantId={b.merchantId} onDone={load} />
        </section>
      ))}
    </main>
  );
}

function AddBusiness({ onDone }: { onDone: () => Promise<void> }) {
  const [ownerEmail, setOwnerEmail] = useState("");
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await createBusinessForAdmin({ data: { ownerEmail, name, businessType } }).catch(() => null);
    if (!r || !r.ok) setMessage(r?.message ?? UNAVAILABLE);
    else {
      setOwnerEmail("");
      setName("");
      setBusinessType("");
      setMessage("Business added. Now add its offer.");
      await onDone();
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 border p-4" noValidate>
      <h2 className="font-semibold">Add a business</h2>
      <label className="mt-2 block">
        Owner's login email
        <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className="mt-1 block w-full border px-2 py-1" />
      </label>
      <label className="mt-2 block">
        Business name
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full border px-2 py-1" />
      </label>
      <label className="mt-2 block">
        Type of business (optional)
        <input
          value={businessType}
          maxLength={80}
          onChange={(e) => setBusinessType(e.target.value)}
          className="mt-1 block w-full border px-2 py-1"
        />
      </label>
      <button type="submit" disabled={busy} className="mt-4 rounded border px-4 py-2">
        {busy ? "Adding…" : "Add business"}
      </button>
      {message ? <p role="status" className="mt-2">{message}</p> : null}
    </form>
  );
}

function AddOffer({ merchantId, onDone }: { merchantId: string; onDone: () => Promise<void> }) {
  const [name, setName] = useState("Pilot");
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocalValue(new Date()));
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocalValue(new Date(Date.now() + 14 * 86400_000)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const s = localDateTimeToIso(startsAt);
    const e = localDateTimeToIso(endsAt);
    if (!s || !e) {
      setMessage(merchantMessage("invalid"));
      return;
    }
    setBusy(true);
    setMessage(null);
    const r = await createOfferForAdmin({ data: { merchantId, name, startsAt: s, endsAt: e } }).catch(() => null);
    if (!r || !r.ok) setMessage(r?.message ?? UNAVAILABLE);
    else {
      setMessage("Offer added. It's live now.");
      await onDone();
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-2" noValidate>
      <h3 className="font-semibold">Add an offer</h3>
      <p>New-purchase offers only during the pilot.</p>
      <label className="mt-1 block">
        Name
        <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full border px-2 py-1" />
      </label>
      <label className="mt-1 block">
        Starts
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-1 block border px-2 py-1" />
      </label>
      <label className="mt-1 block">
        Ends
        <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="mt-1 block border px-2 py-1" />
      </label>
      <button type="submit" disabled={busy} className="mt-2 rounded border px-4 py-2">
        {busy ? "Adding…" : "Add offer"}
      </button>
      {message ? <p role="status" className="mt-2">{message}</p> : null}
    </form>
  );
}
