// Minimal welcome at / (BRD v1.7 section 9). The owner-approved headline
// "Find something worth trying." is the h1. The proposed v1.7 copy ("Share
// your top recommendations.") stays in the Stitch concept for owner review and
// is NOT shipped (owner decision, 13 Nov 2026). One trust statement, a primary
// Get started action and a separate Log in link (signed-in visitors get Go to
// My Profile), and a quiet Have a receipt? shortcut. The detailed explainer
// lives at /how-it-works; old /#how, /#terms… bookmarks are forwarded there.
// The right-hand panel is a shapes-only illustration of a profile, not real or
// sample reviews (no made-up people, products or ratings). The
// alternative two-colour styling in the v1.7 proposal awaits owner review; this uses
// the locked TruFolks Core tokens.
import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, ReceiptText, ShoppingBag } from "lucide-react";
import { Shell } from "@/components/site-chrome";
import { HOW_IT_WORKS_SECTIONS } from "@/components/how-it-works";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const LEGACY_FRAGMENTS = new Set<string>(HOW_IT_WORKS_SECTIONS.map((s) => s.id));

const label = "text-xs leading-4 font-semibold tracking-[0.06em] uppercase";
const cta =
  "inline-flex min-h-12 items-center justify-center gap-2 bg-secondary px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-primary";

export function Landing() {
  const navigate = useNavigate();
  const { user, isPending } = useCurrentUserState();
  const signedIn = !isPending && Boolean(user);

  // Old homepage bookmarks (/#how, /#faq, /#receipt…) now live on /how-it-works.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!LEGACY_FRAGMENTS.has(id)) return;
    void navigate({ to: "/how-it-works", hash: id, replace: true }).then(() => {
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    });
  }, [navigate]);

  return (
    <Shell>
      <main className="w-full flex-1 pt-16 md:pt-20">
        <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-10 px-4 py-10 md:px-8 md:py-16 lg:grid-cols-12 lg:gap-12 lg:py-24">
          <section aria-labelledby="welcome-title" className="lg:col-span-7">
            <p className={`${label} inline-flex items-center gap-2 text-secondary`}>
              <span className="inline-block h-2 w-2 bg-secondary" aria-hidden="true" />
              Verified purchases · Friends first
            </p>
            <h1
              id="welcome-title"
              className="mt-4 text-[34px] leading-[40px] font-bold tracking-[-0.025em] text-primary min-[380px]:text-[40px] min-[380px]:leading-[46px] md:text-[64px] md:leading-[70px] md:tracking-[-0.03em]"
            >
              Find something worth trying.
            </h1>
            <p className="mt-5 flex max-w-xl items-start gap-2 text-[15px] leading-6 text-neutral md:text-lg md:leading-7">
              <BadgeCheck aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-secondary" />
              <span>
                Reviews marked <strong className="font-semibold text-primary">Verified purchase</strong> are
                backed by a checked receipt.
              </span>
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              {signedIn ? (
                <Link to="/profile" className={cta}>
                  Go to My Profile <ArrowRight aria-hidden="true" size={18} />
                </Link>
              ) : (
                <>
                  <Link to="/sign-up" search={{ next: "/profile" }} className={cta}>
                    Get started <ArrowRight aria-hidden="true" size={18} />
                  </Link>
                  <p className="text-[15px] leading-6 text-neutral">
                    Already a member?{" "}
                    <Link to="/sign-in" className="font-semibold text-primary underline underline-offset-4 hover:text-secondary">
                      Log in
                    </Link>
                  </p>
                </>
              )}
            </div>
            <p className="mt-6">
              <Link
                to="/how-it-works"
                hash="receipt"
                className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-neutral hover:text-primary"
              >
                <ReceiptText aria-hidden="true" size={16} />
                Have a receipt?
                <ArrowRight aria-hidden="true" size={14} className="text-secondary" />
              </Link>
            </p>
          </section>

          <ProfileIllustration />
        </div>
      </main>
    </Shell>
  );
}

/** A schematic of a profile: shapes only, no names, products or ratings. */
function ProfileIllustration() {
  const bar = "block h-2.5 bg-primary/15";
  return (
    <figure aria-hidden="true" className="hidden lg:col-span-5 lg:block">
      <div className="border border-neutral/25 bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-4 border-b border-neutral/20 pb-5">
          <span className="h-14 w-14 shrink-0 bg-primary" />
          <span className="flex-1 space-y-2">
            <span className={`${bar} w-2/5 bg-primary/40`} />
            <span className={`${bar} w-3/5`} />
          </span>
          <span className={`${label} bg-secondary/10 px-2 py-1 text-primary`}>My Top 5</span>
        </div>
        <ol className="mt-5 space-y-3">
          {[0.72, 0.58, 0.66, 0.5, 0.62].map((w, i) => (
            <li key={i} className="flex items-center gap-3 border border-neutral/15 bg-tint p-3">
              <span className="w-6 text-sm font-bold text-secondary tabular-nums">0{i + 1}</span>
              <span className="flex-1 space-y-1.5">
                <span className={`${bar} bg-primary/30`} style={{ width: `${w * 100}%` }} />
                <span className={`${bar} w-1/3`} />
              </span>
              {i < 3 ? (
                <span className={`${label} inline-flex items-center gap-1 text-[10px] text-primary`}>
                  <BadgeCheck size={14} className="text-secondary" /> Verified
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className={`${label} mt-5 flex items-center gap-2 border-t border-neutral/20 pt-4 text-neutral`}>
          <ShoppingBag size={14} className="text-secondary" /> Shop · where to buy what I recommend
        </p>
      </div>
    </figure>
  );
}
