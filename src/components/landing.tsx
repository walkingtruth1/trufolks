// Public homepage (WEB-17-01), ported from the Stitch homepage export
// (design/stitch: desktop 1440 and mobile 390 frames). Layout, proportions,
// type scale and stacking follow the export; colours are TruFolks Core tokens
// (DESIGN_SYSTEM.md) and the copy is the approved BRD copy.
//
// Rules kept from the BRD: lead with discovery; no fixed prices, formula
// examples or projected outcomes; no search until DISC-17-01; no "pilot" in
// public copy (shoppers: "offer" / "participating business"; merchants:
// "first campaign"). Exact rewards come from each campaign on the receipt and
// review pages.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  BadgeCheck,
  Clock,
  Eye,
  ReceiptText,
  Scale,
  ScanLine,
  ShieldCheck,
  SquareCheck,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/site-chrome";

/* Type scale from the export's Tailwind config (DESIGN.md "Editorial Modern"). */
const t = {
  hero: "text-[28px] leading-9 tracking-[-0.02em] font-bold md:text-[52px] md:leading-[60px] md:tracking-[-0.03em]",
  h2: "text-2xl leading-8 tracking-[-0.015em] font-bold md:text-[40px] md:leading-[48px] md:tracking-[-0.025em]",
  h3lg: "text-[24px] leading-8 font-bold tracking-[-0.015em] md:text-[32px] md:leading-10 md:tracking-[-0.02em]",
  h3sm: "text-xl leading-7 font-bold tracking-[-0.01em]",
  title: "text-base leading-6 font-bold tracking-[-0.005em]",
  bodyLg: "text-[15px] leading-6 md:text-lg md:leading-7",
  body: "text-[15px] leading-6",
  small: "text-[13px] leading-5",
  label: "text-xs leading-4 font-semibold tracking-[0.06em] uppercase",
  labelSm: "text-[11px] leading-[14px] font-medium tracking-[0.05em] uppercase",
};

/* Cards: the mobile frame uses a 2px navy border with a hard offset shadow;
   the desktop frame uses a hairline border with a soft shadow. */
const card =
  "bg-surface border-2 border-primary shadow-[4px_4px_0_0_var(--color-primary)] md:border md:border-neutral/25 md:shadow-sm";
const panel = "bg-secondary/[0.06] border border-secondary/15";
const wrap = "mx-auto w-full max-w-[1440px] px-4 md:px-8";

function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`${t.label} font-bold text-secondary ${className}`}>{children}</p>;
}

export function Landing() {
  return (
    <Shell>
      <main className="w-full flex-1 pt-16 md:pt-20">
        <StatusStrip />
        <div className={wrap}>
          <Hero />
          <Pillars />
        </div>
        <MobileDivider />
        <HowItWorks />
        <MobileDivider />
        <OfferTerms />
        <MobileDivider />
        <Merchants />
        <MobileDivider />
        <Faq />
        <ReceiptLookup />
      </main>
    </Shell>
  );
}

function MobileDivider() {
  return <div className="w-full border-t-2 border-primary md:hidden" />;
}

/* ---------- Status strip (desktop anchor strip / mobile dark bar) ---------- */
function StatusStrip() {
  return (
    <>
      <div className="w-full border-b-2 border-primary bg-primary px-4 py-1 text-center md:hidden">
        <p className={`${t.labelSm} inline-flex items-center gap-1 text-white`}>
          <span className="inline-block h-2 w-2 bg-secondary" aria-hidden="true" />
          Offers at participating local businesses
        </p>
      </div>
      <div className={`${wrap} hidden md:block`}>
        <div className="my-6 flex flex-wrap items-center justify-between gap-4 border border-neutral/25 bg-surface p-4 shadow-sm">
          <p className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 bg-secondary" aria-hidden="true" />
            <span className={`${t.label} font-bold`}>Offers at participating businesses</span>
            <span className={`${t.small} hidden text-neutral lg:inline`}>
              — Verified purchases, honest reviews, friends first
            </span>
          </p>
          <nav aria-label="On this page" className={`${t.label} flex items-center gap-6`}>
            <a href="#how" className="hover:text-secondary">
              [ 01. How it works ]
            </a>
            <a href="#terms" className="hover:text-secondary">
              [ 02. Offer terms ]
            </a>
            <a href="#merchants" className="hover:text-secondary">
              [ 03. For merchants ]
            </a>
            <a href="#faq" className="hover:text-secondary">
              [ 04. FAQ ]
            </a>
          </nav>
        </div>
      </div>
    </>
  );
}

/* ---------- Hero: 7/5 editorial split ---------- */
function Hero() {
  return (
    <section className="mb-10 grid grid-cols-1 items-stretch gap-4 pt-6 md:gap-6 md:pt-0 lg:grid-cols-12">
      {/* Left: copy and actions */}
      <div className="flex flex-col justify-between md:border md:border-neutral/25 md:bg-surface md:p-10 md:shadow-sm lg:col-span-7">
        <div>
          <div className="mb-1 flex items-center gap-2 md:mb-4">
            <span className={`${t.labelSm} hidden bg-primary px-2 py-1 text-white md:inline-block`}>
              Verified purchases
            </span>
            <span className={`${t.labelSm} hidden text-neutral md:inline`}>Friends first</span>
            <span className={`${t.label} font-bold text-secondary md:hidden`}>
              [ Verified purchases · Friends first ]
            </span>
          </div>
          <h1 className={`${t.hero} mb-2 text-primary md:mb-6`}>Find something worth trying.</h1>
          <p className={`${t.bodyLg} max-w-xl text-neutral md:mb-10`}>
            See what your friends actually bought and what they really thought. Every review on
            TruFolks starts with a verified purchase — and low ratings count just as much as high
            ones.
          </p>
        </div>
        <div className="hidden border-t border-neutral/25 bg-secondary/[0.06] p-6 md:block">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <a
              href="#how"
              className={`${t.title} inline-flex items-center gap-2 bg-secondary px-10 py-4 font-semibold text-white shadow-sm hover:bg-primary`}
            >
              See how it works
              <ArrowDown aria-hidden="true" size={18} />
            </a>
            <a
              href="#merchants"
              className={`${t.label} inline-flex items-center border border-primary/20 bg-surface px-4 py-2 hover:text-secondary`}
            >
              For merchants ↓
            </a>
          </div>
          <p className={`${t.small} mt-4 flex items-center gap-2 text-neutral`}>
            <BadgeCheck aria-hidden="true" size={18} className="text-secondary" />
            Every review starts with a verified purchase · Same reward at any rating
          </p>
        </div>
      </div>

      {/* Right: image and upfront card */}
      <div className="flex flex-col gap-4 md:gap-6 lg:col-span-5">
        <figure className="relative w-full overflow-hidden border-2 border-primary bg-primary md:aspect-[4/3] md:border md:border-neutral/25 md:shadow-sm">
          <img
            src="/coffee-shop-receipt.jpg"
            alt="A shopper in a coffee shop smiling at her receipt"
            width={1448}
            height={1086}
            className="block h-72 w-full object-cover object-center md:h-full"
          />
          <figcaption className="absolute right-0 bottom-0 left-0 flex items-center justify-between bg-primary/95 px-4 py-1 text-white md:py-2">
            <span className={`${t.labelSm} tracking-[0.1em]`}>Verified purchase</span>
            <span className={`${t.labelSm} normal-case text-canvas/75`}>Receipt checked</span>
          </figcaption>
        </figure>

        <div className={`${card} flex flex-1 flex-col justify-between p-4 md:p-6`}>
          <div>
            <div className="mb-2 flex items-center justify-between border-b border-primary/20 pb-2 md:border-0 md:pb-0">
              <span className={`${t.label} text-primary md:tracking-[0.1em] md:text-neutral`}>
                Shown upfront
              </span>
              <span
                className={`${t.labelSm} bg-primary px-2 py-0.5 font-bold text-white md:bg-secondary/10 md:text-primary`}
              >
                Every offer
              </span>
            </div>
            <h2 className={`${t.h3lg} my-2 text-primary`}>See the offer before you buy.</h2>
            <p className={`${t.small} mb-4 text-neutral`}>
              A participating business shows its TruFolks offer and who it’s for before you pay.
              Your receipt page repeats the same terms.
            </p>
          </div>
          <div className="border border-secondary/30 bg-secondary/10 p-4 md:border-0 md:bg-primary md:text-white">
            <p className="flex items-center gap-2">
              <ShieldCheck
                aria-hidden="true"
                size={18}
                className="text-secondary md:text-canvas/80"
              />
              <span className="text-base leading-6 font-bold md:text-xs md:leading-4 md:tracking-[0.06em] md:text-canvas/85 md:uppercase">
                Same reward at any rating
              </span>
            </p>
            <p className={`${t.small} mt-1 text-neutral md:text-canvas/85`}>
              One star or five, every qualifying review of the same purchase earns the same reward.
              Honest feedback is all that counts.
            </p>
          </div>
          <a
            href="#how"
            className={`${t.title} mt-4 inline-flex items-center justify-center gap-2 bg-secondary px-6 py-3 font-semibold text-white md:hidden`}
          >
            See how it works
            <ArrowDown aria-hidden="true" size={18} />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------- Four pillars bar (desktop only in the export) ---------- */
function Pillars() {
  const items = [
    {
      icon: BadgeCheck,
      title: "Verified purchases",
      body: "Every review starts with a checked receipt",
      blue: false,
    },
    {
      icon: Scale,
      title: "Same reward at any rating",
      body: "Low ratings count as much as high ones",
      blue: true,
    },
    {
      icon: Users,
      title: "Friends first",
      body: "Reviews from people who accepted your invite",
      blue: false,
    },
    {
      icon: Wallet,
      title: "Rewards you can track",
      body: "Held, ready or paid — shown on your rewards page",
      blue: false,
    },
  ];
  return (
    <section className="mb-10 hidden border border-neutral/25 bg-surface shadow-sm md:block">
      <ul className="grid grid-cols-2 divide-neutral/25 lg:grid-cols-4 lg:divide-x">
        {items.map((it, i) => (
          <li key={it.title} className={`p-6 ${i % 2 === 1 ? "bg-secondary/[0.06]" : ""}`}>
            <it.icon aria-hidden="true" size={22} className="mb-2 text-secondary" />
            <span className={`${t.h3sm} mb-1 block ${it.blue ? "text-secondary" : "text-primary"}`}>
              {it.title}
            </span>
            <span className={`${t.small} block text-neutral`}>{it.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- How it works: three steps ---------- */
function HowItWorks() {
  const steps = [
    {
      n: "01",
      icon: Store,
      title: "Check the participating business’s offer before you buy.",
      body: "Look for the TruFolks offer at the counter, on the window or at checkout. It shows the reward and who it’s for.",
      boxTitle: "Before you pay:",
      box: ["See the offer first", "Keep the TruFolks code you get with your receipt"],
    },
    {
      n: "02",
      icon: ScanLine,
      title: "Claim your receipt and write an honest review.",
      body: "Scan the code or type it in and add a photo of your receipt. Once it’s confirmed, say what stood out.",
      boxTitle: "Your review:",
      box: ["Three short written answers", "Same reward at any rating"],
      blueBox: true,
    },
    {
      n: "03",
      icon: Wallet,
      title: "Track your reward.",
      body: "Your friends see your review with the reward disclosed. Your rewards page shows each reward as held, ready or paid.",
      boxTitle: "Reward timing:",
      box: ["Held until the return window ends", "Paid by the TruFolks team once it’s ready"],
    },
  ];
  return (
    <section id="how" className="scroll-mt-24 bg-surface py-10 md:bg-transparent md:pt-0 md:pb-10">
      <div className={wrap}>
        <div className="mb-6 flex flex-col justify-between gap-1 md:flex-row md:items-end md:gap-4">
          <div>
            <Eyebrow className="mb-1">
              <span className="md:hidden">Three simple steps</span>
              <span className="hidden md:inline">How it works</span>
            </Eyebrow>
            <h2 className={`${t.h2} text-primary`}>From a shop’s offer to your reward</h2>
          </div>
          <p className={`${t.body} max-w-md text-neutral`}>
            Three steps from seeing an offer to tracking your reward. Your rating never changes what
            you get back.
          </p>
        </div>
        <ol className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className={`${card} flex flex-col justify-between p-4 md:p-10`}>
              <div>
                <div className="mb-1 flex items-center justify-between border-b border-primary/15 pb-1 md:mb-4 md:border-0 md:pb-0">
                  <span
                    className={`${t.label} font-bold tracking-[0.1em] text-secondary md:hidden`}
                  >
                    Step {s.n}
                  </span>
                  <span
                    aria-hidden="true"
                    className="hidden text-[52px] leading-none font-bold tracking-[-0.03em] text-secondary/20 select-none md:block"
                  >
                    {s.n}
                  </span>
                  <s.icon
                    aria-hidden="true"
                    size={22}
                    className={s.blueBox ? "text-secondary" : "text-primary"}
                  />
                </div>
                <h3 className={`${t.title} mb-1 text-primary md:mb-2`}>{s.title}</h3>
                <p className={`${t.body} text-neutral md:mb-4`}>{s.body}</p>
              </div>
              <div className={`${panel} hidden p-4 md:block`}>
                <span
                  className={`${t.labelSm} mb-1 block font-bold ${s.blueBox ? "text-secondary" : "text-primary"}`}
                >
                  {s.boxTitle}
                </span>
                {s.box.map((b) => (
                  <span key={b} className={`${t.small} block text-neutral`}>
                    • {b}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- Offer terms: dark band, three pillars, friends box ---------- */
function OfferTerms() {
  const pillars = [
    {
      k: "Shown upfront",
      icon: Eye,
      title: "Upfront terms",
      lead: "See the offer before you buy.",
      body: "A participating business shows its offer where you order, so you know what to expect before you pay.",
      foot: "Terms before checkout",
      chip: "Before you pay",
    },
    {
      k: "Rating-blind",
      icon: Scale,
      title: "Same reward at any rating",
      lead: "Praise or criticism, the reward is the same.",
      body: "Good, mixed and bad reviews of the same purchase qualify for the same reward. Your rating never changes it.",
      foot: "Equal across ratings",
      chip: "Always",
    },
    {
      k: "Clear timing",
      icon: Clock,
      title: "Held for the return window",
      lead: "Each offer sets when its reward is ready.",
      body: "Rewards are held until the business’s return window ends. If you keep your purchase, the reward becomes ready to pay.",
      foot: "Tracked on your rewards page",
      chip: "In each offer",
    },
  ];
  return (
    <section id="terms" className="scroll-mt-24 py-10 md:pt-0">
      <div className={wrap}>
        <Eyebrow className="mb-1 md:hidden">Offer terms</Eyebrow>
        <h2 className={`${t.h2} mb-6 text-primary md:hidden`}>What every offer shows</h2>

        {/* Dark band */}
        <div className="mb-6 flex items-center gap-4 border border-primary bg-tertiary p-4 text-white shadow-sm md:block md:p-10">
          <BadgeCheck aria-hidden="true" size={24} className="shrink-0 text-canvas/80 md:hidden" />
          <div className="max-w-3xl">
            <p className={`${t.label} mb-1 text-canvas/75 md:mb-2 md:tracking-[0.1em]`}>
              <span className="md:hidden">Shown upfront</span>
              <span className="hidden md:inline">Offer terms</span>
            </p>
            <p className="text-base leading-6 font-bold md:hidden">
              Every offer is shown before you buy.
            </p>
            <h3 className={`${t.h3lg} mb-4 hidden leading-snug md:block`}>
              Clear terms from every participating business
            </h3>
            <p className={`${t.body} hidden text-canvas/85 md:block`}>
              Each offer sets its reward, who it’s for and when it’s ready. You see those terms
              before you buy, and your receipt page repeats them, so the same terms apply from
              checkout to payout.
            </p>
          </div>
        </div>

        {/* Three pillars: full cards on desktop, compact rows on mobile */}
        <ul className="mb-6 flex flex-col gap-2 md:hidden">
          {pillars.map((p) => (
            <li
              key={p.k}
              className="flex items-center justify-between gap-3 border-2 border-primary bg-surface p-2"
            >
              <span>
                <span className={`${t.labelSm} block text-primary`}>{p.k}</span>
                <span className="block text-base leading-6 font-semibold text-primary">
                  {p.title}
                </span>
              </span>
              <span
                className={`${t.small} shrink-0 border border-primary/30 bg-secondary/10 px-2 py-0.5 text-primary`}
              >
                {p.chip}
              </span>
            </li>
          ))}
        </ul>
        <div className="mb-6 hidden grid-cols-3 gap-6 md:grid">
          {pillars.map((p, i) => (
            <div key={p.k} className={`${card} flex flex-col justify-between p-10`}>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className={`${t.labelSm} text-neutral`}>
                    Pillar {["one", "two", "three"][i]}
                  </span>
                  <p.icon aria-hidden="true" size={22} className="text-secondary" />
                </div>
                <h3 className={`${t.h3sm} mb-2 text-primary`}>{p.title}</h3>
                <p className={`${t.body} mb-2 font-semibold text-primary`}>{p.lead}</p>
                <p className={`${t.small} text-neutral`}>{p.body}</p>
              </div>
              <p
                className={`${t.labelSm} mt-4 border-t border-neutral/20 pt-2 font-semibold text-secondary`}
              >
                {p.foot}
              </p>
            </div>
          ))}
        </div>

        {/* Friends box (the export's "terms preview" slot) */}
        <div className={`${card} p-4 md:p-10`}>
          <div className="mb-4 max-w-2xl md:mb-6">
            <Eyebrow className="hidden md:block">What your friends recommend</Eyebrow>
            <h3 className="mt-1 flex items-center gap-2 border-b border-primary/20 pb-2 text-base leading-6 font-bold text-primary md:border-0 md:pb-0 md:text-2xl md:leading-8 md:tracking-[-0.015em]">
              <Users aria-hidden="true" size={20} className="text-secondary md:hidden" />
              Advice from people you know
            </h3>
            <p className={`${t.body} mt-1 hidden text-neutral md:block`}>
              Invite a friend with your own link. Once they accept, you each see the other’s reviews
              — the raves, the shrugs and the “wouldn’t buy again.” No address book access, no
              follower counts.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-6 md:border md:border-secondary/15 md:bg-secondary/[0.06] md:p-6">
            {[
              {
                icon: Users,
                h: "Invite a friend",
                b: "Share your own invite link. You both see each other’s reviews once they accept.",
              },
              {
                icon: BadgeCheck,
                h: "Verified purchase",
                b: "The receipt was checked before the review could be written.",
              },
              {
                icon: ReceiptText,
                h: "Reward disclosed",
                b: "Friends can see a reward was offered for the review, whatever the rating.",
              },
            ].map((c) => (
              <div key={c.h} className="md:border md:border-secondary/15 md:bg-surface md:p-4">
                <p className={`${t.label} mb-1 flex items-center gap-1 font-bold text-primary`}>
                  <c.icon aria-hidden="true" size={16} className="hidden md:inline" />
                  <span className="normal-case md:uppercase">
                    <span className="font-bold md:hidden">• </span>
                    {c.h}
                  </span>
                </p>
                <p className={`${t.small} text-neutral`}>{c.b}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Merchants ---------- */
function Merchants() {
  return (
    <section id="merchants" className="scroll-mt-24 bg-surface py-10 md:bg-transparent md:pt-0">
      <div className={wrap}>
        <div className="mb-6">
          <Eyebrow>For merchants</Eyebrow>
          <h2 className={`${t.h2} text-primary`}>See what your budget pays for</h2>
          <p className={`${t.body} mt-1 max-w-2xl text-neutral`}>
            Shoppers see your offer before they pay. Each reward is tied to a verified purchase and
            an honest review, and their friends see the review with the reward disclosed.
          </p>
        </div>

        {/* Chain: numbered list on mobile, three stages on desktop */}
        <div className="mb-6 border-2 border-primary bg-surface p-4 md:border md:border-neutral/25 md:p-6 md:shadow-sm">
          <p
            className={`${t.label} mb-2 font-bold text-primary md:mb-4 md:font-medium md:tracking-[0.1em] md:text-neutral`}
          >
            How each reward is earned
          </p>
          <ol className="flex flex-col gap-1 md:hidden">
            {[
              "Offer seen before purchase",
              "Receipt checked",
              "Honest review with the reward disclosed",
              "Reward released after the return window",
            ].map((s, i, all) => (
              <li key={s}>
                <p
                  className={`${t.small} flex items-center gap-2 ${i === all.length - 1 ? "font-bold" : ""} text-primary`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center text-xs font-bold text-white ${i === all.length - 1 ? "bg-secondary" : "bg-primary"}`}
                  >
                    {i + 1}
                  </span>
                  {s}
                </p>
                {i < all.length - 1 ? (
                  <ArrowDown aria-hidden="true" size={14} className="my-2 ml-1 text-secondary" />
                ) : null}
              </li>
            ))}
          </ol>
          <ol className="hidden grid-cols-3 gap-4 md:grid">
            {[
              {
                k: "Stage 01",
                h: "Verified purchase",
                b: "A customer sees your offer, buys, and their receipt is checked.",
              },
              {
                k: "Stage 02",
                h: "Disclosed review",
                b: "They write an honest review, shown with the reward disclosed.",
              },
              {
                k: "Stage 03",
                h: "Tracked reward",
                b: "The reward is held for your return window, then paid by the TruFolks team.",
                dark: true,
              },
            ].map((s) => (
              <li key={s.k} className={s.dark ? "bg-primary p-4 text-white" : `${panel} p-4`}>
                <p
                  className={`${t.labelSm} mb-1 font-bold ${s.dark ? "text-canvas/75" : "text-secondary"}`}
                >
                  {s.k}
                </p>
                <p className={`${t.title} mb-1`}>{s.h}</p>
                <p className={`${t.small} ${s.dark ? "text-canvas/85" : "text-neutral"}`}>{s.b}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* First campaign */}
          <div className={`${card} flex flex-col justify-between p-4 md:p-10 lg:col-span-6`}>
            <div>
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-primary/20 pb-2 md:border-0 md:pb-0">
                <h3 className={`${t.h3sm} text-primary`}>Your first TruFolks campaign</h3>
                <span
                  className={`${t.labelSm} shrink-0 bg-secondary px-2 py-0.5 font-bold text-white`}
                >
                  Set up with you
                </span>
              </div>
              <ul className="mb-6 space-y-2 md:space-y-4">
                {[
                  ["Campaign dates", "Agreed with you"],
                  ["Review capacity", "Capped per campaign"],
                  ["Reward budget", "Funded before codes go out"],
                  ["How TruFolks works", "Accepted in your dashboard"],
                ].map(([k, v]) => (
                  <li
                    key={k}
                    className="flex items-start gap-2 md:items-center md:justify-between md:border md:border-secondary/15 md:bg-secondary/[0.06] md:p-2"
                  >
                    <SquareCheck
                      aria-hidden="true"
                      size={18}
                      className="mt-0.5 shrink-0 text-secondary md:hidden"
                    />
                    <span className={`${t.small} text-neutral md:text-[15px] md:leading-6`}>
                      <span className="font-bold text-primary md:font-normal md:text-neutral">
                        {k}
                      </span>
                      <span className="md:hidden"> — {v.toLowerCase()}</span>
                    </span>
                    <span className={`${t.title} hidden text-primary md:inline`}>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-secondary/30 bg-secondary/10 p-4">
              <p className={`${t.labelSm} mb-1 font-bold text-secondary md:text-primary`}>
                Budget and terms
              </p>
              <p className={`${t.small} text-primary md:text-neutral`}>
                The exact reward terms, review capacity and budget for your campaign are agreed with
                you in writing before any receipt codes go out.
              </p>
            </div>
          </div>

          {/* Dashboard */}
          <div className="flex flex-col justify-between border-2 border-primary bg-surface p-4 md:border md:border-tertiary md:bg-tertiary md:p-10 md:text-white md:shadow-sm lg:col-span-6">
            <div>
              <div className="mb-4 md:mb-6">
                <p className={`${t.labelSm} hidden text-canvas/75 md:block`}>
                  Your merchant dashboard
                </p>
                <h3
                  className={`${t.label} font-bold text-primary md:text-xl md:leading-7 md:tracking-[-0.01em] md:text-white md:normal-case`}
                >
                  What your dashboard tracks
                </h3>
              </div>
              <dl className="mb-6 grid grid-cols-2 gap-2 md:gap-4">
                {[
                  ["Confirmed", "Purchases", "Receipts checked by our team"],
                  ["Posted", "Reviews", "Every review, unedited"],
                  ["Every rating", "1 to 5 stars", "All shown alike"],
                  ["Rewards", "Held and paid", "Plus budget left"],
                ].map(([k, v, s], i) => (
                  <div
                    key={k}
                    className="border border-primary/20 bg-secondary/[0.06] p-2 md:border-canvas/15 md:bg-primary md:p-4"
                  >
                    <dt className={`${t.labelSm} text-neutral md:text-canvas/75`}>
                      <span className="md:hidden">Metric 0{i + 1}</span>
                      <span className="hidden md:inline">{k}</span>
                    </dt>
                    <dd className="text-base leading-6 font-bold text-primary md:text-2xl md:leading-8 md:text-white">
                      <span className="md:hidden">
                        {k} {v.toLowerCase()}
                      </span>
                      <span className="hidden md:inline">{v}</span>
                    </dd>
                    <dd className={`${t.small} hidden text-canvas/75 md:block`}>{s}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex flex-col items-start justify-between gap-4 border-t border-primary/20 pt-4 sm:flex-row sm:items-center md:border-canvas/15">
              <p className={`${t.small} text-neutral md:text-canvas/85`}>
                Participating businesses are set up with our team. Already set up?
              </p>
              <Link
                to="/sign-in"
                search={{ next: "/merchant" }}
                className={`${t.label} bg-secondary px-4 py-2 whitespace-nowrap text-white shadow-sm hover:bg-surface hover:text-primary`}
              >
                Sign in to your dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ: 2x2 numbered cards ---------- */
const faqs = [
  {
    q: "What can I earn?",
    a: "The participating business shows its reward in the offer before you buy. Once your receipt is confirmed, the review page shows your exact amount before you write.",
  },
  {
    q: "Does my rating change my reward?",
    a: "No. Every rating goes through the same steps and earns the same reward for the same purchase. The reward is for an honest review, not a good one.",
  },
  {
    q: "Who sees my review?",
    a: "Your friends on TruFolks — people who accepted an invite from you or sent you one. Every review shows that the purchase was verified and that a reward was offered.",
  },
  {
    q: "What if I return what I bought?",
    a: "Rewards are held until the business’s return window ends. If you return the purchase in that window the reward isn’t paid, and your review stays up.",
  },
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 py-10 md:pt-0">
      <div className={wrap}>
        <div className="mb-6">
          <Eyebrow>Questions</Eyebrow>
          <h2 className={`${t.h2} text-primary`}>Before you buy</h2>
          <p className={`${t.body} max-w-xl text-neutral`}>
            How your reward is earned, shown and paid.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-6">
          {faqs.map((f, i) => (
            <div
              key={f.q}
              className="flex gap-2 border-2 border-primary bg-surface p-4 md:gap-4 md:border md:border-neutral/25 md:p-10 md:shadow-sm"
            >
              <span className={`${t.label} pt-1 font-bold text-secondary md:hidden`}>
                [Q{i + 1}]
              </span>
              <span
                aria-hidden="true"
                className={`hidden h-10 w-10 shrink-0 items-center justify-center text-xl font-bold text-white md:flex ${i % 2 ? "bg-secondary" : "bg-primary"}`}
              >
                {i + 1}
              </span>
              <div>
                <h3 className={`${t.title} mb-1 text-primary`}>{f.q}</h3>
                <p className={`${t.body} text-neutral`}>{f.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Receipt lookup: opens the existing /r/$code flow (APP-17-01) ---------- */
function ReceiptLookup() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const c = code.trim();
    if (!c) return setError("Type the code that came with your receipt.");
    void navigate({ to: "/r/$code", params: { code: c } });
  }
  return (
    <section id="receipt" className="scroll-mt-24 md:pb-10">
      <div className="md:mx-auto md:max-w-[1440px] md:px-8">
        <div className="flex flex-col gap-2 border-y-2 border-primary bg-surface bg-[image:linear-gradient(color-mix(in_srgb,var(--color-secondary)_12%,transparent),color-mix(in_srgb,var(--color-secondary)_12%,transparent))] px-4 py-6 md:flex-row md:items-center md:justify-between md:gap-6 md:border md:border-neutral/25 md:p-10 md:shadow-sm">
          <div className="flex items-center gap-2 md:gap-6">
            <span className="flex shrink-0 items-center justify-center text-primary md:h-14 md:w-14 md:bg-primary md:text-white">
              <ReceiptText aria-hidden="true" size={22} />
            </span>
            <div>
              <h2
                className={`${t.label} font-bold text-primary md:text-xl md:leading-7 md:tracking-[-0.01em] md:normal-case`}
              >
                Have a receipt in hand?
              </h2>
              <p className={`${t.body} hidden text-neutral md:block`}>
                Type the short code that came with your receipt, or scan its TruFolks code to claim
                your reward.
              </p>
            </div>
          </div>
          <form onSubmit={onSubmit} noValidate className="w-full md:w-auto">
            <div className="flex items-stretch gap-2">
              <label htmlFor="receipt-code" className="sr-only">
                Receipt code
              </label>
              <input
                id="receipt-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder="Enter receipt code"
                className="min-w-0 flex-1 border-2 border-primary bg-surface px-4 py-2 text-base text-primary placeholder:text-neutral md:w-64 md:flex-none md:border md:border-neutral/40 md:text-xs md:font-semibold md:tracking-[0.06em] md:uppercase md:shadow-sm"
              />
              <button
                type="submit"
                className="bg-primary px-6 py-2 text-base font-bold text-white hover:bg-secondary md:text-xs md:font-semibold md:tracking-[0.06em] md:uppercase md:shadow-sm"
              >
                Look up
              </button>
            </div>
            {error ? (
              <p role="alert" className={`${t.small} mt-2 text-crimson`}>
                {error}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}
