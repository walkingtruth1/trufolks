# TruFolks — Builder Handover (v1.7: My Profile, My Top 5, Shop, catalog, landing)

Date: 13 November 2026 · Spec: BRD v1.7 §7–9 · Branch: `feat/profile-v1.7` (from `feat/foundation-v1.6` at `2321ce7`)
Merge and production promotion stay manual.

## Owner decisions (13 Nov 2026)
1. Homepage headline stays **"Find something worth trying."** "Share your top recommendations." is NOT shipped; it stays in the Stitch concept for owner review. The Stitch Merchant Offer Terms Preview stays out.
2. How It Works stays a separate route (`/how-it-works`).
3. **Show in Shop** is a per-review owner control, off by default. A Top 5 pin does not add an item to Shop.
4. Editable name and bio: implemented. Editable avatar: open item under PRO-18-02.

## BRD ID cleanup (apply to the BRD on Drive)
The v1.7 §7 table reuses IDs. Proposed replacements so the checklist is unambiguous:

| v1.7 §7 row as written | New ID | Note |
|---|---|---|
| SOC-17-02 "My Top 5 by category" | **PRO-18-04** | Extends SOC-17-02 ("Handpicked Top 5", §3), which keeps its original meaning. Add "Extends SOC-17-02." |
| FR-23 "Shared product catalog" | **CAT-18-01** | FR-23 stays the v1.6 historical reference. Add "Supersedes the catalog scope of FR-23 (v1.6)." |
| FR-12 "Firsthand review and video" | **REV-18-01** | FR-12 stays the v1.6 historical reference. Add "Extends FR-12 (v1.6)." |

PRO-18-01..03, SHOP-18-01, MER-18-01 and MER-18-02 are unique and unchanged.

## Implementation checklist (v1.7 §7)
| ID | Status |
|---|---|
| PRO-18-01 Profile first | Done. Ordinary sign-in → `/profile`; `?next=` return paths kept (receipt, invite, merchant). Profile is the first signed-in tab; Add a review in the header. |
| PRO-18-02 Owner and visitor views | Done: editable display name and bio, stable URL `/u/<handle>`, audience preview, Friends-only default, explicit publish/unpublish. **Open: editable avatar** (initials only; needs file storage that works on Vercel). |
| PRO-18-03 Review entry and progress | Done: `/add-review` (receipt code + own purchases with status and next action); Rewards empty state → Claim a receipt. Verification, reward, preview, disclosure untouched. |
| PRO-18-04 Top 5 by category | Done: Products and Services, 0–5 each, keyboard reorder, persisted. |
| SHOP-18-01 Profile Shop | Done: Show in Shop per review (off by default), approved seller links only, rating and full disclosure on each listing, guest access when profile and review are both public. |
| CAT-18-01 Shared catalog | Done: brand / model / variant / category / verified release year / GTIN + MPN; identifier → normalized brand+model+variant matching; uncertain entries queued at `/admin/catalog`; corrections and merges; stable `/products/<slug>`. |
| REV-18-01 Firsthand review and video | Text unchanged from Ticket 4. Video not built (open product decisions). |
| MER-18-01 Attribution | Not built. Ready: review, product, brand, seller offer and link ids are separate. |
| MER-18-02 Bids and referral earnings | Not built (later). Seller links already carry a separate referral-commission disclosure. |

## What exists
- `migrations/0011_profiles_top5_catalog.sql`: `profiles` (handle locked), `profile_events` (append-only), THE read rule (`trufolks_viewer_relation`, `trufolks_profile_visible`, `trufolks_visible_reviews`), sharing switches, `top_picks`, `catalog_brands`, `catalog_products`, `seller_offers`, `review_products`, `catalog_corrections`, `shop_items`, display-name / bio / Shop setters.
  **Never edit 0011 after it has run on a shared database. Add `0012_…` instead.**
- `src/lib/profiles/` engine, server functions, messages, `profiles.test.ts` (12 tests, in `npm test`).
- `src/lib/auth/optional-middleware.ts`: signed-in-or-guest reads; sets `Cache-Control: private, no-store`.
- Routes: `/profile`, `/u/$handle`, `/add-review`, `/reviews/$reviewId`, `/products/$slug`, `/admin/catalog`, `/how-it-works`; `/` is the minimal welcome and forwards old `/#how|terms|merchants|faq|receipt` bookmarks.

## Access rule (who sees what)
| Viewer | Profile | Reviews / Top 5 / Shop |
|---|---|---|
| Owner | always | everything (Shop: chosen + approved link) |
| Accepted friend | always | shareable reviews, Friends only or public |
| Blocked (either direction) | never | nothing |
| Other member / guest | only if profile published | only public shareable reviews |
Shop additionally needs the owner's Show in Shop choice and an approved seller link at read time.

## Gaps / follow-ups
- Editable avatar (PRO-18-02).
- Staging fixtures: two equivalent valid test receipts/codes, a full funded offer, an unfunded offer, approver access on the preview (`TRUFOLKS_ADMIN_USER_IDS`), Friends fixtures.
- Public reviews show the disclosure's per-review reward amount; with the formula, a reader can estimate spend. Owner to confirm.
- No search surface exists yet, so no search access check.
- Signup funnel metrics: no baseline recorded.
