// Ticket 4 — write a review of a verified purchase, at /review/<purchaseId>
// (BRD v1.6 FR-11, FR-13, FR-14, FR-15, HON-02, LEG-01, AI-05, NFR-06).
// Plain, unstyled on purpose (STITCH-UI-01).
//
// The person writes every word. Nothing is pre-filled, suggested or
// completed (AI-05). They see the rating-blind statement before writing
// (HON-02), preview the review with its disclosure exactly as contacts will
// see it (FR-14), then post. After posting it can't be changed (FR-15).
// Ticket 7: the amount and formula are shown before writing (gap 17 promise);
// if the amount isn't known yet, writing is blocked (gap 20).
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getReviewStart, submitReview } from "@/lib/reviews/server-fns";
import { REVIEW_LIMITS } from "@/lib/reviews/limits";
import { RATING_BLIND_STATEMENT, reviewMessage } from "@/lib/reviews/messages";
import { checkReviewInput, type ReviewField, type ReviewInput } from "@/lib/reviews/review-input";
import { ReviewCard } from "@/lib/reviews/review-card";
import { formulaText } from "@/lib/config/preset";
import { formatCents } from "@/lib/receipt-codes/form-input";
import type { ReviewStart, ReviewView } from "@/lib/reviews/engine";

export const Route = createFileRoute("/review/$purchaseId")({ component: ReviewPage });

type Page =
  | { kind: "loading" }
  | { kind: "message"; message: string }
  | { kind: "ready"; start: ReviewStart };

function ReviewPage() {
  const { purchaseId } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    if (isPending || !userId) return;
    let alive = true;
    setPage({ kind: "loading" });
    getReviewStart({ data: { purchaseId } })
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r) setPage({ kind: "message", message: reviewMessage("unavailable") ?? "" });
        else if (!r.ok) setPage({ kind: "message", message: r.message });
        else setPage({ kind: "ready", start: r.start });
      });
    return () => {
      alive = false;
    };
  }, [purchaseId, isPending, userId]);

  if (isPending || (userId && page.kind === "loading")) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Please sign in to write your review.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: `/review/${encodeURIComponent(purchaseId)}` }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  if (page.kind === "message") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">Your review</h1>
        <p role="alert">{page.message}</p>
      </main>
    );
  }
  if (page.kind !== "ready") return null;
  const { start } = page;

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Review {start.merchantName}</h1>
      {start.review ? (
        <Posted review={start.review} />
      ) : start.status === "pending" ? (
        <p>{reviewMessage("not_verified")}</p>
      ) : start.status === "rejected" ? (
        <p>{reviewMessage("rejected")}</p>
      ) : !start.disclosure || start.disclosure.reward.status === "not_set" ? (
        <p>{reviewMessage("amount_not_set")}</p>
      ) : (
        <Writer start={start} onPosted={(review) => setPage({ kind: "ready", start: { ...start, review } })} />
      )}
    </main>
  );
}

function Posted({ review }: { review: ReviewView }) {
  return (
    <>
      <p>Your review is posted. Its rating and answers can't be changed now.</p>
      <ReviewCard {...review} />
    </>
  );
}

function whatYouGetBack(start: ReviewStart): string {
  const d = start.disclosure;
  if (!d || !d.incentive) return "This purchase isn't part of a paid-back offer.";
  if (d.reward.status !== "set" || d.reward.amountCents === null || !d.reward.formula) return reviewMessage("amount_not_set") ?? "";
  const f = d.reward.formula;
  return `What you get back: ${formatCents(d.reward.amountCents, f.currency)}, whatever rating you give. ${formulaText(f)}`;
}

const EMPTY = { rating: 0, whatUsed: "", howLong: "", honestThought: "" };

function Writer({ start, onPosted }: { start: ReviewStart; onPosted: (review: ReviewView) => void }) {
  const [draft, setDraft] = useState<ReviewInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<ReviewField, string>>>({});
  const [preview, setPreview] = useState<ReviewInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const set = <K extends ReviewField>(key: K, value: ReviewInput[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function onPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const check = checkReviewInput(draft, REVIEW_LIMITS);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    setPreview(check.value);
  }

  async function onPost() {
    if (!preview || posting) return;
    setPosting(true);
    setFormError(null);
    try {
      const r = await submitReview({ data: { purchaseId: start.purchaseId, ...preview } }).catch(() => null);
      if (!r) return setFormError(reviewMessage("unavailable"));
      if (!r.ok) {
        setFormError(r.message);
        if ("errors" in r && r.errors && Object.keys(r.errors).length > 0) {
          setErrors(r.errors);
          setPreview(null);
        }
        return;
      }
      onPosted(r.review);
    } finally {
      setPosting(false);
    }
  }

  if (preview) {
    return (
      <>
        <p>This is how your contacts will see your review, with the note that is always shown with it.</p>
        <ReviewCard
          reviewerName={start.reviewerName}
          merchantName={start.merchantName}
          productLabel={start.productLabel}
          rating={preview.rating}
          whatUsed={preview.whatUsed}
          howLong={preview.howLong}
          honestThought={preview.honestThought}
          verifiedPurchase
          disclosure={start.disclosure}
          createdAt={null}
        />
        <p className="mt-4">Once you post, your rating and answers can't be changed.</p>
        {formError ? <p role="alert">{formError}</p> : null}
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setPreview(null)} disabled={posting} className="rounded border px-4 py-2">
            Edit
          </button>
          <button type="button" onClick={() => void onPost()} disabled={posting} className="rounded border px-4 py-2">
            {posting ? "Posting…" : "Post review"}
          </button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={onPreview} noValidate autoComplete="off" className="flex flex-col gap-3">
      <p>You bought: {start.productLabel}</p>
      <p>{RATING_BLIND_STATEMENT}</p>
      <p>{whatYouGetBack(start)}</p>

      <fieldset className="flex flex-col gap-1">
        <legend>Your star rating</legend>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input type="radio" name="rating" value={n} checked={draft.rating === n} onChange={() => set("rating", n)} />
              {n === 1 ? "1 star" : `${n} stars`}
            </label>
          ))}
        </div>
        {errors.rating ? <span role="alert">{errors.rating}</span> : null}
      </fieldset>

      <label className="flex flex-col gap-1">
        What did you use or buy?
        <input
          className="rounded border px-3 py-2"
          value={draft.whatUsed}
          maxLength={REVIEW_LIMITS.maxShortFieldChars}
          onChange={(e) => set("whatUsed", e.target.value)}
          aria-invalid={Boolean(errors.whatUsed)}
        />
        {errors.whatUsed ? <span role="alert">{errors.whatUsed}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        How long, or how much, did you use it?
        <input
          className="rounded border px-3 py-2"
          value={draft.howLong}
          maxLength={REVIEW_LIMITS.maxShortFieldChars}
          onChange={(e) => set("howLong", e.target.value)}
          aria-invalid={Boolean(errors.howLong)}
        />
        {errors.howLong ? <span role="alert">{errors.howLong}</span> : null}
      </label>

      <label className="flex flex-col gap-1">
        One honest thought, in your own words
        <textarea
          className="rounded border px-3 py-2"
          rows={5}
          value={draft.honestThought}
          maxLength={REVIEW_LIMITS.maxThoughtChars}
          onChange={(e) => set("honestThought", e.target.value)}
          aria-invalid={Boolean(errors.honestThought)}
        />
        {errors.honestThought ? <span role="alert">{errors.honestThought}</span> : null}
      </label>

      {formError ? <p role="alert">{formError}</p> : null}
      <button type="submit" className="rounded border px-4 py-2">
        Preview
      </button>
    </form>
  );
}
