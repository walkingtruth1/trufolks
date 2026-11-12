# TruFolks — Builder Handover (after Ticket 5) → Ticket 6

Date: 11 November 2026 · Owner: Jack · Spec: BRD v1.6
Branch: `feat/foundation-v1.6` (never commit to `main`, never merge, never deploy)
Read first: `trufolks-handover-ticket3b2.md` (stack, conventions, guardrails, gaps 1–17) and `trufolks-handover-ticket5.md` (Tickets 3b-2 and 4, gaps 18–23). This note adds only what changed.
Last commits: 4 `ac9378b`. Ticket 5 written to the repo, not yet committed (Jack commits).

## Check status after Ticket 5
- `npm run typecheck`: clean. ESLint on the new files: clean.
- `src/` tests: **190/190** (17 files, all in the `test` script; 17 new in `contacts.test.ts`).
- `scripts/` tests: 184/197 when run **on Windows**. 8 are the known Grok branding failures (gap 1). The other 5 (`with-app-env` wrapper and symlink tests) fail only on Windows. They passed when run from the Linux shell, and nothing in `scripts/` changed. On Windows that test file also leaves an empty file named `{}` in the repo root. Delete it, don't commit it (gap 24).
- `npm.cmd run build:dev`: passes and regenerated `src/routeTree.gen.ts` for the 3 new routes.
- Smoke check (dev server): `/contacts`, `/invite/<token>` and `/people/<id>` all render their signed-out state with no console errors. The signed-in flow was not clicked through in a browser. It is covered by the engine tests only.

## Decisions (Jack, 11 Nov 2026)
1. People become contacts **only through a private invite link** (FR-02). No address book, no email lookup, no searching for strangers (P5).
2. Contacts are **mutual**. Accepting makes both people contacts of each other. Removing removes both sides.
3. FR-18 = a **"Places your contacts reviewed"** list. There are no general results until visibility beyond contacts (CFG-07, Ticket 7).

## Ticket 5 — what exists
- `migrations/0007_contacts_feed.sql`:
  - `contact_invites`: only the SHA-256 of the token is stored. One working link per person (a new link turns the old one off). Lifetime comes from config. Owner, hash and dates can't change. Rows can't be deleted.
  - `contact_events`: append-only log of invite_created / invite_revoked / accepted / removed / blocked / unblocked.
  - Functions: `trufolks_create_contact_invite`, `trufolks_revoke_contact_invite`, `trufolks_contact_invite_status` (read-only preview), `trufolks_accept_contact_invite` (re-checks under a per-pair advisory lock), `trufolks_remove_contact`, `trufolks_block_contact` (current contacts only), `trufolks_unblock_contact` (doesn't reconnect).
  - **`trufolks_contact_reviews(viewer)` is THE visibility rule.** A review is returned only if: the two people are mutual accepted contacts, the author isn't deleted, the purchase is verified, and the stored disclosure has `complete = true` and `rating_blind = true` (LEG-01 / gap 19). The feed, the places list and other people's history all read from it. `engine.ts` also drops anything whose disclosure doesn't parse as complete.
  - `trufolks_mutual_contacts(viewer)`.
- `src/lib/contacts/`: `limits.ts` (CFG placeholders: invite link lasts 30 days, 20 reviews per feed page, 500 history max), `invite-token.ts` (node:crypto, server-only), `messages.ts`, `engine.ts`, `server-fns.ts`, `contacts.test.ts`.
- Blocking: the blocked person loses sight of you at once. Your invite link gives them a plain "doesn't work any more", so the block isn't revealed.
- Routes (plain, unstyled):
  - `/contacts`: your contacts' reviews, newest first, with "Show more". Each review uses the Ticket 4 `ReviewCard` and links to the person's history. Below that: places your contacts reviewed (`?place=<merchantId>` filters the feed), your invite link (shown once, copy button, make new / turn off) and your contacts (remove / block, plus unblock).
  - `/invite/$token`: signed out → sign in / create account with `?next=`. Signed in → who invited you and what accepting means → Accept.
  - `/people/$userId`: full history (FR-17), only your own or a contact's. Every rating is shown, with a count per star (HON-08). Your own page also lists reviews contacts can't see yet, marked as such.
- Ordering is newest first everywhere. No follower counts or ranking (FR-05, P6). There is a test that no follower or rank column exists.

## What Ticket 5 did NOT do
- **Contacts see nothing in practice until Tickets 7/8.** Every pilot review is rewarded, so `disclosure.complete` is false (gap 18). This is deliberate (gap 19). Only your own page shows your reviews today.
- No review privacy toggle per review (FR-03) and no "hide one item" (FR-04). Every review is `contacts` visibility. CFG-07 (public) is Ticket 7.
- No AI routing of reviews (AI-04). No address-book import. No notifications when someone accepts.
- No navigation links to `/contacts` from other pages yet (UI work is deferred).

## New gaps
24. On Windows, `scripts/with-app-env.test.mjs` fails 5 extra tests and leaves an empty `{}` file in the repo root. Template-cleanup ticket (with gap 1).
25. FR-25 (admin removal) and account deletion (gap 8) must add their condition to `trufolks_contact_reviews`. It is the single place to change.
26. Invite links can be forwarded: anyone holding a link can accept it while it works. Mitigations: the page warns people, links expire, and people can turn a link off, remove or block. Revisit if the pilot shows misuse.
27. FR-03 / FR-04 per-review privacy and hide-an-item are not built.
28. Port 8080 was taken on Jack's machine by another program during this session. If `npm.cmd run dev` says the port is in use, close that program first.

## Remaining tickets
6 Merchant dashboard (read-only; "own products only" scoping, gap 9; replace `/dev/seed`) · 7 Toggles CFG-01–CFG-13 + immutable audit log + startup validation (gaps 20, 21; CFG-07 visibility) · 8 Payout ledger (PAY-08, HON-09, decoupled from reviews).
