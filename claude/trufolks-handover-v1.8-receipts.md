# TruFolks v1.8 handover — every review needs a receipt, the code is optional

Owner decision (2026-11-13, REV-18-02): every review on TruFolks is backed by a
receipt our team checked. A TruFolks code is optional, like a promo code at
checkout; it is what earns money back. Rejected options: reviews with no
receipt, and an optional receipt (both would blur what "Verified purchase"
means). Gifts and services that never came with a receipt are parked as a
possible separate feature, not part of Add a review.

Branch: `feat/profile-v1.7` (on top of 6c3c5e0). Not committed yet.

## What changed

| Area | Change |
|---|---|
| `migrations/0012_receipt_only_purchases.sql` | `verified_purchases.merchant_id` nullable + `store_name`; exactly one of the two. A receipt-only purchase never has a code or offer and is checked by photo. `review_drafts` holds the written review until the receipt is decided. `trufolks_submit_receipt_review` creates purchase + draft + photo in one call (duplicate photos refused; 10 per member per 24 h). On approval a trigger posts the review through the normal `trufolks_submit_review`; on rejection the draft is deleted. Disclosure, profile read rule and friends feed use the store name when there is no business. |
| `/add-review` | Step 1 write → step 2 add your receipt (where, date, photo) with a closed "Have a TruFolks code? Get money back" panel → step 3 preview and send. "My receipts" lists each receipt with its next step. "Start with a TruFolks code instead" stays at the bottom (Rewards links to it). |
| Code path | Unchanged rules. Applying a code from step 2 keeps the words on the device (`src/lib/reviews/draft.ts`); `/review/<purchaseId>` restores them once the receipt is confirmed. |
| Admin `/admin/purchases` | Receipt-only items say so: no code, no offer, nothing paid back; approving posts the review that was already written. |
| Shared pieces | `ReviewFields` (rating + three answers) and `PhotoInput` (receipt picker) are now shared components. |
| Settings label | "Who sees a new review: Friends only to start…" replaces the outdated "Contacts only. Wider sharing isn't built." |
| Copy | Footer and How It Works now say each review shows *whether* a reward was offered. |

Receipt-only reviews are Verified purchases: they can be shared, pinned to
Top 5 and, with an approved catalog record and seller link, shown in Shop.
They never create a payout (no offer).

## Checks

- `npm test`: 240/240. `npm run typecheck`, `npm run build`: pass.
- `npm run lint`: 2 errors, both in files this change doesn't touch
  (`src/lib/auth/safe-next.ts`, `src/lib/app-data/client.server.ts`).
- Local browser walkthrough (in-memory dev database): write → receipt → preview →
  send → admin approves → review on My Profile as Verified purchase with the
  store name. 320/390/1440 px, no sideways scroll, no console errors.
  Screenshots: `screenshots/v1.8/`.
- Not yet run on the Vercel preview database. Migration 0012 runs on the next
  preview build; after that it must never be edited (use 0013).

## Follow-ups

- How It Works has no line yet saying "No code? You can still review with any
  receipt." Worth adding with the owner's wording.
- Receipt-only dates are noon UTC on the day given, so the admin "photo time
  differs" flag can fire on same-day photos; it is a hint only.
