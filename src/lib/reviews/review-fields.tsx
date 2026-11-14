// The rating and the three honest answers (FR-11), shared by the receipt review
// page (/review/<purchaseId>) and Add a review (/add-review, v1.8). The person
// writes every word; nothing is pre-filled except their own saved draft (AI-05).
// Every rating uses the same unselected control and the same path (APP-17-02).
import { Star } from "lucide-react";
import { inputClass } from "@/components/ui";
import { REVIEW_LIMITS } from "./limits";
import type { ReviewField, ReviewInput } from "./review-input";

const fieldError = "text-sm font-normal text-crimson";

function Required() {
  return (
    <span className="text-crimson" aria-hidden="true">
      *
    </span>
  );
}

export function ReviewFields({
  draft,
  set,
  errors,
}: {
  draft: ReviewInput;
  set: <K extends ReviewField>(key: K, value: ReviewInput[K]) => void;
  errors: Partial<Record<ReviewField, string>>;
}) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-semibold">
          Your star rating <Required />
        </legend>
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
          What did you use or buy? <Required />
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
          How long, or how much, did you use it? <Required />
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
          What stood out? <Required />
        </span>
        <span className="text-sm font-normal text-neutral">Good, mixed or bad — in your own words.</span>
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
    </>
  );
}
