import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-7 sm:px-10">
      <Link to="/" className="flex items-center gap-3" aria-label="TruFolks home">
        <img
          src="/trufolks-mark.png"
          alt=""
          width={46}
          height={46}
          className="h-11 w-11"
        />
        <span className="text-2xl font-extrabold tracking-tight">TruFolks®</span>
      </Link>
      <p className="hidden text-xs font-medium tracking-[0.18em] uppercase md:block">
        The anti-influencer network
      </p>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-ink text-cream">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-10 sm:py-20">
        <p className="text-xs font-semibold tracking-[0.18em] text-lime uppercase">
          Our non-negotiable
        </p>
        <h2 className="mt-5 max-w-4xl text-4xl leading-none font-black tracking-tight uppercase sm:text-6xl">
          The truth has a paper trail.
        </h2>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-cream/80">
          Not gifted. Not staged. Not paid to pretend. A receipt proves the
          purchase. An honest review tells the rest.
        </p>
        <div className="mt-12 flex flex-col gap-3 border-t border-cream/20 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-lg font-extrabold tracking-tight">TruFolks®</p>
          <p className="text-xs tracking-wide text-cream/70 uppercase">
            © 2026 TruFolks. Keep it real.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-cream text-ink">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
