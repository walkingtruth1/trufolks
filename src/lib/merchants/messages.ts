// Ticket 6 — plain words for the merchant dashboard and concierge set-up
// (BRD v1.6 MER-02, MER-07, NFR-06, P8). Safe to import anywhere.
//
// The MER-02 statement and the MER-07 walkthrough are DRAFTS for the lawyer
// (LEG-03 is undecided). No amount or formula numbers until Tickets 7/8.

export const MERCHANT_OUTCOMES = [
  "ok",
  "already",
  "not_found",
  "owner_not_found",
  "invalid",
  "too_long",
  "not_allowed",
  "unavailable",
] as const;
export type MerchantOutcome = (typeof MERCHANT_OUTCOMES)[number];

const MERCHANT_MESSAGES: Record<Exclude<MerchantOutcome, "ok">, string> = {
  already: "That's already been accepted.",
  not_found: "We couldn't find that business on your account.",
  owner_not_found: "There's no TruFolks account with that email. Ask the owner to create one first.",
  invalid: "Please check the details and try again. The offer must end after it starts, and in the future.",
  // Ticket 7 (CFG-04): offer length is a setting.
  too_long: "That offer is longer than the settings allow. Shorten it, or change the most days an offer can run in Settings.",
  not_allowed: "This page is for the TruFolks team only.",
  unavailable: "Something went wrong on our side. Nothing was changed. Please try again in a minute.",
};

export function merchantMessage(outcome: MerchantOutcome): string | null {
  return outcome === "ok" ? null : MERCHANT_MESSAGES[outcome];
}

/** MER-02: the owner must accept this before any code is made. */
export const PAY_FOR_ANY_RATING_STATEMENT = [
  "You pay back every customer who posts a verified, honest review of what they bought from you — whatever rating they give.",
  "A 1-star review gets the same amount as a 5-star review. The amount comes from a set formula on what the customer spent, never from the rating.",
  "You can't approve, hide or remove a review before or after it counts.",
];

/** MER-07: a mixed-ratings example, shown before the first offer. */
export const WALKTHROUGH = {
  intro: "Before your first offer, here's what reviews can look like. You'll get a mix of ratings — that's what makes them believable.",
  examples: [
    { rating: 5, thought: "Best flat white on the street. I'll be back." },
    { rating: 3, thought: "Good coffee, but I waited 15 minutes at lunchtime." },
    { rating: 1, thought: "My pastry was stale and nobody seemed to care." },
  ],
  points: [
    "The 1-star customer gets exactly the same amount back as the 5-star one.",
    "For a low rating, the only thing you can do is reply to it. You can't remove it.",
    "If you believe a review is extortion or retaliation, raise it with TruFolks Resolution, with your evidence. A person decides; flagging doesn't hide the review.",
  ],
};

/** Shown where payout numbers will go once Ticket 8 exists. */
export const NOT_SET_YET = "Not set yet";
