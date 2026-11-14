// Ticket 3b-2 — the scan page at /r/<code> (BRD v1.6 Journey A, FR-07–FR-09,
// FR-08a, HON-07, P5, NFR-06; APP-17-01). Layout ported from the Stitch Claim
// Receipt pair (visual reference only, UI-17-01): offer card, then the claim
// card. Prototype state switchers, claim IDs, an estimated reward before the
// receipt is checked, one-time-code sign-in and simulated checks are not used.
//
// Ticket 7: the offer's PAY-08 formula is shown before buying (Type A: the
// buyer knows the reward first). The exact amount needs the receipt, so it is
// shown on the review page once the purchase is confirmed. Every rule lives on
// the server; this page only calls the server functions and shows their plain
// messages.
//
// Order: signed in → check for the person's own claim FIRST (a claimed code
// scans as "used" and would count as a failed try); otherwise scan the code,
// which also sets the long-lived device cookie.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Percent, ShieldCheck, Store } from "lucide-react";
import {
  Alert,
  AppPage,
  btnPrimary,
  btnSecondary,
  btnSubmit,
  Card,
  Chip,
  inputClass,
  labelClass,
  Loading,
  Note,
  PageTitle,
  StatusBadge,
} from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { claimReceiptCode, scanReceiptCode } from "@/lib/receipt-codes/server-fns";
import { getMyClaim, uploadReceiptPhoto } from "@/lib/receipt-codes/photo-server-fns";
import { compressReceiptPhoto, receiptPhotoForm } from "@/lib/receipt-codes/compress-photo";
import { PhotoInput } from "@/components/receipt-photo-input";
import { codeMessage, photoMessage } from "@/lib/receipt-codes/messages";
import { RECEIPT_PHOTO_LIMITS } from "@/lib/receipt-codes/limits";
import { formulaTermsText, type FormulaView } from "@/lib/config/preset";
import {
  claimView,
  dollarsToCents,
  localDateTimeToIso,
  retentionDays,
  toDateTimeLocalValue,
  type ClaimView,
} from "@/lib/receipt-codes/form-input";

export const Route = createFileRoute("/r/$code")({ component: ScanPage });

type Offer = {
  merchantName: string;
  campaignName: string;
  campaignEndsAt: string;
  formula: FormulaView;
};

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
          setPage({
            kind: "ready",
            offer: null,
            view: claimView(mine),
            purchaseId: mine.purchaseId,
          });
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
        const offer = {
          merchantName: scan.merchantName,
          campaignName: scan.campaignName,
          campaignEndsAt: scan.campaignEndsAt,
          formula: scan.formula,
        };
        setPage({ kind: "ready", offer, view: userId ? "form" : "signed_out", purchaseId: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, isPending, userId]);

  if (page.kind === "loading") {
    return (
      <AppPage>
        <Loading />
      </AppPage>
    );
  }

  if (page.kind === "cant_use") {
    return (
      <AppPage>
        <PageTitle eyebrow={`Code ${code}`} title="We can't use this code" />
        <Alert>{page.message}</Alert>
        <p className="mt-6 text-sm text-neutral">
          Need another code? Ask the shop for a new TruFolks code with your receipt.
        </p>
      </AppPage>
    );
  }

  const here = `/r/${encodeURIComponent(code)}`;
  const toPhoto = (purchaseId: string, photoError: string) =>
    setPage({ ...page, view: "photo", purchaseId, photoError });
  const toChecking = () => setPage({ ...page, view: "checking" });

  return (
    <AppPage>
      <div className="flex flex-col gap-6">
        {page.offer ? (
          <OfferCard offer={page.offer} />
        ) : (
          <PageTitle eyebrow={`Code ${code}`} title="Your purchase" />
        )}

        {page.view === "signed_out" ? (
          <Card>
            <ClaimHeading step="Step 1 of 2" />
            <p className="mt-3 leading-relaxed">
              To use this code, sign in or create an account on this phone.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Link to="/sign-in" search={{ next: here }} className={btnPrimary}>
                Sign in
              </Link>
              <Link to="/sign-up" search={{ next: here }} className={btnSecondary}>
                Create account
              </Link>
            </div>
            <div className="mt-5">
              <PrivacyNote />
            </div>
          </Card>
        ) : null}

        {page.view === "form" ? (
          <ClaimForm code={code} onClaimed={toPhoto} onDone={toChecking} />
        ) : null}

        {page.view === "photo" && page.purchaseId ? (
          <PhotoStep
            purchaseId={page.purchaseId}
            initialError={page.photoError ?? null}
            onDone={toChecking}
          />
        ) : null}

        {page.view === "checking" ? (
          <Card>
            <StatusBadge tone="pending">Being checked</StatusBadge>
            <h2 className="mt-3 text-xl font-semibold">Thanks — we're checking your receipt.</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral">
              Come back to this link once it's confirmed to write your review.
            </p>
          </Card>
        ) : null}
        {page.view === "confirmed" ? (
          <Card>
            <StatusBadge tone="ready">Confirmed</StatusBadge>
            <h2 className="mt-3 text-xl font-semibold">Your purchase is confirmed.</h2>
            {page.purchaseId ? (
              <Link
                to="/review/$purchaseId"
                params={{ purchaseId: page.purchaseId }}
                className={btnSubmit + " mt-5"}
              >
                Write your review <ArrowRight aria-hidden="true" size={20} />
              </Link>
            ) : null}
          </Card>
        ) : null}
        {page.view === "turned_down" ? (
          <Card>
            <StatusBadge tone="forfeited">Not confirmed</StatusBadge>
            <h2 className="mt-3 text-xl font-semibold">
              We couldn't confirm this purchase from the receipt.
            </h2>
          </Card>
        ) : null}
      </div>
    </AppPage>
  );
}

/** The offer, shown before the shopper claims (Stitch: dark bar, merchant, rule panels). */
function OfferCard({ offer }: { offer: Offer }) {
  return (
    <Card className="!p-0 md:!p-6">
      <div className="flex items-center justify-between gap-3 bg-tertiary px-4 py-2 text-canvas md:px-3">
        <span className={labelClass}>Offer</span>
        <span className={`${labelClass} text-canvas/70`}>
          Ends {formatDay(offer.campaignEndsAt)}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-5 md:px-0 md:pt-5 md:pb-0">
        <div>
          <p className={`${labelClass} flex items-center gap-1.5 text-neutral`}>
            <Store aria-hidden="true" size={14} className="text-secondary" />
            Participating business
          </p>
          <h1 className="mt-1 text-2xl leading-8 font-bold tracking-[-0.01em] md:text-[28px] md:leading-9">
            {offer.merchantName}
          </h1>
          <p className="mt-1 text-[15px] font-semibold text-secondary">{offer.campaignName}</p>
          <p className="mt-3 text-[15px] leading-6 text-neutral">
            {offer.merchantName} pays people back for an honest review of something they just
            bought.
          </p>
        </div>
        <Note icon={<Percent size={18} />}>
          <p className={`${labelClass} text-neutral`}>What you get back</p>
          <p className="mt-1 text-[15px] font-semibold">{formulaTermsText(offer.formula)}</p>
        </Note>
        <div className="flex items-center gap-2 bg-tint-strong px-4 py-3 text-[15px] font-semibold">
          <BadgeCheck aria-hidden="true" size={18} className="shrink-0 text-secondary" />
          You get the same whether you give 1 star or 5.
        </div>
        <p className="bg-tint px-4 py-3 text-[13px] leading-5">
          <span className="font-bold">Before you review: </span>
          We check your receipt first, and you'll see exactly what you get back before you write
          your review.
        </p>
      </div>
    </Card>
  );
}

function ClaimHeading({ step }: { step: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-xl leading-7 font-bold tracking-[-0.01em] uppercase md:text-2xl">
        Claim your receipt
      </h2>
      <Chip>{step}</Chip>
    </div>
  );
}

function PrivacyNote() {
  return (
    <Note icon={<ShieldCheck size={18} />}>
      <p className={`${labelClass} mb-1`}>Receipt photo privacy</p>
      <p className="text-[13px] leading-5">{PHOTO_NOTE}</p>
    </Note>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className={labelClass}>
        {label}{" "}
        <span className="text-crimson" aria-hidden="true">
          *
        </span>
      </span>
      {children}
      {hint ? <span className="text-[13px] leading-5 text-neutral">{hint}</span> : null}
    </label>
  );
}

/** Compress and upload one photo. Returns null on success, or a plain message. */
async function sendPhoto(purchaseId: string, file: File): Promise<string | null> {
  const small = await compressReceiptPhoto(file);
  if (!small.ok) return photoMessage(small.reason);
  try {
    const r = await uploadReceiptPhoto({
      data: receiptPhotoForm(purchaseId, small.photo, small.header),
    });
    return r.ok ? null : r.message;
  } catch {
    return photoMessage("unavailable");
  }
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
    <Card>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <ClaimHeading step="Step 1 of 2" />
        <Field label="What did you buy?">
          <input
            className={inputClass}
            value={productLabel}
            maxLength={200}
            onChange={(e) => setProductLabel(e.target.value)}
          />
        </Field>
        <Field label="What did it cost?" hint="In dollars, like 12.50 — the total on your receipt.">
          <input
            className={inputClass}
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Field>
        <Field label="When did you buy it?">
          <input
            className={inputClass}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <PhotoInput file={file} onPick={setFile} />
        <PrivacyNote />
        {error ? <Alert>{error}</Alert> : null}
        <button type="submit" disabled={submitting} className={btnSubmit}>
          {submitting ? (
            "Sending…"
          ) : (
            <>
              Send <ArrowRight aria-hidden="true" size={20} />
            </>
          )}
        </button>
      </form>
    </Card>
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
    <Card>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <div>
          <StatusBadge tone="flagged">Photo needed</StatusBadge>
          <h2 className="mt-3 text-xl font-semibold">
            Your purchase is saved. We still need a photo of your receipt.
          </h2>
        </div>
        <PhotoInput file={file} onPick={setFile} />
        <PrivacyNote />
        {error ? <Alert>{error}</Alert> : null}
        <button type="submit" disabled={submitting} className={btnSubmit}>
          {submitting ? "Sending…" : error ? "Try again" : "Send photo"}
        </button>
      </form>
    </Card>
  );
}
