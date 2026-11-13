// Ticket 4 — write a review of a verified purchase, at /review/<purchaseId>
// (BRD v1.6 FR-11, FR-13, FR-14, FR-15, HON-02, LEG-01, AI-05, NFR-06).
// APP-17-02: styled from the Stitch Write a Review pair (visual reference
// only). One rating-blind statement, "What stood out?" as the open prompt, no
// video bonus or prototype state switcher.
//
// The person writes every word. Nothing is pre-filled, suggested or
// completed (AI-05). They see the rating-blind statement before writing
// (HON-02), preview the review with its disclosure exactly as friends will
// see it (FR-14), then post. After posting it can't be changed (FR-15).
// Ticket 7: the amount and formula are shown before writing (gap 17 promise);
// if the amount isn't known yet, writing is blocked (gap 20).
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Scale, Star } from "lucide-react";
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
} from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getReviewStart, submitReview } from "@/lib/reviews/server-fns";
import { REVIEW_LIMITS } from "@/lib/reviews/limits";
import { RATING_BLIND_STATEMENT, reviewMessage } from "@/lib/reviews/messages";
import { checkReviewInput, type ReviewField, type ReviewInput } from "@/lib/reviews/review-input";
import { ReviewCard } from "@/lib/reviews/review-card";
import { formulaTermsText } from "@/lib/config/preset";
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
      <AppPage>
        <Loading />
      </AppPage>
    );
  }

  if (!userId) {
    return (
      <SignInPrompt
        title="Write your review"
        body="Please sign in to write your review."
        next={`/review/${encodeURIComponent(purchaseId)}`}
      />
    );
  }

  if (page.kind === "message") {
    return (
      <AppPage>
        <PageTitle title="Your review" />
        <Alert>{page.message}</Alert>
      </AppPage>
    );
  }
  if (page.kind !== "ready") return null;
  const { start } = page;

  return (
    <AppPage>
      <div className="mb-6 border-b border-neutral/20 pb-6">
        <span
          className={`${labelClass} inline-flex items-center gap-1.5 border border-secondary/30 bg-tint px-2 py-1`}
        >
          <BadgeCheck aria-hidden="true" size={14} className="text-secondary" />
          Verified purchase
        </span>
        <h1 className="mt-3 text-[28px] leading-9 font-bold tracking-[-0.02em]">
          Review {start.merchantName}
        </h1>
        <p className="mt-3 inline-block bg-tint-strong px-3 py-1.5 text-[15px]">
          <span className={`${labelClass} mr-1`}>You bought:</span> {start.productLabel}
        </p>
      </div>
      {start.review ? (
        <Posted review={start.review} />
      ) : start.status === "pending" ? (
        <Card>
          <StatusBadge tone="pending">Being checked</StatusBadge>
          <p className="mt-3">{reviewMessage("not_verified")}</p>
        </Card>
      ) : start.status === "rejected" ? (
        <Card>
          <StatusBadge tone="forfeited">Not confirmed</StatusBadge>
          <p className="mt-3">{reviewMessage("rejected")}</p>
        </Card>
      ) : !start.disclosure || start.disclosure.reward.status === "not_set" ? (
        <Card>
          <StatusBadge tone="flagged">Not ready</StatusBadge>
          <p className="mt-3">{reviewMessage("amount_not_set")}</p>
        </Card>
      ) : (
        <Writer
          start={start}
          onPosted={(review) => setPage({ kind: "ready", start: { ...start, review } })}
        />
      )}
    </AppPage>
  );
}

function Posted({ review }: { review: ReviewView }) {
  return (
    <>
      <Card>
        <StatusBadge tone="paid">Posted</StatusBadge>
        <p className="mt-3 text-lg font-semibold">
          Your review is posted. Its rating and answers can't be changed now.
        </p>
        <Link to="/rewards" className={btnSubmit + " mt-5 text-base"}>
          See what you get back, and when <ArrowRight aria-hidden="true" size={20} />
        </Link>
        <p className="mt-4 text-sm">
          <Link to="/profile" hash={`review-${review.reviewId}`} className="font-semibold text-secondary underline">
            Pin it to My Top 5, add product details or share it
          </Link>
        </p>
      </Card>
      <ReviewCard {...review} />
    </>
  );
}

/**
 * The verified-purchase reward (APP-17-02) with the PAY-08 terms. The
 * rating-blind statement is shown once, separately (RATING_BLIND_STATEMENT).
 */
function WhatYouGetBack({ start }: { start: ReviewStart }) {
  const d = start.disclosure;
  if (!d || !d.incentive)
    return <p className="text-sm">This purchase isn't part of a paid-back offer.</p>;
  if (d.reward.status !== "set" || d.reward.amountCents === null || !d.reward.formula)
    return <p className="text-sm">{reviewMessage("amount_not_set")}</p>;
  const f = d.reward.formula;
  return (
    <div className="border-b border-neutral/20 pb-3">
      <p className={`${labelClass} text-neutral`}>What you get back</p>
      <p className="mt-1 text-xl leading-7 font-bold tracking-[-0.01em] uppercase md:text-2xl">
        <span className="text-secondary">{formatCents(d.reward.amountCents, f.currency)}</span> back
      </p>
      <p className="mt-2 text-sm leading-relaxed">{formulaTermsText(f)}</p>
    </div>
  );
}

const EMPTY = { rating: 0, whatUsed: "", howLong: "", honestThought: "" };

const fieldError = "text-sm font-normal text-crimson";

function Writer({
  start,
  onPosted,
}: {
  start: ReviewStart;
  onPosted: (review: ReviewView) => void;
}) {
  const [draft, setDraft] = useState<ReviewInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<ReviewField, string>>>({});
  const [preview, setPreview] = useState<ReviewInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const set = <K extends ReviewField>(key: K, value: ReviewInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

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
      const r = await submitReview({ data: { purchaseId: start.purchaseId, ...preview } }).catch(
        () => null,
      );
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
        <Chip>Preview</Chip>
        <h2 className="mt-3 text-xl font-semibold">Check your review</h2>
        <p className="mt-1 text-neutral">
          This is how your friends will see your review, with the note that is always shown with it.
        </p>
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
        <div className="mt-4">
          <Note>Once you post, your rating and answers can't be changed.</Note>
        </div>
        {formError ? (
          <div className="mt-3">
            <Alert>{formError}</Alert>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setPreview(null)}
            disabled={posting}
            className={btnSecondary}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => void onPost()}
            disabled={posting}
            className={btnPrimary + " flex-1"}
          >
            {posting ? "Posting…" : "Post review"}
          </button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={onPreview} noValidate autoComplete="off" className="flex flex-col gap-6">
      <section className="border-2 border-primary bg-surface p-5 shadow-[4px_4px_0_0_var(--color-primary)]">
        <WhatYouGetBack start={start} />
        <div className="mt-4">
          <Note icon={<Scale size={18} />}>
            <p className={`${labelClass} mb-1`}>Same reward at any rating</p>
            {RATING_BLIND_STATEMENT}
          </Note>
        </div>
      </section>

      <div className="mt-3 flex flex-col gap-8">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-semibold">
            Your star rating{" "}
            <span className="text-crimson" aria-hidden="true">
              *
            </span>
          </legend>
          {/* Every rating uses the same unselected control and the same path (APP-17-02). */}
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 border border-neutral/40 bg-surface px-1 py-2 text-xl font-semibold has-[:checked]:border-2 has-[:checked]:border-secondary has-[:checked]:bg-tint-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-secondary"
              >
                <input
                  type="radio"
                  name="rating"
                  value={n}
                  checked={draft.rating === n}
                  onChange={() => set("rating", n)}
                  className="sr-only"
                />
                <span aria-hidden="true">{n}</span>
                <Star
                  aria-hidden="true"
                  size={14}
                  className={draft.rating === n ? "fill-secondary text-secondary" : "text-primary"}
                />
                <span className="sr-only">{n === 1 ? "1 star" : `${n} stars`}</span>
              </label>
            ))}
          </div>
          {errors.rating ? (
            <span role="alert" className={fieldError}>
              {errors.rating}
            </span>
          ) : null}
        </fieldset>

        <label className="flex flex-col gap-2 text-base font-semibold">
          <span>
            What did you use or buy?{" "}
            <span className="text-crimson" aria-hidden="true">
              *
            </span>
          </span>
          <input
            className={inputClass}
            value={draft.whatUsed}
            maxLength={REVIEW_LIMITS.maxShortFieldChars}
            onChange={(e) => set("whatUsed", e.target.value)}
            aria-invalid={Boolean(errors.whatUsed)}
          />
          {errors.whatUsed ? (
            <span role="alert" className={fieldError}>
              {errors.whatUsed}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-2 text-base font-semibold">
          <span>
            How long, or how much, did you use it?{" "}
            <span className="text-crimson" aria-hidden="true">
              *
            </span>
          </span>
          <input
            className={inputClass}
            value={draft.howLong}
            maxLength={REVIEW_LIMITS.maxShortFieldChars}
            onChange={(e) => set("howLong", e.target.value)}
            aria-invalid={Boolean(errors.howLong)}
          />
          {errors.howLong ? (
            <span role="alert" className={fieldError}>
              {errors.howLong}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-2 text-base font-semibold">
          <span>
            What stood out?{" "}
            <span className="text-crimson" aria-hidden="true">
              *
            </span>
          </span>
          <span className="text-sm font-normal text-neutral">
            Good, mixed or bad — in your own words.
          </span>
          <textarea
            className={inputClass}
            rows={5}
            value={draft.honestThought}
            maxLength={REVIEW_LIMITS.maxThoughtChars}
            onChange={(e) => set("honestThought", e.target.value)}
            aria-invalid={Boolean(errors.honestThought)}
          />
          {errors.honestThought ? (
            <span role="alert" className={fieldError}>
              {errors.honestThought}
            </span>
          ) : null}
        </label>

        {formError ? <Alert>{formError}</Alert> : null}
        <div>
          <button type="submit" className={btnSubmit}>
            Preview <ArrowRight aria-hidden="true" size={20} />
          </button>
          <p className={`${labelClass} mt-3 text-center text-neutral`}>
            Next: see your review as friends will
          </p>
        </div>
      </div>
    </form>
  );
}
