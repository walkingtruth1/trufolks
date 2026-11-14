// Ticket 7 — plain words for the settings page (BRD v1.6 NFR-06, P8). Safe to import anywhere.

export const CONFIG_OUTCOMES = ["ok", "invalid", "reason_missing", "pending_exists", "no_change", "not_allowed", "unavailable"] as const;
export type ConfigOutcome = (typeof CONFIG_OUTCOMES)[number];

const CONFIG_MESSAGES: Record<Exclude<ConfigOutcome, "ok">, string> = {
  invalid: "These settings can't be saved. Nothing was changed. The refusal was logged.",
  reason_missing: "Please say why you're making this change. It goes in the log.",
  pending_exists: "A change is already waiting to take effect. Wait until it does, then make your next change.",
  no_change: "Nothing changed, so nothing was saved.",
  not_allowed: "This page is for the TruFolks team only.",
  unavailable: "Something went wrong on our side. Nothing was changed. Please try again in a minute.",
};

export function configMessage(outcome: ConfigOutcome): string | null {
  return outcome === "ok" ? null : CONFIG_MESSAGES[outcome];
}

/** Plain names for log events. */
export const LOG_EVENT_LABELS: Record<string, string> = {
  seeded: "Starting values loaded",
  changed: "Changed",
  refused: "Change refused",
  rejected_at_startup: "Rejected when checked; earlier settings used",
  disclosures_completed: "Earlier disclosures finished",
};
