// Ticket 5 — plain reasons for every contacts outcome (BRD v1.6 NFR-06, P8).
// Safe to import anywhere.

export const CONTACT_OUTCOMES = [
  "ok",
  "not_found",
  "own_invite",
  "you_blocked",
  "already_contacts",
  "not_contact",
  "unavailable",
] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

const CONTACT_MESSAGES: Record<Exclude<ContactOutcome, "ok">, string> = {
  not_found: "This invite link doesn't work any more. Ask the person to send you a new one.",
  own_invite: "This is your own invite link. Send it to someone you know.",
  // APP-17-04: shoppers see "Friends"; the code and tables keep "contacts".
  you_blocked: "You've blocked this person. Unblock them on your Friends page first.",
  already_contacts: "You're already friends.",
  not_contact: "You can only see the reviews of your friends.",
  unavailable:
    "Something went wrong on our side. Nothing was changed. Please try again in a minute.",
};

export function contactMessage(outcome: ContactOutcome): string | null {
  return outcome === "ok" ? null : CONTACT_MESSAGES[outcome];
}

/** Shown before someone accepts an invite, so they know what it means (P5). */
export function inviteExplanation(inviterName: string): string {
  return `${inviterName} invited you to be friends on TruFolks. Once you accept, you'll both see each other's reviews. Either of you can remove the other at any time.`;
}

/** Shown on the person's own history next to a review friends can't see yet (gap 19). */
export const NOT_SHOWN_YET =
  "Your friends can't see this review yet. It will show once the amount you get back is set, so the note about it is complete.";
