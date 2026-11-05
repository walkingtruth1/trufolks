/** Opening commercial terms. Change these in one place. */
export const offer = {
  clips: 10,
  days: 14,
  reviewDays: 7,
  license: 250,
  shopper: 100,
  keep: 150,
  usageDays: 30,
} as const;

export function money(n: number) {
  return `$${n}`;
}
