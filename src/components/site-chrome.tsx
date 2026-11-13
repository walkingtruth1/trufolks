// Public site header and footer, ported from the Stitch homepage export
// (design/stitch, STITCH-UI-01 visual reference) and rebuilt with TruFolks
// Core tokens. Signed-in shoppers get links to their own pages; merchant and
// admin roles are checked on the server.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const navLink = "text-[15px] leading-6 text-neutral hover:text-primary";
const headerCtaBase =
  "min-h-8 items-center bg-primary px-3 py-1.5 text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap text-white uppercase hover:bg-secondary min-[380px]:text-xs md:px-6 md:py-2 md:tracking-[0.06em]";

/** App tabs for signed-in shoppers (Stitch app screens: the active tab is a dark block). */
const appTab =
  "px-4 py-2 text-xs font-semibold tracking-[0.06em] text-neutral uppercase hover:text-primary [&.active]:bg-primary [&.active]:text-white";
const appTabMobile =
  "py-2 text-[11px] font-semibold tracking-[0.02em] whitespace-nowrap text-neutral uppercase min-[380px]:text-xs min-[380px]:tracking-[0.06em] [&.active]:text-secondary [&.active]:underline [&.active]:underline-offset-4";

/**
 * `site` is the homepage header (section links). `app` keeps the same frame
 * but gives signed-in shoppers tabs for their own pages.
 */
/** Mobile header links: tighter below 380px so all controls fit at 320px (QA-PR3). */
const mobileNavLink =
  "py-2 text-[11px] font-semibold tracking-[0.02em] whitespace-nowrap uppercase min-[380px]:text-xs min-[380px]:tracking-[0.06em]";

export function SiteHeader({ variant = "site" }: { variant?: "site" | "app" }) {
  const { user, isPending } = useCurrentUserState();
  const signedIn = !isPending && Boolean(user);
  if (variant === "app" && signedIn) return <AppTabsHeader />;
  return (
    <header className="fixed top-0 z-50 w-full border-b border-neutral/20 bg-canvas/95 shadow-sm backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-2 px-3 min-[380px]:gap-3 min-[380px]:px-4 md:h-20 md:px-8">
        <Link to="/" aria-label="TruFolks home" className="shrink-0">
          <img
            src="/brand/trufolks-logo-horizontal-color-200.png"
            alt="TruFolks"
            width={122}
            height={32}
            className="h-5 w-auto min-[380px]:h-7 md:h-8"
          />
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-8 md:flex lg:gap-10">
          <Link to="/how-it-works" className={`${navLink} [&.active]:text-primary [&.active]:underline`}>
            How it works
          </Link>
          {signedIn ? (
            <Link to="/contacts" className={navLink}>
              Friends
            </Link>
          ) : (
            <Link to="/how-it-works" hash="merchants" className={navLink}>
              For merchants
            </Link>
          )}
          <Link to="/how-it-works" hash="faq" className={navLink}>
            FAQ
          </Link>
        </nav>
        <div className="flex items-center gap-2 min-[380px]:gap-3 md:gap-4">
          <nav
            aria-label="Main navigation (mobile)"
            className="flex items-center gap-2 min-[380px]:gap-3 md:hidden"
          >
            <Link to="/how-it-works" className={`${mobileNavLink} text-neutral`}>
              How it works
            </Link>
          </nav>
          {isPending ? null : signedIn ? (
            <Link to="/profile" className={`${headerCtaBase} inline-flex`}>
              My Profile
            </Link>
          ) : (
            <>
              {/* Phones: one Log in button (Get started is the page's own main action). */}
              <Link to="/sign-in" className={`${headerCtaBase} inline-flex md:hidden`}>
                Log in
              </Link>
              <Link
                to="/sign-in"
                className="hidden text-xs font-semibold tracking-[0.06em] text-primary uppercase hover:text-secondary md:inline"
              >
                Log in
              </Link>
              <Link to="/sign-up" search={{ next: "/profile" }} className={`${headerCtaBase} hidden md:inline-flex`}>
                Get started
              </Link>
            </>
          )}
          {signedIn ? (
            <Link
              to="/account"
              aria-label="Account settings"
              className="hidden h-8 w-8 items-center justify-center bg-primary text-white hover:bg-secondary md:flex"
            >
              <User aria-hidden="true" size={18} />
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function AppTabsHeader() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-neutral/20 bg-canvas/95 shadow-sm backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-2 px-3 min-[380px]:gap-3 min-[380px]:px-4 md:h-20 md:px-8">
        <Link to="/" aria-label="TruFolks home" className="shrink-0">
          <img
            src="/brand/trufolks-logo-horizontal-color-200.png"
            alt="TruFolks"
            width={122}
            height={32}
            className="h-5 w-auto min-[380px]:h-7 md:h-8"
          />
        </Link>
        <nav aria-label="Your pages" className="hidden items-center gap-2 md:flex">
          <Link to="/profile" className={appTab}>
            Profile
          </Link>
          <Link to="/contacts" className={appTab}>
            Friends
          </Link>
          <Link to="/rewards" className={appTab}>
            Rewards
          </Link>
        </nav>
        <div className="flex items-center gap-2 min-[380px]:gap-4">
          <nav
            aria-label="Your pages (mobile)"
            className="flex items-center gap-2.5 min-[380px]:gap-4 md:hidden"
          >
            <Link to="/profile" className={appTabMobile}>
              Profile
            </Link>
            <Link to="/contacts" className={appTabMobile}>
              Friends
            </Link>
            <Link to="/rewards" className={appTabMobile}>
              Rewards
            </Link>
          </nav>
          <Link
            to="/how-it-works"
            className="hidden text-xs font-semibold tracking-[0.06em] text-neutral uppercase hover:text-primary lg:inline"
          >
            How it works
          </Link>
          <Link
            to="/account"
            className="hidden text-xs font-semibold tracking-[0.06em] text-primary uppercase hover:text-secondary md:inline [&.active]:text-secondary"
          >
            Account
          </Link>
          <Link
            to="/account"
            aria-label="Account settings"
            className="flex h-8 w-8 items-center justify-center bg-primary text-white hover:bg-secondary"
          >
            <User aria-hidden="true" size={18} />
          </Link>
        </div>
      </div>
    </header>
  );
}

const footLink = "text-[13px] leading-5 text-canvas/75 hover:text-white";
const footHead = "mb-4 text-xs font-semibold tracking-[0.06em] text-white uppercase";

export function SiteFooter() {
  return (
    <footer className="w-full border-t border-primary bg-tertiary text-canvas/80">
      <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-8">
        <div className="mb-10 grid grid-cols-2 gap-6 md:grid-cols-4">
          <div className="col-span-2 space-y-4 md:col-span-1">
            <img
              src="/brand/trufolks-logo-horizontal-reversed-200.png"
              alt="TruFolks"
              width={122}
              height={32}
              className="h-8 w-auto"
            />
            <p className="max-w-xs text-[13px] leading-5">
              Verified purchases and honest reviews from people you know.
            </p>
          </div>
          <div>
            <p className={footHead}>Shoppers</p>
            <ul className="space-y-2">
              <li>
                <Link to="/how-it-works" className={footLink}>
                  How it works
                </Link>
              </li>
              <li>
                <Link to="/how-it-works" hash="terms" className={footLink}>
                  Offer terms
                </Link>
              </li>
              <li>
                <Link to="/how-it-works" hash="faq" className={footLink}>
                  FAQ
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className={footHead}>Your account</p>
            <ul className="space-y-2">
              <li>
                <Link to="/profile" className={footLink}>
                  My Profile
                </Link>
              </li>
              <li>
                <Link to="/sign-in" className={footLink}>
                  Log in
                </Link>
              </li>
              <li>
                <Link to="/rewards" className={footLink}>
                  Rewards
                </Link>
              </li>
              <li>
                <Link to="/contacts" className={footLink}>
                  Friends
                </Link>
              </li>
            </ul>
          </div>
          <div className="col-span-2 md:col-span-1">
            <p className={footHead}>For merchants</p>
            <p className="mb-4 text-[13px] leading-5">
              For participating businesses already set up with TruFolks.
            </p>
            <Link
              to="/sign-in"
              search={{ next: "/merchant" }}
              className="inline-block bg-surface px-4 py-2 text-xs font-semibold tracking-[0.06em] text-primary uppercase hover:bg-secondary hover:text-white"
            >
              Merchant sign in
            </Link>
          </div>
        </div>
        <p className="mb-6 border-t border-canvas/15 pt-6 text-[11px] leading-[14px] tracking-[0.05em] text-canvas/70 md:hidden">
          Every review on TruFolks shows that the purchase was verified and that a reward was
          offered. The reward is the same at any rating.
        </p>
        <div className="flex flex-col items-start justify-between gap-2 border-t border-canvas/15 pt-6 text-[11px] leading-[14px] tracking-[0.05em] md:flex-row md:items-center">
          <p>© 2026 TruFolks. All rights reserved.</p>
          <Link to="/how-it-works" hash="receipt" className="hover:text-white">
            Have a receipt? Look up your code
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-primary">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
