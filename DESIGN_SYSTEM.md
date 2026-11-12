# TruFolks Core — Design System (LOCKED)

Locked by Jack on 11 November 2026. Every screen, component and Google Stitch import uses these tokens and nothing else. Changing a token is a decision for Jack, not a styling tweak.

**Where it lives**
- Tokens: `src/styles.css` (`@theme`). Tailwind's built-in palette is switched off (`--color-*: initial`), so only these colours exist as classes.
- Guardrail: `src/lib/design-system.test.ts`, part of `npm test`. It fails if a token changes value, the built-in palette is switched back on, a banned colour appears in `src/` or the favicon, or a hex colour that isn't in this palette is used.
- App shell: `src/routes/__root.tsx` sets `theme-color` #0F2A44 and the body to `bg-canvas font-sans text-primary`, and loads Inter.

## Colour tokens

| Token | Hex | Tailwind classes | Use for |
|---|---|---|---|
| `--color-primary` | `#0F2A44` | `bg-primary` `text-primary` `border-primary` | **Dominant Navy.** Primary buttons, headings, key text, default body text |
| `--color-tertiary` | `#0A1F33` | `bg-tertiary` `border-tertiary` | **Deep Navy.** Dark surfaces (footer, dark panels), strong borders |
| `--color-secondary` | `#2563EB` | `bg-secondary` `text-secondary` `ring-secondary` | **Royal Blue.** Interactive accents, links on light surfaces, focus rings, active/selected states, the main call to action |
| `--color-neutral` | `#5B6B7C` | `text-neutral` `border-neutral/30` | **Slate.** Secondary text, captions, muted icons, dividers |
| `--color-canvas` | `#F2F1E9` | `bg-canvas` `text-canvas` | **Warm Cream.** Page background; text on dark surfaces |
| `--color-surface` | `#FFFFFF` | `bg-surface` | Cards, sheets, inputs |
| `--color-amber` | `#B45309` | `text-amber` `border-amber` | Attention: flagged / on hold |
| `--color-crimson` | `#B91C1C` | `text-crimson` `border-crimson` | Errors, forfeited, destructive actions |
| `--color-white` / `--color-black` | `#FFFFFF` / `#000000` | `text-white` … | Text on Royal Blue / Navy fills; overlays |

Opacity modifiers are fine (e.g. `bg-secondary/10` for a pale blue highlight panel, `text-canvas/80` on dark surfaces).

**Amber is `#B45309`.** The brief named "Amber" without a hex; this value was chosen for legibility on cream (about 4.6:1). Change it here and in the test if Jack picks another.

## Typography
- `--font-sans`: **Inter** (Google Fonts, weights 400–900), falling back to ui-sans-serif and system-ui.
- Headings use `text-primary`, body text `text-primary`, secondary text `text-neutral`.
- `--radius: 0px`: square corners by default.

## Status colours (payouts, purchases)
Use the status tokens (`text-status-*`, `bg-status-*/10`, `border-status-*`) for badges, always with a text label: colour is never the only signal.

| State | Token | Colour | Where |
|---|---|---|---|
| Pending (receipt being checked) | `--color-status-pending` | Slate | Scan page, admin purchases |
| Held (return window) | `--color-status-held` | Slate | `/rewards`, admin payouts, dashboard |
| Ready (released) | `--color-status-ready` | Royal Blue | `/rewards`, admin payouts |
| Paid | `--color-status-paid` | Navy | `/rewards`, admin payouts |
| Flagged / on hold | `--color-status-flagged` | Amber | `/rewards`, admin payouts |
| Forfeited / turned down | `--color-status-forfeited` | Crimson | `/rewards`, admin payouts, scan page |

**Ratings are never colour-coded.** A 1-star and a 5-star review look the same apart from the stars (PAY-01 spirit: no visual praise or penalty).

## Interaction
- Focus: a 2px Royal Blue outline with a 2px offset on every focusable element (`:focus-visible` in base styles). Don't remove it.
- Primary button: `bg-primary text-white`, or `bg-secondary text-white` for the single main call to action on a screen.
- Secondary button: `border border-primary text-primary bg-surface`.
- Destructive: `text-crimson border-crimson`.
- Links: `text-secondary underline` on light surfaces; `text-canvas underline` on dark.

## Compliance blocks (must stay visible, never styled away)
- The disclosure block on every review card (LEG-01): full-size text, never collapsed, hidden or greyed below `text-neutral`.
- The rating-blind statement (HON-02) and the PAY-08 formula line on the scan and review pages.
- The MER-02 statement and MER-07 walkthrough on the merchant dashboard.

## Banned
- **No green anywhere in the app**: no green, emerald, lime, teal, olive or chartreuse, and no yellow. That rules out green "success" states too: Paid is Navy and Ready is Royal Blue.
- The legacy tokens `ink`, `cream`, `moss`, `sage` and `lime` (the v1.5 palette) are removed. Use the tokens above.
- No hard-coded hex colours in components. Add a token here first, if Jack approves.

## For Google Stitch
Paste this block into every Stitch prompt:

> Colours: Navy #0F2A44 (primary, headings, buttons), Deep Navy #0A1F33 (dark surfaces), Royal Blue #2563EB (accents, links, focus, main CTA), Slate #5B6B7C (secondary text, dividers), Warm Cream #F2F1E9 background, white #FFFFFF cards, Amber #B45309 (on hold), Crimson #B91C1C (errors / not paid). Font: Inter. Square corners. No green or yellow anywhere. Ratings are not colour-coded.

Stitch output is a visual reference only (STITCH-UI-01): rebuild screens with these tokens, don't paste exported colours.

## Known leftovers outside `src/`
- `public/favicon.svg` has been recoloured to Navy and Royal Blue, and the site header now uses it as the logo.
- `public/trufolks-mark.png` (old lime logo) is no longer used anywhere. Delete it when the brand assets are redone.
- `public/og.jpg` (the share card) is from the v1.5 era and may contain the old lime. Images aren't checked by the test, so replace it with the new brand assets.
- `public/review-phone.png` is a photo, not a brand colour.
