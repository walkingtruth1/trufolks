# TruFolks — Builder Handover (after Ticket 7) → Ticket 8

Date: 11 November 2026 · Owner: Jack · Spec: BRD v1.6
Branch: `feat/foundation-v1.6` (never commit to `main`, never merge, never deploy)
Read first: `trufolks-handover-ticket3b2.md` (stack, conventions, guardrails, gaps 1–17), `trufolks-handover-ticket5.md` (gaps 18–23), `trufolks-handover-ticket6.md` (gaps 24–28) and `trufolks-handover-ticket7.md` (gaps 29–33). This note adds only what changed.
Ticket 7 is written to the repo, not yet committed (Jack commits).

## Check status after Ticket 7
- `npm run typecheck`: clean. ESLint on every new and changed file: clean.
- `src/` tests: **208/208** (19 files). 14 are new in `src/lib/config/config.test.ts`; `merchants.test.ts` now loads 0009 and checks the cap figures and the too-long refusal.
- `scripts/` tests: unchanged (184/197 on Windows, gaps 1 and 24).
- `npm.cmd run build:dev`: passes and adds `/admin/settings` to `src/routeTree.gen.ts`.
- Smoke check (dev server): a scan request ran all migrations including 0009, passed the settings check, and returned the plain code message. `/admin/settings` renders signed out. No `[config]` or SQL errors in the server log. The signed-in admin and settings flows were not clicked through in a browser. They are covered by the tests.

## Decisions (Jack, 11 Nov 2026)
1. **Contacts see reviews only after lawyer sign-off.** A disclosure is `complete` only when the amount is known AND `disclosure.wording_approved` is on. Turning it on is logged, and waits 24h while an offer is live. Earlier reviews are then finished with **Finish earlier disclosures** on `/admin/settings` (gap 21).
2. **Cap = claims + pool.** A new claim is refused (`campaign_full`) when either:
   - claims not turned down reach `campaign.max_reviews`, or
   - rewards owed plus pending would pass `campaign.pool_cents`. Owed rewards use the confirmed amount; pending ones use the typed amount.

## CFG ID map (BRD §20A; the PDF text interleaves the columns)
| ID | Setting | Scope |
|---|---|---|
| CFG-01 | Immutable toggle log; startup validation with reject-and-fallback | — |
| CFG-02 | New settings = new JSON keys; no core table changes | — |
| CFG-03 | `payout.*` (PAY-08: `percent_bp` 2000, `floor_cents` 200, `cap_cents` 1500, `currency`, `hold_days` 14) | offer |
| CFG-04 | `campaign.*` (`max_reviews` 50, `max_days` 14, `pool_cents` 25000) | offer |
| CFG-05 | `eligibility.types` = ["A"] (Type B refused: payout undecided) | offer |
| CFG-06 | `review_format.*` (text always qualifies; video optional; no video tier) | offer |
| CFG-07 | `visibility.scope` = contacts_only (nothing else is built) | global |
| CFG-08 | `funding.*` (merchant prefunded, fee waived) | offer |
| CFG-09 | `split_test.*` (merchant or cohort, never individual) | offer |
| CFG-10 | `disclosure.*` (wording lines with {merchant} {percent} {floor} {cap} {amount}; `wording_approved`) | global |
| CFG-11 | `fraud.*` (three locked switches + code lifetime and rate limits) | global |
| CFG-12 | Guardrails, refused by `validate.ts` with `guardrail: true` | — |
| CFG-13 | Offer settings pinned per offer; global changes wait 24h while an offer is live | — |

**Correction:** Ticket 6 comments called Type A "CFG-11"; it is **CFG-05**. The TypeScript comments are fixed. The comment in the already-committed `migrations/0008_merchant_dashboard.sql` was left as-is, because applied migrations are never edited.

## Ticket 7 — what exists
- `migrations/0009_config_presets.sql`:
  - `config_versions`: one JSON document per version. A row never changes, except once from `accepted` to `rejected`. It is seeded with `pilot-preset-1`, which must equal `PILOT_PRESET` (a test checks this).
  - `config_log`: append-only. Records seeded / changed (one row per setting: who, key, old, new, why, cooling-off start, effective time) / refused / rejected_at_startup / disclosures_completed.
  - `trufolks_effective_config()` and `trufolks_campaign_config(campaign)`. The second returns the offer's pinned version, or if that was rejected, the last valid version created before it.
  - `campaigns.config_preset_id`: now a foreign key. Set automatically on insert, can't change afterwards. Existing offers were pinned to `pilot-preset-1`.
  - `trufolks_create_config_version`: one pending version at a time. 24h cooling-off applies only when visibility, disclosure or fraud changed **and** an offer is live.
  - `trufolks_reject_config_version` and `trufolks_log_config_refusal`.
  - **`trufolks_pay08_reward(order, bp, floor, cap)`**, rounded to the nearest cent; no rating parameter, and a test checks this. `trufolks_purchase_reward(purchase)` uses the **confirmed** receipt amount and the offer's pinned formula.
  - `trufolks_campaign_room(campaign, extra)`; `trufolks_receipt_code_problem` now returns `campaign_full`. The trigger `verified_purchases_cap_guard` is a race-proof backstop (`TRUFOLKS_CAMPAIGN_FULL`, mapped to `campaign_full` in `claimCode`).
  - `trufolks_admin_create_offer`: replaced. The offer type comes from settings, length is capped by `max_days` (new outcome `too_long`), and the offer is pinned.
  - **Disclosure v2** (`trufolks_review_disclosure`): carries the formula, `amount_cents`, the wording (version, approved, lines) and `config_version_id`.
  - `trufolks_submit_review`: replaced; new outcome `amount_not_set` (gap 20).
  - `trufolks_reviews_locked`: replaced. The only disclosure change allowed is incomplete → complete, filling in reward, wording and version, with every other fact identical (`trufolks_disclosure_completion_ok`).
  - `trufolks_complete_review_disclosure` and `trufolks_complete_pending_disclosures`, both logged. `review_events` gains `disclosure_completed` and `actor_user_id`.
- `src/lib/config/`:
  - `preset.ts`: `AppConfig`, `PILOT_PRESET`, `pay08Reward`, `formulaText`.
  - `validate.ts`: strict validation, guardrails, `diffConfig`.
  - `fields.ts`: the settings form.
  - `engine.ts`: `checkStoredConfig`, `loadEffectiveConfig`, `loadCampaignConfig`, `saveConfig`, `getSettingsAdminView`, `finishPendingDisclosures`, `codeLimitsFrom`, `offerRoom`.
  - `runtime.ts`: `getConfiguredSql()` runs the startup check on first use per process and then every minute. It never throws; if the check fails it uses the built-in preset.
  - `messages.ts`, `server-fns.ts` (admin only), `config.test.ts`.
- Wiring:
  - Receipt scan, claim and generate read the fraud limits from settings. The rate-limit message no longer names a number of minutes.
  - **The scan page shows the offer's formula before buying.**
  - The review page shows "What you get back: $X" and blocks writing if the amount is unknown.
  - The merchant dashboard shows reviews left and budget left. "Paid back so far" stays "Not set yet" until Ticket 8.
  - `/admin/merchants` offers follow settings.
  - New page **`/admin/settings`**: what's in force, any pending change, rejected versions, a form (offer settings and global settings, locked ones read-only), a required reason, the log, and Finish earlier disclosures.
- Kept as code constants (technical, not business rules): photo and header bytes, photo retention, text lengths, page sizes, codes per batch, device cookie age. `RECEIPT_CODE_LIMITS` is now only the fallback, and a test checks it matches the preset.

## What Ticket 7 did NOT do
- No payout records, holds, release or forfeit (Ticket 8). `payout.hold_days` and `funding.*` are stored but not used yet. There is no check that the merchant funded the pool (MER-06).
- No cancel-a-pending-change button. A pending change can only be waited out (gap 34).
- The FR-14 preview shows the wording in force when the person writes. If the lawyer later changes the words, the finished disclosure uses the approved words; the facts (formula and amount) stay the same (gap 35).
- No public visibility, Type B, video, or split-test assignment logic. These are stored or refused only (§20B).

## New gaps
34. A pending settings change can't be cancelled; it blocks other changes for up to 24h.
35. The disclosure words can differ between the writer's preview and the finished disclosure if the wording changes before approval. The amount and formula never change.
36. The cap counts the typed amount for pending claims. A buyer who types a huge amount can use up pool room until an admin confirms the real amount. Admins should check pending claims promptly.
37. Startup validation runs on first use per server process and then every minute, not at deploy time. A bad direct database write is caught on the next request. Consider also running `checkStoredConfig` in `scripts/migrate.mjs`.
38. `merchants.test.ts` and `config.test.ts` disable some triggers in test-only steps, to simulate direct writes. Production code never does.

## Ticket 8 — inputs ready for it
- `trufolks_purchase_reward(purchase)` gives the amount (confirmed receipt amount × the offer's pinned formula).
- `payout.hold_days` (HON-09 return window) and `funding.*` are in the offer's pinned settings (`loadCampaignConfig`).
- `review_events` and `verified_purchases` carry everything needed to qualify a payout. Payout records must stay decoupled from reviews (FR-27) and never read the rating (PAY-01).
- The merchant dashboard has a "Paid back so far" slot waiting.

## Remaining tickets
8 Payout ledger (PAY-08 amounts, HON-09 hold / release / forfeit, FR-20 reward status visible to the customer, FR-22 logging, MER-06 pool) — the last backend ticket. Styling and rebrand come after.
