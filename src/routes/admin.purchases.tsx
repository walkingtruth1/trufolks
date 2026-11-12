// Ticket 3b-2 — admin review page at /admin/purchases (BRD v1.6 FR-08a, FR-09,
// RES-01, AI-06). Plain, unstyled on purpose (STITCH-UI-01).
//
// A person on the admin allowlist looks at each pending purchase and its
// receipt photo, then approves it (with the amount read off the receipt) or
// turns it down (with a reason). Flags are hints only; they never decide
// anything. Every rule is enforced on the server.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  decidePurchaseForReview,
  getReceiptPhotoForReview,
  listPendingPurchasesForReview,
} from "@/lib/receipt-codes/photo-server-fns";
import { decideMessage } from "@/lib/receipt-codes/messages";
import { dollarsToCents, formatCents } from "@/lib/receipt-codes/form-input";

export const Route = createFileRoute("/admin/purchases")({ component: AdminPurchases });

const HERE = "/admin/purchases";

type Pending = {
  purchaseId: string;
  merchantName: string;
  campaignName: string | null;
  productLabel: string;
  typedOrderValueCents: number;
  currency: string;
  purchasedAt: string;
  claimedAt: string | null;
  hasPhoto: boolean;
  exifTakenAt: string | null;
  checks: { code: string; label: string }[];
};

type List =
  | { kind: "loading" }
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; purchases: Pending[] };

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function AdminPurchases() {
  const { user, isPending } = useCurrentUserState();
  const [list, setList] = useState<List>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setList({ kind: "loading" });
    const r = await listPendingPurchasesForReview().catch(() => null);
    if (!r) return setList({ kind: "error", message: decideMessage("unavailable") ?? "" });
    if (!r.ok) {
      return setList(r.reason === "not_allowed" ? { kind: "refused", message: r.message } : { kind: "error", message: r.message });
    }
    setList({ kind: "ok", purchases: r.purchases });
  }, []);

  useEffect(() => {
    if (!isPending && user) void load();
  }, [isPending, user, load]);

  if (isPending) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p>{decideMessage("not_allowed")}</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: HERE }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      {list.kind === "refused" ? (
        <p role="alert">{list.message}</p>
      ) : (
        <>
          <h1 className="mb-4 text-2xl font-semibold">Purchases to check</h1>
          {notice ? <p role="status">{notice}</p> : null}
          {list.kind === "loading" ? <p>Loading…</p> : null}
          {list.kind === "error" ? (
            <>
              <p role="alert">{list.message}</p>
              <button type="button" onClick={() => void load()} className="mt-2 rounded border px-4 py-2">
                Try again
              </button>
            </>
          ) : null}
          {list.kind === "ok" && list.purchases.length === 0 ? <p>No purchases waiting to be checked.</p> : null}
          {list.kind === "ok"
            ? list.purchases.map((p) => (
                <PurchaseCard
                  key={p.purchaseId}
                  purchase={p}
                  onDecided={(text) => {
                    setNotice(text);
                    void load();
                  }}
                />
              ))
            : null}
        </>
      )}
    </main>
  );
}

function PurchaseCard({ purchase: p, onDecided }: { purchase: Pending; onDecided: (notice: string) => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function showPhoto() {
    setError(null);
    const r = await getReceiptPhotoForReview({ data: { purchaseId: p.purchaseId } }).catch(() => null);
    if (!r) return setError(decideMessage("unavailable"));
    if (!r.ok) return setError(r.message);
    setPhotoUrl(r.url);
  }

  async function decide(decision: "verified" | "rejected", confirmedOrderValueCents: number | null, why: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await decidePurchaseForReview({
        data: { purchaseId: p.purchaseId, decision, reason: why, confirmedOrderValueCents },
      }).catch(() => null);
      if (!r) return setError(decideMessage("unavailable"));
      if (!r.ok) return setError(r.message);
      onDecided(decision === "verified" ? "Approved." : "Turned down.");
    } finally {
      setBusy(false);
    }
  }

  function onApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const cents = dollarsToCents(amount);
    if (cents === null) return setError(decideMessage("bad_value"));
    void decide("verified", cents, "");
  }

  function onTurnDown(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!reason.trim()) return setError(decideMessage("reason_required"));
    void decide("rejected", null, reason.trim());
  }

  return (
    <section className="mt-6 border-t pt-4">
      <h2 className="text-lg font-semibold">{p.merchantName}</h2>
      <p>Offer: {p.campaignName ?? "—"}</p>
      <p>What they bought: {p.productLabel}</p>
      <p>Amount they typed: {formatCents(p.typedOrderValueCents, p.currency)}</p>
      <p>Bought at: {when(p.purchasedAt)}</p>
      <p>Claimed at: {when(p.claimedAt)}</p>
      <p>Photo taken at: {p.hasPhoto ? (p.exifTakenAt ? when(p.exifTakenAt) : "No date on the photo") : "No photo yet"}</p>
      {p.checks.length > 0 ? (
        <>
          <p className="mt-2">Things to check:</p>
          <ul className="list-disc pl-6">
            {p.checks.map((c) => (
              <li key={c.code}>{c.label}</li>
            ))}
          </ul>
        </>
      ) : null}

      {p.hasPhoto ? (
        photoUrl ? (
          <img src={photoUrl} alt="Receipt photo" className="mt-2 max-w-full border" />
        ) : (
          <button type="button" onClick={() => void showPhoto()} className="mt-2 rounded border px-4 py-2">
            Show photo
          </button>
        )
      ) : null}

      <form onSubmit={onApprove} noValidate className="mt-4 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          Amount on the receipt (in dollars)
          <input
            className="rounded border px-3 py-2"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy} className="rounded border px-4 py-2">
          Approve
        </button>
      </form>

      <form onSubmit={onTurnDown} noValidate className="mt-4 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          Reason for turning this down
          <input
            className="rounded border px-3 py-2"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy} className="rounded border px-4 py-2">
          Turn down
        </button>
      </form>

      {error ? <p role="alert" className="mt-2">{error}</p> : null}
    </section>
  );
}
