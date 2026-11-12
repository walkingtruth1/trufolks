// Ticket 3b-2 — the scan page at /r/<code> (BRD v1.6 Journey A, FR-07–FR-09,
// FR-08a, HON-07, P5, NFR-06). Plain, unstyled on purpose (STITCH-UI-01).
//
// No amount or formula is shown here (Tickets 7/8). Every rule lives on the
// server; this page only calls the existing server functions and shows their
// plain messages.
//
// Order: signed in → check for the person's own claim FIRST (a claimed code
// scans as "used" and would count as a failed try); otherwise scan the code,
// which also sets the long-lived device cookie.
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { claimReceiptCode, scanReceiptCode } from "@/lib/receipt-codes/server-fns";
import { getMyClaim, uploadReceiptPhoto } from "@/lib/receipt-codes/photo-server-fns";
import { compressReceiptPhoto, receiptPhotoForm } from "@/lib/receipt-codes/compress-photo";
import { codeMessage, photoMessage } from "@/lib/receipt-codes/messages";
import { RECEIPT_PHOTO_LIMITS } from "@/lib/receipt-codes/limits";
import {
  claimView,
  dollarsToCents,
  localDateTimeToIso,
  retentionDays,
  toDateTimeLocalValue,
  type ClaimView,
} from "@/lib/receipt-codes/form-input";

export const Route = createFileRoute("/r/$code")({ component: ScanPage });

type Offer = { merchantName: string; campaignName: string; campaignEndsAt: string };

type Page =
  | { kind: "loading" }
  | { kind: "cant_use"; message: string }
  | {
      kind: "ready";
      offer: Offer | null;
      view: ClaimView | "signed_out";
      purchaseId: string | null;
      /** Why the last photo upload failed, shown on the photo step. */
      photoError?: string | null;
    };

const PHOTO_NOTE = `Only the TruFolks team sees your receipt photo, to check your purchase. It's deleted after ${retentionDays(
  RECEIPT_PHOTO_LIMITS.retentionSeconds,
)} days.`;

function offerText(merchantName: string): string {
  return `${merchantName} pays people back for an honest review of something they just bought. You get the same whether you give 1 star or 5. We check your receipt first, and you'll see exactly what you get back before you write your review.`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function ScanPage() {
  const { code } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    if (isPending) return;
    let alive = true;
    setPage({ kind: "loading" });
    (async () => {
      if (userId) {
        const mine = await getMyClaim({ data: { code } }).catch(() => ({ ok: false as const }));
        if (!alive) return;
        if (mine.ok) {
          setPage({ kind: "ready", offer: null, view: claimView(mine), purchaseId: mine.purchaseId });
          return;
        }
      }
      const scan = await scanReceiptCode({ data: { code } }).catch(() => null);
      if (!alive) return;
      if (!scan) {
        setPage({ kind: "cant_use", message: codeMessage("unavailable") ?? "" });
      } else if (!scan.ok) {
        setPage({ kind: "cant_use", message: scan.message });
      } else {
        const offer = { merchantName: scan.merchantName, campaignName: scan.campaignName, campaignEndsAt: scan.campaignEndsAt };
        setPage({ kind: "ready", offer, view: userId ? "form" : "signed_out", purchaseId: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, isPending, userId]);

  if (page.kind === "loading") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }

  if (page.kind === "cant_use") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">We can't use this code</h1>
        <p role="alert">{page.message}</p>
      </main>
    );
  }

  const here = `/r/${encodeURIComponent(code)}`;
  const toPhoto = (purchaseId: string, photoError: string) => setPage({ ...page, view: "photo", purchaseId, photoError });
  const toChecking = () => setPage({ ...page, view: "checking" });

  return (
    <main className="mx-auto max-w-sm p-6">
      {page.offer ? (
        <>
          <h1 className="mb-4 text-2xl font-semibold">{page.offer.merchantName}</h1>
          <p>Offer: {page.offer.campaignName}</p>
          <p>Offer ends {formatDay(page.offer.campaignEndsAt)}</p>
          <p className="mt-4">{offerText(page.offer.merchantName)}</p>
        </>
      ) : (
        <h1 className="mb-4 text-2xl font-semibold">Your purchase</h1>
      )}

      {page.view === "signed_out" ? (
        <>
          <p className="mt-4">{PHOTO_NOTE}</p>
          <p className="mt-4">To use this code, sign in or create an account on this phone.</p>
          <p className="mt-2 flex gap-4">
            <Link to="/sign-in" search={{ next: here }} className="underline">
              Sign in
            </Link>
            <Link to="/sign-up" search={{ next: here }} className="underline">
              Create account
            </Link>
          </p>
        </>
      ) : null}

      {page.view === "form" ? <ClaimForm code={code} onClaimed={toPhoto} onDone={toChecking} /> : null}

      {page.view === "photo" && page.purchaseId ? (
        <PhotoStep purchaseId={page.purchaseId} initialError={page.photoError ?? null} onDone={toChecking} />
      ) : null}

      {page.view === "checking" ? <p className="mt-4">Thanks — we're checking your receipt.</p> : null}
      {page.view === "confirmed" ? (
        <>
          <p className="mt-4">Your purchase is confirmed.</p>
          {page.purchaseId ? (
            <p className="mt-2">
              <Link to="/review/$purchaseId" params={{ purchaseId: page.purchaseId }} className="underline">
                Write your review
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
      {page.view === "turned_down" ? (
        <p className="mt-4">We couldn't confirm this purchase from the receipt.</p>
      ) : null}
    </main>
  );
}

/** Compress and upload one photo. Returns null on success, or a plain message. */
async function sendPhoto(purchaseId: string, file: File): Promise<string | null> {
  const small = await compressReceiptPhoto(file);
  if (!small.ok) return photoMessage(small.reason);
  try {
    const r = await uploadReceiptPhoto({ data: receiptPhotoForm(purchaseId, small.photo, small.header) });
    return r.ok ? null : r.message;
  } catch {
    return photoMessage("unavailable");
  }
}

function PhotoInput({ onPick }: { onPick: (file: File | null) => void }) {
  return (
    <label className="flex flex-col gap-1">
      Photo of your receipt
      <input
        type="file"
        accept="image/*"
        className="rounded border px-3 py-2"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <span>Make sure the business name, date and total are easy to read.</span>
    </label>
  );
}

function ClaimForm({
  code,
  onClaimed,
  onDone,
}: {
  code: string;
  onClaimed: (purchaseId: string, photoError: string) => void;
  onDone: () => void;
}) {
  const [productLabel, setProductLabel] = useState("");
  const [cost, setCost] = useState("");
  const [when, setWhen] = useState(() => toDateTimeLocalValue(new Date()));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    const orderValueCents = dollarsToCents(cost);
    const purchasedAt = localDateTimeToIso(when);
    if (!productLabel.trim() || !purchasedAt) return setError(codeMessage("invalid_details"));
    if (orderValueCents === null) return setError("Please enter what it cost, like 12.50.");
    if (!file) return setError("Please add a photo of your receipt.");
    setSubmitting(true);
    try {
      const claim = await claimReceiptCode({
        data: { code, productLabel: productLabel.trim(), orderValueCents, purchasedAt },
      }).catch(() => null);
      if (!claim) return setError(codeMessage("unavailable"));
      if (!claim.ok) return setError(claim.message);
      const photoError = await sendPhoto(claim.purchaseId, file);
      if (photoError) {
        // The claim is saved; only the photo needs another go.
        onClaimed(claim.purchaseId, photoError);
        return;
      }
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-3">
      <p>{PHOTO_NOTE}</p>
      <label className="flex flex-col gap-1">
        What did you buy?
        <input
          className="rounded border px-3 py-2"
          value={productLabel}
          maxLength={200}
          onChange={(e) => setProductLabel(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        What did it cost? (in dollars, like 12.50)
        <input
          className="rounded border px-3 py-2"
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        When did you buy it?
        <input
          className="rounded border px-3 py-2"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </label>
      <PhotoInput onPick={setFile} />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting} className="rounded border px-4 py-2">
        {submitting ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

function PhotoStep({
  purchaseId,
  initialError,
  onDone,
}: {
  purchaseId: string;
  initialError: string | null;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!file) return setError("Please add a photo of your receipt.");
    setSubmitting(true);
    try {
      const photoError = await sendPhoto(purchaseId, file);
      if (photoError) return setError(photoError);
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-3">
      <p>Your purchase is saved. We still need a photo of your receipt.</p>
      <p>{PHOTO_NOTE}</p>
      <PhotoInput onPick={setFile} />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting} className="rounded border px-4 py-2">
        {submitting ? "Sending…" : error ? "Try again" : "Send photo"}
      </button>
    </form>
  );
}
