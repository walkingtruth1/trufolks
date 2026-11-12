// Ticket 4 — read and show the system-attached disclosure (BRD v1.6 LEG-01,
// LEG-03, P4). Pure. The disclosure itself is built by the database from the
// campaign record (migration 0006); this file only turns it into plain lines.
// The person can't edit or remove it.
//
// WORDING IS A DRAFT for the lawyer (LEG-03 is undecided). The reward amount
// and formula arrive in Tickets 7/8; until then the reward status is "not_set"
// and `complete` is false, and the contacts feed (Ticket 5) must not show the
// review (LEG-01: if the disclosure can't be attached in full, don't publish).

export interface Disclosure {
  version: number;
  incentive: boolean;
  ratingBlind: boolean;
  merchantName: string;
  campaignName: string | null;
  verifiedPurchase: boolean;
  reward: { status: "none" | "not_set" | "set"; amountCents: number | null };
  complete: boolean;
}

/** Read the stored JSON. Null if it isn't a disclosure we understand. */
export function parseDisclosure(json: unknown): Disclosure | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const d = json as Record<string, unknown>;
  const reward = d.reward && typeof d.reward === "object" ? (d.reward as Record<string, unknown>) : null;
  const status = reward?.status;
  if (
    typeof d.version !== "number" ||
    typeof d.incentive !== "boolean" ||
    d.rating_blind !== true ||
    typeof d.merchant_name !== "string" ||
    typeof d.verified_purchase !== "boolean" ||
    typeof d.complete !== "boolean" ||
    (status !== "none" && status !== "not_set" && status !== "set")
  ) {
    return null;
  }
  const amount = reward?.amount_cents;
  return {
    version: d.version,
    incentive: d.incentive,
    ratingBlind: true,
    merchantName: d.merchant_name,
    campaignName: typeof d.campaign_name === "string" ? d.campaign_name : null,
    verifiedPurchase: d.verified_purchase,
    reward: { status, amountCents: typeof amount === "number" ? amount : null },
    complete: d.complete,
  };
}

/** The disclosure as people see it, in plain lines. */
export function disclosureLines(d: Disclosure): string[] {
  if (!d.incentive) return ["No one paid for this review."];
  const lines = [
    `${d.merchantName} pays people back for honest reviews of things they bought.`,
    "The amount is the same whether they give 1 star or 5.",
  ];
  if (d.reward.status === "not_set") lines.push("The amount for this review isn't set yet.");
  return lines;
}
