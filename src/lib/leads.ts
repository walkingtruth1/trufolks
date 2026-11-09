export type LeadRole = "shopper" | "brand";

export type Lead = {
  role: LeadRole;
  name: string;
  email: string;
  detail: string;
  extra: string;
  at: string;
};

const KEY = "trufolks.leads";

function isLead(value: unknown): value is Lead {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const { role, name, email, detail, extra, at } = value as Partial<
    Record<keyof Lead, unknown>
  >;
  return (
    (role === "shopper" || role === "brand") &&
    typeof name === "string" &&
    typeof email === "string" &&
    typeof detail === "string" &&
    typeof extra === "string" &&
    typeof at === "string"
  );
}

export function saveLead(lead: Omit<Lead, "at">) {
  const next: Lead = { ...lead, at: new Date().toISOString() };
  const prev = readLeads();
  prev.push(next);
  localStorage.setItem(KEY, JSON.stringify(prev));
  return next;
}

export function readLeads(): Lead[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLead) : [];
  } catch {
    return [];
  }
}
