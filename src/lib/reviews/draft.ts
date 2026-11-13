// v1.8 (REV-18-02) — keep the review someone wrote while they claim a receipt
// code. Lives only in this browser (localStorage), per member. It holds the
// person's own words; nothing is suggested or rewritten (AI-05). Every read and
// write is guarded: private windows and blocked storage just mean no draft.
import type { ReviewInput } from "./review-input.ts";

export interface ReviewDraft extends ReviewInput {
  storeName: string;
  savedAt: string;
}

const key = (userId: string) => `trufolks:review-draft:${userId}`;

export function loadDraft(userId: string): ReviewDraft | null {
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    const rating = typeof d.rating === "number" && Number.isInteger(d.rating) && d.rating >= 1 && d.rating <= 5 ? d.rating : 0;
    const draft: ReviewDraft = {
      rating,
      whatUsed: s(d.whatUsed),
      howLong: s(d.howLong),
      honestThought: s(d.honestThought),
      storeName: s(d.storeName),
      savedAt: s(d.savedAt),
    };
    return draft.whatUsed || draft.howLong || draft.honestThought || draft.rating ? draft : null;
  } catch {
    return null;
  }
}

export function saveDraft(userId: string, d: Omit<ReviewDraft, "savedAt">): boolean {
  try {
    window.localStorage.setItem(key(userId), JSON.stringify({ ...d, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(userId: string): void {
  try {
    window.localStorage.removeItem(key(userId));
  } catch {
    // nothing to clear
  }
}
