// Add a review (/add-review), opened from My Profile and Rewards.
// v1.8 (REV-18-02, owner decision 2026-11-13): every review needs a receipt; a
// TruFolks code is optional, like a promo code at checkout.
//   1. Write: rating and the three honest answers.
//   2. Add your receipt: where you bought it, the date on it, and its photo.
//      Optional: "Have a TruFolks code?" — the words are kept on this device
//      and the existing /r/<code> flow (claim, photo, checks) takes over; the
//      review then posts as before, with the offer's reward.
//   3. Preview, then send. The team checks the receipt; once it's confirmed the
//      review posts by itself as a Verified purchase (migration 0012). No code,
//      so nothing is paid back and the disclosure says so.
// Receipts already sent are listed below with their status and next step.
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ReceiptText, Scale } from "lucide-react";
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
  SignInPrompt,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import { PhotoInput } from "@/components/receipt-photo-input";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { MyPurchase, PurchaseState } from "@/lib/profiles/engine";
import { profileMessage, PURCHASE_STATE } from "@/lib/profiles/messages";
import { getMyPurchases } from "@/lib/profiles/server-fns";
import { compressReceiptPhoto } from "@/lib/receipt-codes/compress-photo";
import { photoMessage } from "@/lib/receipt-codes/messages";
import type { Disclosure } from "@/lib/reviews/disclosure";
import { clearDraft, loadDraft, saveDraft } from "@/lib/reviews/draft";
import { REVIEW_LIMITS } from "@/lib/reviews/limits";
import { RECEIPT_ONLY_NOTE, receiptReviewMessage } from "@/lib/reviews/receipt-review-messages";
import { submitReceiptReview } from "@/lib/reviews/receipt-review-server-fns";
import { ReviewCard } from "@/lib/reviews/review-card";
import { ReviewFields } from "@/lib/reviews/review-fields";
import { checkReviewInput, type ReviewField, type ReviewInput } from "@/lib/reviews/review-input";

export const Route = createFileRoute("/add-review")({ component: AddReviewPage });

const TONE: Record<PurchaseState, StatusTone> = {
  pending_photo: "flagged",
  pending: "pending",
  rejected: "forfeited",
  not_ready: "held",
  ready: "ready",
  posted: "paid",
};

type Purchases = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; purchases: MyPurchase[] };

function AddReviewPage() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [purchases, setPurchases] = useState<Purchases>({ kind: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (isPending || !userId) return;
    let alive = true;
    getMyPurchases()
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r || !r.ok) setPurchases({ kind: "error", message: r?.message ?? profileMessage("unavailable") ?? "" });
        else setPurchases({ kind: "ok", purchases: r.purchases });
      });
    return () => {
      alive = false;
    };
  }, [isPending, userId, reload]);

  if (isPending) {
    return (
      <AppPage>
        <Loading />
      </AppPage>
    );
  }
  if (!userId) {
    return <SignInPrompt title="Add a review" body="Please log in to write a review." next="/add-review" signUp />;
  }

  return (
    <AppPage>
      <p className="mb-4 text-sm">
        <Link to="/profile" className="font-semibold text-secondary underline">
          ← My Profile
        </Link>
      </p>
      <PageTitle
        eyebrow="Add a review"
        title="Review something you bought"
        intro="Write it in your own words, then add your receipt. Every review on TruFolks is backed by a checked receipt."
      />
      <Composer userId={userId} name={user?.displayName ?? "You"} onSent={() => setReload((n) => n + 1)} />
      <ClaimedReceipts purchases={purchases} />
      <EnterCodeNow />
    </AppPage>
  );
}

// ------------------------------------------------------------------ write → receipt → preview → send

type Receipt = { storeName: string; purchasedOn: string; file: File | null };
type ErrorKey = ReviewField | "storeName" | "purchasedOn" | "photo";
type Step = "write" | "receipt" | "preview" | "sent";

const EMPTY_REVIEW: ReviewInput = { rating: 0, whatUsed: "", howLong: "", honestThought: "" };

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The disclosure a receipt without a code gets (built by the database; no business, no offer). */
function noOfferDisclosure(storeName: string): Disclosure {
  return {
    version: 2,
    incentive: false,
    ratingBlind: true,
    merchantName: storeName,
    campaignName: null,
    verifiedPurchase: true,
    reward: { status: "none", amountCents: null, formula: null },
    wording: null,
    complete: true,
  };
}

function StepChip({ n, label }: { n: number; label: string }) {
  return (
    <Chip>
      Step {n} of 3 · {label}
    </Chip>
  );
}

function Composer({ userId, name, onSent }: { userId: string; name: string; onSent: () => void }) {
  const [review, setReview] = useState<ReviewInput>(EMPTY_REVIEW);
  const [receipt, setReceipt] = useState<Receipt>({ storeName: "", purchasedOn: today(), file: null });
  const [restored, setRestored] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [step, setStep] = useState<Step>("write");
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const saved = loadDraft(userId);
    if (!saved) return;
    setReview({ rating: saved.rating, whatUsed: saved.whatUsed, howLong: saved.howLong, honestThought: saved.honestThought });
    setReceipt((r) => ({ ...r, storeName: saved.storeName }));
    setRestored(true);
  }, [userId]);

  const setField = <K extends ReviewField>(key: K, value: ReviewInput[K]) => setReview((d) => ({ ...d, [key]: value }));

  function onWritten(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const check = checkReviewInput(review, REVIEW_LIMITS);
    if (!check.ok) return setErrors(check.errors);
    setErrors({});
    setReview(check.value);
    setStep("receipt");
  }

  function onReceipt(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs: Partial<Record<ErrorKey, string>> = {};
    const store = receipt.storeName.trim();
    if (!store) errs.storeName = "Please say where you bought it.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt.purchasedOn) || receipt.purchasedOn > today())
      errs.purchasedOn = "Please give the date on your receipt.";
    if (!receipt.file) errs.photo = "Please add a photo of your receipt.";
    if (Object.keys(errs).length > 0) return setErrors(errs);
    setErrors({});
    setReceipt((r) => ({ ...r, storeName: store }));
    setStep("preview");
  }

  async function onSend() {
    if (sending || !receipt.file) return;
    setSending(true);
    setFormError(null);
    try {
      const small = await compressReceiptPhoto(receipt.file);
      if (!small.ok) {
        setErrors({ photo: photoMessage(small.reason) ?? "" });
        setStep("receipt");
        return;
      }
      const form = new FormData();
      form.set("rating", String(review.rating));
      form.set("whatUsed", review.whatUsed);
      form.set("howLong", review.howLong);
      form.set("honestThought", review.honestThought);
      form.set("storeName", receipt.storeName);
      form.set("purchasedOn", receipt.purchasedOn);
      form.set("photo", small.photo, "receipt.jpg");
      form.set("header", small.header, "header.bin");
      const r = await submitReceiptReview({ data: form }).catch(() => null);
      if (!r) return setFormError(receiptReviewMessage("unavailable"));
      if (!r.ok) {
        setFormError(r.message);
        const errs = r.errors as Partial<Record<ErrorKey, string>>;
        if (Object.keys(errs).length > 0) {
          setErrors(errs);
          setStep(errs.storeName || errs.purchasedOn ? "receipt" : "write");
        } else if (r.reason === "bad_photo" || r.reason === "too_big" || r.reason === "duplicate_photo") {
          setErrors({ photo: r.message });
          setStep("receipt");
        }
        return;
      }
      clearDraft(userId);
      setStep("sent");
      onSent();
    } finally {
      setSending(false);
    }
  }

  function startOver() {
    setReview(EMPTY_REVIEW);
    setReceipt({ storeName: "", purchasedOn: today(), file: null });
    setRestored(false);
    setErrors({});
    setFormError(null);
    setStep("write");
  }

  if (step === "sent") {
    return (
      <Card>
        <StatusBadge tone="pending">Being checked</StatusBadge>
        <p className="mt-3 text-lg font-semibold">Sent. We're checking your receipt.</p>
        <p className="mt-2 text-[15px] leading-6">
          Once it's confirmed, your review posts by itself as a Verified purchase, Friends only to start. You'll find it
          on My Profile, ready to pin or share.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/profile" className={btnPrimary}>
            Go to My Profile <ArrowRight aria-hidden="true" size={16} />
          </Link>
          <button type="button" onClick={startOver} className={btnSecondary}>
            Write another review
          </button>
        </div>
      </Card>
    );
  }

  if (step === "preview") {
    return (
      <section aria-labelledby="preview-title">
        <StepChip n={3} label="Check and send" />
        <h2 id="preview-title" className="mt-3 text-xl font-semibold">
          Check your review
        </h2>
        <p className="mt-1 text-neutral">This is how your friends will see it once your receipt is confirmed.</p>
        <ReviewCard
          reviewerName={name}
          merchantName={receipt.storeName}
          productLabel={review.whatUsed}
          rating={review.rating}
          whatUsed={review.whatUsed}
          howLong={review.howLong}
          honestThought={review.honestThought}
          verifiedPurchase
          disclosure={noOfferDisclosure(receipt.storeName)}
          createdAt={null}
        />
        <div className="mt-4 flex flex-col gap-3">
          <Note>{RECEIPT_ONLY_NOTE}</Note>
          <Note>Once you send it, your rating and answers can't be changed.</Note>
        </div>
        {formError ? (
          <div className="mt-3">
            <Alert>{formError}</Alert>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => setStep("receipt")} disabled={sending} className={btnSecondary}>
            Back
          </button>
          <button type="button" onClick={() => void onSend()} disabled={sending} className={`${btnPrimary} flex-1`}>
            {sending ? "Sending…" : "Send for checking"}
          </button>
        </div>
      </section>
    );
  }

  if (step === "receipt") {
    return (
      <form onSubmit={onReceipt} noValidate autoComplete="off" className="flex flex-col gap-6" aria-labelledby="receipt-title">
        <div>
          <StepChip n={2} label="Your receipt" />
          <h2 id="receipt-title" className="mt-3 text-xl font-semibold">
            Add your receipt
          </h2>
          <p className="mt-1 text-neutral">Our team checks it before your review goes up. It's never shown to anyone.</p>
        </div>
        <label className="flex flex-col gap-2 text-base font-semibold">
          <span>
            Where did you buy it?{" "}
            <span className="text-crimson" aria-hidden="true">
              *
            </span>
          </span>
          <input
            className={inputClass}
            value={receipt.storeName}
            maxLength={REVIEW_LIMITS.maxStoreNameChars}
            onChange={(e) => setReceipt((r) => ({ ...r, storeName: e.target.value }))}
            aria-invalid={Boolean(errors.storeName)}
            placeholder="Shop or website, as on the receipt"
          />
          {errors.storeName ? (
            <span role="alert" className="text-sm font-normal text-crimson">
              {errors.storeName}
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-2 text-base font-semibold">
          <span>
            Date on the receipt{" "}
            <span className="text-crimson" aria-hidden="true">
              *
            </span>
          </span>
          <input
            type="date"
            className={`${inputClass} sm:max-w-xs`}
            value={receipt.purchasedOn}
            max={today()}
            onChange={(e) => setReceipt((r) => ({ ...r, purchasedOn: e.target.value }))}
            aria-invalid={Boolean(errors.purchasedOn)}
          />
          {errors.purchasedOn ? (
            <span role="alert" className="text-sm font-normal text-crimson">
              {errors.purchasedOn}
            </span>
          ) : null}
        </label>
        <div>
          <PhotoInput file={receipt.file} onPick={(file) => setReceipt((r) => ({ ...r, file }))} />
          {errors.photo ? (
            <p role="alert" className="mt-2 text-sm text-crimson">
              {errors.photo}
            </p>
          ) : null}
        </div>
        <CodeOffer userId={userId} review={review} storeName={receipt.storeName} />
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setStep("write")} className={btnSecondary}>
            Back
          </button>
          <button type="submit" className={`${btnSubmit} flex-1`}>
            Preview <ArrowRight aria-hidden="true" size={20} />
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onWritten} noValidate autoComplete="off" className="flex flex-col gap-8">
      <div>
        <StepChip n={1} label="Your review" />
      </div>
      {restored ? <Note>We kept the review you were writing. Check it, then carry on.</Note> : null}
      <ReviewFields draft={review} set={setField} errors={errors} />
      <div>
        <button type="submit" className={btnSubmit}>
          Next: add your receipt <ArrowRight aria-hidden="true" size={20} />
        </button>
      </div>
    </form>
  );
}

/** The promo-code step: optional, closed until asked for. */
function CodeOffer({ userId, review, storeName }: { userId: string; review: ReviewInput; storeName: string }) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  function onApply() {
    const c = code.trim();
    if (!c) return setError("Type the code from your receipt.");
    if (!saveDraft(userId, { ...review, storeName })) {
      return setError("This browser won't let us keep your review while you use the code. Send it without the code, or copy your words first.");
    }
    void navigate({ to: "/r/$code", params: { code: c } });
  }
  return (
    <details className="border border-neutral/30 bg-surface p-4">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 font-semibold">
        <ReceiptText aria-hidden="true" size={18} className="text-secondary" />
        Have a TruFolks code on your receipt?
        <span className="text-sm font-normal text-secondary">Get money back</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-[15px] leading-6">
          Businesses running a TruFolks offer print a code on the receipt. Use it and you get money back. We keep your
          review on this device while you claim it.
        </p>
        <Note icon={<Scale size={18} />}>What you get back is the same whether you give 1 star or 5.</Note>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="offer-receipt-code" className="sr-only">
            TruFolks code
          </label>
          <input
            id="offer-receipt-code"
            className={`${inputClass} sm:flex-1`}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onApply();
              }
            }}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="TruFolks code"
          />
          <button type="button" onClick={onApply} className={btnSecondary}>
            Apply code <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-crimson">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ receipts already sent

function ClaimedReceipts({ purchases }: { purchases: Purchases }) {
  if (purchases.kind === "loading") return null;
  if (purchases.kind === "error") {
    return (
      <div className="mt-10">
        <Alert>{purchases.message}</Alert>
      </div>
    );
  }
  if (purchases.purchases.length === 0) return null;
  return (
    <section aria-labelledby="purchases-title" className="mt-12">
      <h2 id="purchases-title" className="text-xl leading-7 font-bold">
        My receipts
      </h2>
      <p className="mt-1 text-sm text-neutral">Newest first, with what happens next.</p>
      <ul className="mt-4 flex flex-col gap-3">
        {purchases.purchases.map((p) => (
          <PurchaseRow key={p.purchaseId} p={p} />
        ))}
      </ul>
    </section>
  );
}

/** For someone who already has a code in hand (e.g. from Rewards → Claim a receipt). */
function EnterCodeNow() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return setError("Type the code from your receipt.");
    void navigate({ to: "/r/$code", params: { code: c } });
  }
  return (
    <section id="claim" aria-labelledby="claim-title" className="mt-12 scroll-mt-28 border-t border-neutral/20 pt-6">
      <h2 id="claim-title" className="flex items-center gap-2 text-base leading-6 font-semibold">
        <ReceiptText aria-hidden="true" size={18} className="text-secondary" /> Start with a TruFolks code instead
      </h2>
      <p className="mt-1 text-sm text-neutral">Claim the receipt first, then write your review once it's checked.</p>
      <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="add-receipt-code" className="sr-only">
          TruFolks code
        </label>
        <input
          id="add-receipt-code"
          className={`${inputClass} sm:flex-1`}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="TruFolks code"
        />
        <button type="submit" className={btnSecondary}>
          Claim receipt <ArrowRight aria-hidden="true" size={16} />
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-crimson">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PurchaseRow({ p }: { p: MyPurchase }) {
  const s = PURCHASE_STATE[p.state];
  const next =
    p.state === "pending" && p.reviewWaiting
      ? "Our team is checking your receipt. Your review posts by itself once it's confirmed."
      : p.state === "rejected" && p.withoutCode
        ? "We couldn't confirm this receipt, so its review wasn't posted."
        : s.next;
  return (
    <li className="border border-neutral/20 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base leading-6 font-semibold break-words">{p.productLabel}</p>
          <p className="text-[13px] leading-5 break-words text-neutral">
            {p.merchantName}
            {p.purchasedAt
              ? ` · ${new Date(p.purchasedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
              : ""}
          </p>
          {p.campaignName ? (
            <p className={`${labelClass} mt-1 text-[11px] text-neutral`}>Offer: {p.campaignName}</p>
          ) : p.withoutCode ? (
            <p className={`${labelClass} mt-1 text-[11px] text-neutral`}>Receipt only · no code</p>
          ) : null}
        </div>
        <StatusBadge tone={TONE[p.state]}>{s.label}</StatusBadge>
      </div>
      <p className="mt-3 text-[15px] leading-6">{next}</p>
      {p.state === "ready" ? (
        <Link to="/review/$purchaseId" params={{ purchaseId: p.purchaseId }} className={`${btnPrimary} mt-3`}>
          Write your review <ArrowRight aria-hidden="true" size={16} />
        </Link>
      ) : p.state === "posted" && p.reviewId ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/reviews/$reviewId" params={{ reviewId: p.reviewId }} className={btnSecondary}>
            Open review
          </Link>
          <Link to="/profile" hash={`review-${p.reviewId}`} className={btnSecondary}>
            Pin or share
          </Link>
        </div>
      ) : null}
    </li>
  );
}
