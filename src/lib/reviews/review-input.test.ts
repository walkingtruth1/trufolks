// Ticket 4 — pure review helpers: field checks, disclosure lines, messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { disclosureLines, parseDisclosure } from "./disclosure.ts";
import { REVIEW_LIMITS } from "./limits.ts";
import { RATING_BLIND_STATEMENT, REVIEW_OUTCOMES, reviewMessage } from "./messages.ts";
import { checkReviewInput, ratingText } from "./review-input.ts";

const good = { rating: 3, whatUsed: "Flat white", howLong: "Drank it there", honestThought: "Bit bitter, good foam." };

test("a complete review passes, trimmed but otherwise untouched", () => {
  const r = checkReviewInput({ ...good, honestThought: "  Bit bitter,   good foam.  " }, REVIEW_LIMITS);
  assert.ok(r.ok);
  assert.equal(r.value.honestThought, "Bit bitter,   good foam.");
});

test("every rating from 1 to 5 passes the same way (rating-blind)", () => {
  for (const rating of [1, 2, 3, 4, 5]) assert.ok(checkReviewInput({ ...good, rating }, REVIEW_LIMITS).ok, String(rating));
});

test("bad ratings are refused", () => {
  for (const rating of [0, 6, 2.5, Number.NaN, "4" as unknown as number, undefined as unknown as number]) {
    const r = checkReviewInput({ ...good, rating }, REVIEW_LIMITS);
    assert.ok(!r.ok && r.errors.rating, String(rating));
  }
});

test("each honest field is required (FR-11)", () => {
  for (const f of ["whatUsed", "howLong", "honestThought"] as const) {
    for (const blank of ["", "   ", undefined, 42]) {
      const r = checkReviewInput({ ...good, [f]: blank }, REVIEW_LIMITS);
      assert.ok(!r.ok && r.errors[f], `${f}=${String(blank)}`);
    }
  }
});

test("overlong fields are refused, at the limit is fine", () => {
  const max = REVIEW_LIMITS;
  assert.ok(checkReviewInput({ ...good, whatUsed: "a".repeat(max.maxShortFieldChars) }, max).ok);
  assert.ok(!checkReviewInput({ ...good, whatUsed: "a".repeat(max.maxShortFieldChars + 1) }, max).ok);
  assert.ok(!checkReviewInput({ ...good, howLong: "a".repeat(max.maxShortFieldChars + 1) }, max).ok);
  assert.ok(checkReviewInput({ ...good, honestThought: "a".repeat(max.maxThoughtChars) }, max).ok);
  assert.ok(!checkReviewInput({ ...good, honestThought: "a".repeat(max.maxThoughtChars + 1) }, max).ok);
});

test("ratingText shows stars and words", () => {
  assert.equal(ratingText(4), "★★★★☆ 4 out of 5");
  assert.equal(ratingText(1), "★☆☆☆☆ 1 out of 5");
});

const stored = {
  version: 1,
  incentive: true,
  rating_blind: true,
  merchant_name: "Corner Cafe",
  campaign_id: "c1",
  campaign_name: "Pilot",
  verified_purchase: true,
  reward: { status: "not_set", formula: null, amount_cents: null },
  complete: false,
  attached_at: "2026-11-11T00:00:00Z",
};

test("parseDisclosure reads the stored disclosure", () => {
  const d = parseDisclosure(stored);
  assert.ok(d);
  assert.equal(d.merchantName, "Corner Cafe");
  assert.equal(d.reward.status, "not_set");
  assert.equal(d.complete, false);
});

test("parseDisclosure refuses anything it doesn't understand", () => {
  for (const bad of [null, "text", [], {}, { ...stored, rating_blind: false }, { ...stored, reward: { status: "maybe" } }, { ...stored, merchant_name: 3 }]) {
    assert.equal(parseDisclosure(bad), null, JSON.stringify(bad));
  }
});

test("disclosure lines say it's rating-blind and that the amount isn't set yet", () => {
  const lines = disclosureLines(parseDisclosure(stored)!);
  assert.ok(lines[0].includes("Corner Cafe"));
  assert.ok(lines.some((l) => l.includes("1 star or 5")));
  assert.ok(lines.some((l) => l.includes("isn't set yet")));
  const none = disclosureLines(parseDisclosure({ ...stored, incentive: false, reward: { status: "none" }, complete: true })!);
  assert.deepEqual(none, ["No one paid for this review."]);
});

test("every review outcome has a plain message, and the HON-02 statement says a low rating counts the same", () => {
  for (const o of REVIEW_OUTCOMES) {
    if (o === "ok") assert.equal(reviewMessage(o), null);
    else assert.ok((reviewMessage(o) ?? "").length > 10, o);
  }
  assert.match(RATING_BLIND_STATEMENT, /1-star/);
  assert.match(RATING_BLIND_STATEMENT, /5-star/);
});
