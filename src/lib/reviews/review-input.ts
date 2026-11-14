// Ticket 4 — check a review's fields (BRD v1.6 FR-11). Pure; used by the page
// before sending and by the server before saving (the database checks again).
// It only checks the fields are filled in and not too long. It never looks at
// what the person wrote, and never changes it beyond trimming spaces (AI-05).
import type { ReviewLimits } from "./limits.ts";

export interface ReviewInput {
  rating: number;
  whatUsed: string;
  howLong: string;
  honestThought: string;
}

export type ReviewField = keyof ReviewInput;

export type ReviewCheck =
  | { ok: true; value: ReviewInput }
  | { ok: false; errors: Partial<Record<ReviewField, string>> };

export function checkReviewInput(raw: Partial<Record<ReviewField, unknown>>, limits: ReviewLimits): ReviewCheck {
  const errors: Partial<Record<ReviewField, string>> = {};
  const rating = typeof raw.rating === "number" ? raw.rating : Number.NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Please choose a star rating from 1 to 5.";

  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const whatUsed = text(raw.whatUsed);
  const howLong = text(raw.howLong);
  const honestThought = text(raw.honestThought);

  if (!whatUsed) errors.whatUsed = "Please say what you used or bought.";
  else if (whatUsed.length > limits.maxShortFieldChars) errors.whatUsed = `Please keep this under ${limits.maxShortFieldChars} characters.`;
  if (!howLong) errors.howLong = "Please say how long, or how much, you used it.";
  else if (howLong.length > limits.maxShortFieldChars) errors.howLong = `Please keep this under ${limits.maxShortFieldChars} characters.`;
  if (!honestThought) errors.honestThought = "Please write what stood out, in your own words.";
  else if (honestThought.length > limits.maxThoughtChars) errors.honestThought = `Please keep this under ${limits.maxThoughtChars} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { rating, whatUsed, howLong, honestThought } };
}

/** "★★★★☆" plus words, so the rating reads the same for screen readers. */
export function ratingText(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return `${"★".repeat(r)}${"☆".repeat(5 - r)} ${r} out of 5`;
}
