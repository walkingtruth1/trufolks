# TruFolks — Builder Handover (after Ticket 6) → Ticket 7

Date: 11 November 2026 · Owner: Jack · Spec: BRD v1.6
Branch: `feat/foundation-v1.6` (never commit to `main`, never merge, never deploy)
Read first: `trufolks-handover-ticket3b2.md` (stack, conventions, guardrails, gaps 1–17), `trufolks-handover-ticket5.md` (gaps 18–23) and `trufolks-handover-ticket6.md` (Ticket 5, gaps 24–28). This note adds only what changed.
Ticket 6 is written to the repo, not yet committed (Jack commits).

## Check status after Ticket 6
- `npm run typecheck`: clean. ESLint on the new and changed files: clean.
- `src/` tests: **194/194** (18 files). That is 190, minus the 2 `/dev/seed` tests removed with the seed, plus 6 new in `merchants.test.ts`. The 7 admin-allowlist tests moved to `src/lib/receipt-codes/admin-dev.test.ts`.
- `scripts/` tests: unchanged (184/197 on Windows, see gaps 1 and 24).
- `npm.cmd run build:dev`: passes and regenerated `src/routeTree.gen.ts`. `/merchant` and `/admin/merchants` were added; `/dev/seed` is gone.
- Smoke check (dev server): both new pages render their signed-out state, and `/dev/seed` returns 404. The signed-in flows were not clicked through in a browser. They are covered by the engine tests.

## Decisions (Jack, 11 Nov 2026)
1. **Concierge set-up replaces `/dev/seed`.** The TruFolks team adds a business for an existing account and creates its offer. The owner accepts the statements and makes codes themselves.
2. The dashboard shows **review text without reviewer names** (P5).

## Ticket 6 — what exists
- `migrations/0008_merchant_dashboard.sql`:
  - `merchant_events`: append-only log of created / offer_created / terms_accepted / walkthrough_accepted, with who did each.
  - Trigger `merchants_acceptance_locked`: a merchant's owner can't change, and once `terms_accepted_at` or `walkthrough_accepted_at` is set it can't be changed or cleared.
  - `trufolks_admin_create_merchant`: creates the business as `verified` (MER-01 checked in person). The caller's admin status is checked in the app.
  - `trufolks_admin_create_offer`: creates a **Type A, live** offer only (CFG-05 pilot preset; called CFG-11 by mistake before Ticket 7). The end must be after the start and in the future.
  - `trufolks_merchant_accept(user, merchant, 'terms' | 'walkthrough')`: owner only, logged. The existing code engine already refuses to make codes until both are accepted.
  - `trufolks_owner_offer_stats(owner)` (MER-05 funnel + counts by star, FR-24) and `trufolks_owner_reviews(owner, limit)` (no reviewer name or id). **Every dashboard read takes the owner's id**, so an owner never sees another business (§13, gap 9 closed).
- `src/lib/merchants/`: `limits.ts` (CFG placeholders: 200 reviews on the dashboard, 10 codes suggested per batch), `messages.ts` (MER-02 statement and MER-07 walkthrough — **lawyer DRAFTS**), `engine.ts`, `server-fns.ts` (admin functions check `isAdminCaller`), `merchants.test.ts`.
- `/merchant` (owner):
  1. Walkthrough (mixed ratings including a 1-star, same pay, reply not removal, Resolution) → "I understand".
  2. Pay-for-any-rating statement → "I accept".
  3. Per offer: codes made / opened / claimed, receipts being checked / confirmed / turned down, reviews, and counts for every star. "Paid back so far" and "Left in your offer's budget" show **Not set yet**.
  4. Make codes (reuses `generateReceiptCodes`, handout codes): shown once as short code + link, with a Print button.
  5. Reviews: every rating, newest first, no names, marked when not yet shown to contacts.
- `/admin/merchants` (team): add a business by the owner's login email, add offers, and see whether each owner has accepted.
- Removed: `src/routes/dev.seed.tsx`, `src/lib/dev/` (seed, server fn, test).

## Local manual run-through (replaces the /dev/seed steps)
1. Set `$env:TRUFOLKS_ADMIN_EMAILS_DEV="<your admin email>"` in PowerShell, then `npm.cmd run dev`.
2. Create three accounts: admin (that email), owner, buyer. Use separate browsers or profiles for owner and buyer.
3. Admin: `/admin/merchants` → add a business with the owner's email → add an offer.
4. Owner: `/merchant` → walkthrough → accept → make codes.
5. Buyer: open a code link → claim + photo. Admin: `/admin/purchases` → approve. Buyer: write the review.
6. Owner: `/merchant` shows the numbers and the review, without the buyer's name.

## What Ticket 6 did NOT do
- No reward cost, pool or cap numbers (Tickets 7/8). No check that the merchant funded the pool (MER-06; Ticket 8).
- No merchant reply to a review (MER-07 mentions it; the dashboard says "Replying is coming later").
- No product pages, AI-filled profile or correction path (FR-23). No ending an offer early or editing offers. No Type B.
- No QR image for codes (gap 29). No `/merchant` or `/admin/merchants` links from other pages.

## New gaps
29. Codes print as short code + link text only. A QR image needs a new package (e.g. `qrcode`); MER-06 allows a handed-out short code for the pilot.
30. The admin finds the owner by login email, and email verification is off (gap 6), so an email proves nothing. Mitigation: the owner has to sign in and accept the statements themselves before any code exists, and the admin sees who has accepted. Check the owner's account in person.
31. Merchant replies (MER-07 / RES-01) and FR-23 product pages are not built.
32. Offers are created `live` straight away. There's no draft or end-early control; the campaign end date is the only stop until the CFG-04 cap (Ticket 7).
33. Small-shop anonymity is weak: a café may guess who wrote a review from timing. Names are never shown, but the BRD may want a delay or a minimum count before text shows. Decide with Muse/lawyer.

## Remaining tickets
7 Toggles CFG-01–CFG-13 + immutable audit log + startup validation (gaps 20, 21; CFG-04 cap → "Left in your offer's budget"; CFG-05/11 Type A/B; CFG-07 visibility) · 8 Payout ledger (PAY-08, HON-09, decoupled from reviews; MER-06 pool; → "Paid back so far").
