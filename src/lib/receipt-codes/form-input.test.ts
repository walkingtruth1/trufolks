// Ticket 3b-2 — tests for the pure page helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "../auth/safe-next.ts";
import {
  authLinkWithNext,
  claimView,
  dollarsToCents,
  formatCents,
  localDateTimeToIso,
  retentionDays,
  scaledSize,
  toDateTimeLocalValue,
} from "./form-input.ts";
import { RECEIPT_PHOTO_LIMITS } from "./limits.ts";

test("dollarsToCents accepts plain dollar amounts", () => {
  assert.equal(dollarsToCents("12"), 1200);
  assert.equal(dollarsToCents("12.5"), 1250);
  assert.equal(dollarsToCents("12.50"), 1250);
  assert.equal(dollarsToCents(" 7 "), 700);
  assert.equal(dollarsToCents("$1,234.56"), 123456);
  assert.equal(dollarsToCents("$ 0.99"), 99);
  assert.equal(dollarsToCents("0"), 0);
});

test("dollarsToCents refuses anything that isn't a clear amount", () => {
  for (const bad of ["", "   ", "abc", "-3", "1.234", "1e3", "12.", ".5", "1,23", "12,34.5", "$", "1 000", "Infinity", "NaN"]) {
    assert.equal(dollarsToCents(bad), null, bad);
  }
  assert.equal(dollarsToCents("1000000.00"), 100_000_000);
  assert.equal(dollarsToCents("1000000.01"), null);
  assert.equal(dollarsToCents("99999999999999999999"), null);
});

test("formatCents shows dollars and cents", () => {
  assert.equal(formatCents(1250), "$12.50");
  assert.equal(formatCents(0), "$0.00");
  assert.match(formatCents(500, "ZZZ_bad"), /5\.00 ZZZ_bad/);
});

test("localDateTimeToIso reads the value as local time", () => {
  assert.equal(localDateTimeToIso("2026-11-11T19:30"), new Date(2026, 10, 11, 19, 30).toISOString());
  assert.equal(localDateTimeToIso("2026-11-11T19:30:15"), new Date(2026, 10, 11, 19, 30, 15).toISOString());
});

test("localDateTimeToIso refuses bad values", () => {
  for (const bad of ["", "2026-11-11", "2026-02-31T10:00", "2026-13-01T10:00", "2026-11-11T25:00", "yesterday", "2026-11-11 19:30"]) {
    assert.equal(localDateTimeToIso(bad), null, bad);
  }
});

test("toDateTimeLocalValue round-trips with localDateTimeToIso (to the minute)", () => {
  const d = new Date(2026, 0, 5, 8, 7, 0);
  assert.equal(toDateTimeLocalValue(d), "2026-01-05T08:07");
  assert.equal(localDateTimeToIso(toDateTimeLocalValue(d)), d.toISOString());
});

test("authLinkWithNext encodes the return path, and safeNextPath gives it back unchanged", () => {
  const next = "/r/ABCD-EFGH-JKMN-P";
  const link = authLinkWithNext("/sign-in", next);
  assert.equal(link, "/sign-in?next=%2Fr%2FABCD-EFGH-JKMN-P");
  const back = new URL(link, "https://x.invalid").searchParams.get("next");
  assert.equal(safeNextPath(back), next);
  assert.equal(authLinkWithNext("/sign-up", null), "/sign-up");
  assert.equal(authLinkWithNext("/sign-up", ""), "/sign-up");
});

test("a hostile next value still falls back to /profile", () => {
  const back = new URL(authLinkWithNext("/sign-in", "//evil.example"), "https://x.invalid").searchParams.get("next");
  assert.equal(safeNextPath(back), "/profile");
});

test("scaledSize keeps the shape, caps the longest side and never enlarges", () => {
  assert.deepEqual(scaledSize(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(scaledSize(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(scaledSize(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(scaledSize(10000, 10, 1600), { width: 1600, height: 2 });
  assert.deepEqual(scaledSize(0, 0, 1600), { width: 1, height: 1 });
});

test("claimView maps the claim to the right step", () => {
  assert.equal(claimView({ ok: false }), "form");
  assert.equal(claimView({ ok: true, status: "pending", hasPhoto: false }), "photo");
  assert.equal(claimView({ ok: true, status: "pending", hasPhoto: true }), "checking");
  assert.equal(claimView({ ok: true, status: "verified", hasPhoto: true }), "confirmed");
  assert.equal(claimView({ ok: true, status: "rejected", hasPhoto: false }), "turned_down");
});

test("retentionDays comes from the limit, not a hard-coded number", () => {
  assert.equal(retentionDays(RECEIPT_PHOTO_LIMITS.retentionSeconds), RECEIPT_PHOTO_LIMITS.retentionSeconds / 86_400);
  assert.equal(retentionDays(60), 1);
});
