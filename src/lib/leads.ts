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
    const parsed = JSON.parse(raw) as Lead[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
