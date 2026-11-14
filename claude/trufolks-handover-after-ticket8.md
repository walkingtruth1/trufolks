# TruFolks — Builder Handover (after Ticket 8: backend Tickets 1–8 complete)

Date: 11 November 2026 · Owner: Jack · Spec: BRD v1.6
Branch: `feat/foundation-v1.6` (never commit to `main`, never merge, never deploy)
Read first: `trufolks-handover-ticket3b2.md` (stack, conventions, guardrails, gaps 1–17), then the Ticket 5, 6, 7 and 8 handovers (gaps 18–38). This note adds only what changed.
Ticket 8 is written to the repo, not yet committed (Jack commits).

## Check status after Ticket 8
- `npm run typecheck`: clean. ESLint on every new and changed file: clean.
- `src/` tests: **216/216** (20 files). 8 are new in `src/lib/payouts/payouts.test.ts`. `merchants.test.ts` and `config.test.ts` now load 0010 and fund their offers.
- `scripts/` tests: unchanged (184/197 on Windows, gaps 1 and 24).
- `npm.cmd run build:dev`: passes and adds `/rewards` and `/admin/payouts` to `src/routeTree.gen.ts`.
- Smoke check (dev server): a scan ran all migrations through 0010 and returned the plain code message. `/rewards` and `/admin/payouts` render signed out. No errors in the server log. Signed-in flows were not clicked through in a browser; they are covered by the tests.

## Decisions (Jack, 11 Nov 2026)
1. **Paying (D6 stays OPEN).** After the hold, a payout is "released". The team pays by hand during the concierge pilot and records "paid" with how it was paid and an optional reference.
2. **MER-06 is required.** The team records deposits per offer, and a deposit can't take the offer past its pool setting. No codes can be made before a deposit. The offer's budget is its deposits (capped by the pool setting), and forfeited payouts give budget back.
3. **Returns and holds are recorded by the TruFolks team only**, on `/admin/payouts`. Every action needs a reason.

## Ticket 8 — what exists
- `migrations/0010_payout_ledger.sql`:
  - `offer_deposits` (append-only), `trufolks_offer_deposited_cents`, `trufolks_record_deposit` (outcomes: ok / not_found / invalid / over_pool).
  - `payouts`: one per review of an offer purchase, in its own table (FR-27). It stores a snapshot: confirmed receipt amount, percent, floor, cap, amount, currency and settings version, plus links to the review, purchase, code, campaign, merchant and person. Statuses: held → released → paid, or held → forfeited. A flag can move a released payout back to held. Paid and forfeited are final. The snapshot can't change and rows can't be deleted.
  - `payout_events` (append-only, FR-22): qualified / held / released / flagged / flag_cleared / forfeited / paid, each with review, code, campaign, amount, actor (null = system) and reason.
  - **`trufolks_qualify_payout(review_id)`**, run by an AFTER INSERT trigger on `reviews`. It reads only the purchase link and whether each honest field has text. **It never reads the rating** (PAY-01 / PAY-03 barrier). A test checks that its source, the trigger's, `trufolks_purchase_reward` and `trufolks_pay08_reward` never mention the rating.
  - Hold: `hold_until` = purchase time + `payout.hold_days` from the offer's pinned settings (HON-09).
  - Admin actions:
    - `trufolks_release_due_payouts()`: releases held, unflagged payouts that are due. It runs when `/rewards`, `/admin/payouts` or the merchant dashboard loads; there is no scheduler.
    - `trufolks_flag_payout` / `trufolks_clear_payout_flag` (RES-01(c)): a flag holds the payout but never hides the review.
    - `trufolks_forfeit_payout`: "returned" only inside the return window (`window_passed` otherwise); "policy_breach" only after a flag (`needs_flag` otherwise).
    - `trufolks_mark_payout_paid`: only for released payouts; how it was paid is required.
  - `trufolks_campaign_room`: replaced. The pool is now the deposits (capped by the pool setting). Each purchase counts its payout amount (forfeited = $0), or the PAY-08 estimate if it has no payout yet.
  - `trufolks_owner_payout_totals(owner)`: owner-only totals for the dashboard.
- `src/lib/payouts/`: `engine.ts`, `messages.ts` (`payoutStatusText`, FR-20 plain status, always with the amount), `server-fns.ts`, `payouts.test.ts`.
- Wiring:
  - `generateReceiptCodes` refuses `not_funded` before any deposit.
  - The merchant dashboard shows deposited, paid back so far, ready to be paid, held, and not paid. It hides "Make codes" until the offer is funded.
  - The posted-review page links to `/rewards`.
- Pages:
  - **`/rewards`** (FR-20): each payout with business, product, offer and plain status: qualified and held until date, on hold, ready, paid (how), or not paid (returned or breach — "your review stays up").
  - **`/admin/payouts`**: offers with deposits and budget use, a deposit form, and every payout with the person's name and email, the formula worked out, status and the allowed actions.

## Local manual run-through (end to end)
1. `$env:TRUFOLKS_ADMIN_EMAILS_DEV="<admin email>"` then `npm.cmd run dev`. Create admin, owner and buyer accounts.
2. Admin: `/admin/merchants` → add the business and an offer → `/admin/payouts` → record a deposit (e.g. 250.00).
3. Owner: `/merchant` → walkthrough → accept → make codes.
4. Buyer: open a code (the formula is shown) → claim + photo. Admin: `/admin/purchases` → approve with the receipt amount.
5. Buyer: write the review (it shows "What you get back: $X") → `/rewards` shows "Qualified and held…".
6. To see release locally: in `/admin/settings` set "Payout held for" to 0 days **before** creating the offer. The payout then shows Ready on the next load. Then use **Mark paid** on `/admin/payouts`.
7. Contacts see the review only after "Wording approved by the lawyer" is on and Finish earlier disclosures has run (Ticket 7).

## What Ticket 8 did NOT do
- No real money movement, payments provider, tax handling or reward form (D6 OPEN).
- No clawback after release (undecided, for Jack).
- No automated return or refund feed (Phase 2).
- No Resolution threads (RES-01 open / respond / decide / appeal, 48h clocks, max 2 disputes). The flag and forfeit reasons are free text, and evidence lives outside the app for now.
- No refund of unused pool money at the end of an offer, and no pool top-up rules beyond the cap.
- No payout for a review of a purchase outside any offer (by design: no incentive, no payout).

## New gaps
39. Payouts are released lazily, on page loads. A payout is "due" from its `hold_until`, but shows as released only after someone loads a payouts page. Add a scheduled job before scale.
40. Unused pool money and end-of-offer settlement are not built (MER-06 says "maximum deposit, not expected spend").
41. RES-01 Resolution threads are not built. Until then, admins should keep evidence for every flag or breach forfeit outside the app and put a pointer in the reason.
42. The admin payouts page shows the person's email so they can be paid by hand. Keep that page to the team (the allowlist).
43. Clawback of a released payout on a late return is undecided (HON-09). The code refuses a "returned" forfeit after the window.

## Backend status
Tickets 1–8 are done. All open gaps are 1–43 across the handovers.

Next, per the plan: styling and rebrand (STITCH-UI-01 as a visual reference only), plus the outstanding product items: FR-01 account deletion, FR-03/04 per-review privacy, FR-23 product pages, FR-25 admin tools and RES-01 Resolution, MER-07 merchant replies, FR-12 video, FR-15 edit-with-history, HON-06 pattern flags, and the template clean-up (gaps 1–3, 24).
