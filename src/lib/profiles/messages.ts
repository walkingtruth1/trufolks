// v1.7 — plain messages for profile, Top 5, sharing and catalog outcomes. Pure.
import type { ProfileOutcome, ProfileReview, PurchaseState } from "./engine.ts";

const MESSAGES: Record<Exclude<ProfileOutcome, "ok">, string> = {
  not_found: "We couldn't find that, or it isn't shared with you.",
  invalid: "Please check the details and try again.",
  not_shareable:
    "This review can't be shared yet. It needs its full disclosure first, which the TruFolks team finishes.",
  too_many: "A Top 5 list holds five reviews at most. Remove one first.",
  duplicate: "That review is already in this list.",
  not_eligible:
    "That review can't go there yet. Top 5 needs your own review with a full disclosure; Shop also needs an approved seller link.",
  in_other_list: "That review is already in your other Top 5 list.",
  conflict: "Another catalog record already has that name or identifier. Merge them instead.",
  unavailable: "Something went wrong on our side. Please try again in a moment.",
};

export function profileMessage(outcome: ProfileOutcome): string | null {
  return outcome === "ok" ? null : MESSAGES[outcome];
}

/** Status text and next step for each purchase on Add a review. */
export const PURCHASE_STATE: Record<PurchaseState, { label: string; next: string }> = {
  pending_photo: {
    label: "Needs receipt photo",
    next: "Open the link or code on your receipt again to add its photo.",
  },
  pending: {
    label: "Being checked",
    next: "Our team is checking your receipt. You can write your review once it's confirmed.",
  },
  rejected: {
    label: "Not confirmed",
    next: "We couldn't confirm this receipt, so it can't be reviewed.",
  },
  not_ready: {
    label: "Not ready",
    next: "Confirmed. The offer's details are still being finished, so check back soon.",
  },
  ready: { label: "Ready to review", next: "Your receipt is confirmed. Write your review." },
  posted: { label: "Posted", next: "Your review is posted. Pin it to your Top 5 or share it." },
};

export const AUDIENCE_TEXT = {
  friends: "Friends only",
  public: "Anyone with the link",
} as const;

/** What the item is called: the catalog name when linked and approved, else the purchase label. */
export function itemName(r: Pick<ProfileReview, "product" | "productLabel">): string {
  return r.product && r.product.status === "approved" ? r.product.name : r.productLabel;
}

export const CATALOG_STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for the TruFolks team to check this product",
  approved: "In the TruFolks catalog",
  rejected: "Not added to the catalog — please check the details",
  merged: "Merged into another catalog record",
};
