# TruFolks v1.9 handover: the gallery design

Work order: "TruFolks v1.9 — final design work order" (owner, 13 Nov 2026).
This is a visual and UX release. It adds **no migration** and changes no server rule.

Branch: `feat/design-v1.9`, built on `feat/profile-v1.7` at `e93aa46` (PR #4).

## Base and dependency

`staging` is still at `8e517fb` (same as `main`). PR #4 has not merged. Every surface in this
work order lives only in PR #4: My Profile, `/u/<handle>`, Top 5, Shop, product pages and the
v1.8 receipt flow. So this branch starts from PR #4's head and its PR targets
`feat/profile-v1.7`, which keeps the diff to v1.9 files only. When PR #4 merges into `staging`,
GitHub retargets this PR to `staging` automatically (or retarget by hand). If PR #4 gets a Hold
fix, this branch is rebased onto the new head.

## What changed

| Area | Change |
|---|---|
| Design tokens | New `--color-action: #FFDE00` (`bg-action`), only for the single primary action, always with black text. `DESIGN_SYSTEM.md` and `src/lib/design-system.test.ts` updated: the colour is locked to that use. No other token changed; the header, footer and older app screens keep TruFolks Core. |
| Home `/` | Split composition. Left: "Find something worth trying.", one trust line, one dominant **Get started** (signed in: **Go to My Profile**), with How it works, Log in and Have a receipt? secondary. Right: one example still at a time (Hario V60 pour-over, customer checking an auto detail), with a short unboxed caption labelled "Example · Product/Service". **Product example / Service example** buttons (`aria-pressed`, arrow keys, visible selected state), and sideways swipe on touch. No autoplay. On phones the headline and action come first. Old `/#how`-style links still forward to `/how-it-works`. |
| Public profile `/u/<handle>` | White page, black type. Identity first (initials, name, bio, quiet **Share**: the phone share sheet on touch devices, else copy link). In-page links to Top 5, Shop and All reviews. **Products / Services** switch, then one large featured pick (picture, category, item, business, excerpt of the reviewer's own words, rating, Verified purchase, **Read review**, and Where to buy or View service when the item has an approved catalog record), then up to four smaller picks. Empty list, one pick and missing pictures each have their own state. Shop and All reviews follow. The owner's preview bar is unchanged. |
| My Profile `/profile` | Opens like the visitor page: identity, **Add a review** as the one primary action, Share profile link, View as visitors see it, the same Top 5 gallery. All editing and audience controls are grouped under **Edit and share** (profile audience, preview as, Top 5 editor, Shop with Show in Shop). All reviews with each review's audience and product details stays below. |
| Product page `/products/<slug>` | Desktop: picture and the relevant review on the left; item identity (brand or business, model or service, variant, verified release year) and **Where to buy** on the right. Phones: item, review, seller links, in normal flow. `?from=<handle>&review=<id>` (set by profile links) puts that reviewer's review first, adds a breadcrumb and "Back to their profile". The review card keeps rating, Verified purchase and the full disclosure together. Seller links keep their referral disclosure. Services say **View service** or **Visit business**. No seller: "No approved sellers yet…". Guests still get the page when a review of it is public. |
| Review page | White page tone. The product link now carries `?from` and `?review`. |
| Pictures | `src/lib/catalog/images.ts`. The catalog has no image field, so real entries show the designed no-image state. `APPROVED` is where owner-approved pictures for real records go. `SAMPLES` (Stitch stills) are opt-in on a dev server (`VITE_TRUFOLKS_SAMPLE_IMAGES=1`), never in a build. Any picture that fails to load falls back to the no-photo state. |

## Assets

- `public/examples/home-product-v60-pour-over.jpg` (44 KB) and
  `public/examples/home-service-auto-detail.jpg` (58 KB): the two owner-chosen Stitch stills,
  downloaded with the owner's OK from the Stitch export. Both are 512×382, the size Stitch
  serves; they look slightly soft on large retina screens. A higher-resolution original or a
  commissioned photo would be a straight file swap.
- `public/qa-samples/` (git-ignored, local only): 6 Stitch product stills used for QA sample
  picks. Opt-in: only a dev server started with `VITE_TRUFOLKS_SAMPLE_IMAGES=1` uses them. The 5 service stills in the export no longer load, so services show the no-image state.
- No prototype switches, sample metrics, receipt IDs, scores, prices, stock or shipping claims.

## Checks

- `npm test`: 240/240 (the design-system guardrail now locks `--color-action`). `npm run typecheck`
  and `npm run build`: pass. Lint: no new errors (one react-refresh warning in `gallery.tsx`, the
  same kind `ui.tsx` already has).
- Built JS contains no reference to `qa-samples/`: the sample stills never reach a build.
- Local browser QA (Edge via Playwright, in-memory dev database, fixtures made through the real
  flows: receipt-only reviews, admin approval, product details, catalog and seller approval,
  Top 5, Show in Shop, audiences). 23 screenshots in `screenshots/v1.9/`, no console errors, no
  sideways scroll at 1440, 390 or 320:
  - Home: both example states at 1440 and 390; arrow keys move between the two buttons and
    select; a touch swipe on the picture switches it; 320 px header fits (signed out, signed in,
    profile).
  - Profile, signed-out visitor: Products and Services at 1440 and 390. Member A pinned 5
    services but one review is Friends only: guests see 4, the owner's "preview as a friend"
    sees 5.
  - Owner My Profile at 1440 and 390 (gallery, then Edit and share).
  - Sparse and long text (member B: one pick, long name, bio and review, no photo, no seller) and
    no picks (member C) at 1440 and 390.
  - Product page reached from the profile (`?from&review`), 1440 and 390, with the reviewer's
    review first, Back to their profile and the full disclosure; service page shows
    "View service"; the no-seller state at 1440 and 390.
- Not checked locally: the Vercel preview (production build) — see the handoff for its smoke result.

## Staging fixtures for Codex

The preview database is shared with PR #4's QA, so nothing was written to it. The preview shows
whatever profiles already exist there. To see the gallery with five picks per list, a member
needs five shareable reviews in each list (receipt-only reviews work), product details approved
in `/admin/catalog`, and the picks pinned in **Edit and share**. Pictures only appear on a local
dev server (real entries show "No photo yet" on staging by design).

## Optional video and brand reuse: separate scope (not in this PR)

Nothing in this PR reserves space for video; the review card and product page work without it.

**Feature: one optional short video on a written verified review.**
1. Only on a review that is already a Verified purchase; the written review stays required.
2. One clip, max 60 s and about 100 MB, uploaded to private storage (Vercel Blob or Mux).
   Never shown before processing and moderation.
3. Processing: transcode, strip location metadata, poster frame, auto captions the reviewer
   can correct before publishing. Captions required to publish.
4. Moderation queue in admin (approve, reject with reason). Rejected clips are deleted.
5. Playback only on request (tap to play, no autoplay, muted until unmuted), with captions on.
6. Same audience rule as the review (Friends only or public), enforced on the server for the
   signed URL. The receipt photo and any receipt detail never appear in or beside the video.
7. Removal: the reviewer can delete the clip at any time; deleting the review deletes the clip.
8. Needs: a migration (`review_videos`), a storage provider, moderation policy text, and an
   accessibility review. Estimate: one ticket for upload/processing, one for moderation and
   playback, one for audience enforcement tests.

**Plan: optional brand reuse licensing (needs its own approval before any build).**
- A brand can ask to reuse a reviewer's video or words (for example on its own site). The
  reviewer decides; no is the default and has no effect on anything else.
- Each request states: what is reused, where (channels), for how long (fixed end date), the fee,
  and that the reviewer can see every use. The reviewer accepts or declines in TruFolks.
- The licence fee is separate from, and never linked to, the rating-independent receipt reward.
  It is offered only after a review is posted, never for a rating, and the same whatever the
  rating. The review page does not change because of a licence.
- TruFolks records consent, terms and expiry; on expiry or withdrawal (where the terms allow),
  the brand must stop new uses.
- Needs legal review (licence terms, tax reporting for fees), payments scope, and a disclosure
  line on reused content ("Shared by the reviewer under a paid licence").
- Real uploads, licensing offers and payments all need their own approved scope.

## Codex Hold on PR #5: fixes (commit after `be6e0b1`)

| Finding | Fix | Verified |
|---|---|---|
| Pinned review links only worked inside the 100 newest reviews | `getProductPage` takes the linked `reviewId` and, when it isn't in the list, fetches it on its own through the same read rule, product link, shareable and disclosure checks (`productReviews`). The page returns `leadReviewId`; the client leads with it. | New engine test: with the list limited to 1, Ana's older public review still leads and keeps her profile link; Cat's Friends-only review never leads for a guest but does for her friend; a review of another product or an unknown id is ignored. Browser: the featured pick's link opens with that review first and "Back to their profile". |
| Product heading came after the review in the DOM | DOM order is now heading, picture, review, Where to buy. Desktop keeps two columns through grid placement (`lg:col-start-8`, `lg:row-start-*`). | Fresh-checkout browser run: DOM order heading → review → sellers; on phones the same order top to bottom; Tab order header → breadcrumb → Back to their profile → review links → seller links → join box, at 1440 and 390. |
| Gallery ratings were `aria-label` on plain spans | Each rating has readable `Rated N out of 5` text; stars and the visual `N/5` are `aria-hidden`. Same change in the shared `Stars` and the review card. | 16 readable ratings per profile, no `aria-label` ratings left there, every star glyph inside `aria-hidden`; the accessibility tree for the featured pick reads "Rated 5 out of 5". |
| Missing sample images broke pictures | Samples are opt-in (`VITE_TRUFOLKS_SAMPLE_IMAGES=1` on a dev server). `PickPicture` falls back to the no-photo state on `onError`, and on mount for a picture that failed before hydration. | A fresh `git worktree` of the fix commit (no `public/qa-samples/`), run with the flag ON: 0 broken images, 5 no-photo tiles where the samples would have been, at 1440 and 390. Screenshots: `screenshots/v1.9/retest/` (local). |

Checks: `npm test` 241/241, typecheck and build pass; lint has only the two known errors in
untouched files. Merchant-page ratings (`/merchant`) still use `aria-label`: outside this PR.

