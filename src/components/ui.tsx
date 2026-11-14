// Shared app UI (UI-17-01), ported from the Stitch app screens (Claim Receipt,
// Write a Review, Rewards, Contacts, Merchant Dashboard) and rebuilt with
// TruFolks Core tokens (DESIGN_SYSTEM.md). Stitch is a visual reference only
// (STITCH-UI-01). Visible labels, text status, square corners.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

/** Stitch "Editorial Modern" label: 12/16, 600, 0.06em, uppercase. */
export const labelClass = "text-xs leading-4 font-semibold tracking-[0.06em] uppercase";

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-2 px-5 py-3 text-xs font-semibold tracking-[0.06em] uppercase disabled:opacity-60";
export const btnPrimary = `${btnBase} bg-secondary text-white hover:bg-primary`;
export const btnDark = `${btnBase} bg-primary text-white hover:bg-tertiary`;
export const btnSecondary = `${btnBase} border border-primary bg-surface text-primary hover:bg-primary hover:text-white`;
export const btnDestructive =
  "inline-flex min-h-9 items-center justify-center border border-crimson bg-surface px-3 py-1.5 text-xs font-semibold tracking-[0.06em] text-crimson uppercase disabled:opacity-60";
/** The full-width "Send →" / "Preview →" action at the foot of a form. */
export const btnSubmit =
  "inline-flex min-h-14 w-full items-center justify-center gap-2 bg-secondary px-6 text-lg font-bold tracking-[0.04em] text-white uppercase shadow-sm hover:bg-primary disabled:opacity-60";
export const inputClass =
  "w-full border border-neutral/40 bg-surface px-4 py-3 text-[15px] leading-6 text-primary placeholder:text-neutral focus:border-secondary focus:outline-2 focus:outline-offset-0 focus:outline-secondary/30";
export const linkClass = "font-semibold text-secondary underline";

/** Page frame for app routes: the approved site header and footer around one column. */
export function AppPage({
  children,
  width = "narrow",
  tone = "canvas",
}: {
  children: ReactNode;
  width?: "narrow" | "wide";
  /** v1.9 gallery pages (profiles, product pages) sit on clean white with black type. */
  tone?: "canvas" | "white";
}) {
  return (
    <div className={`flex min-h-screen flex-col ${tone === "white" ? "bg-surface text-black" : "bg-canvas text-primary"}`}>
      <SiteHeader variant="app" />
      <main
        className={`mx-auto w-full flex-1 px-4 pt-24 pb-12 md:pt-32 md:pb-20 ${
          width === "wide" ? "max-w-[1440px] md:px-8" : "max-w-[560px] md:px-0"
        }`}
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className={`${labelClass} text-secondary`}>{children}</p>;
}

export function PageTitle({
  eyebrow,
  title,
  intro,
}: {
  eyebrow?: ReactNode;
  title: string;
  intro?: ReactNode;
}) {
  return (
    <div className="mb-6 md:mb-8">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className="mt-2 text-[28px] leading-9 font-bold tracking-[-0.02em] md:text-[40px] md:leading-[48px]">
        {title}
      </h1>
      {intro ? (
        <div className="mt-3 max-w-3xl text-[15px] leading-6 text-neutral md:text-lg md:leading-7">
          {intro}
        </div>
      ) : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`border border-neutral/20 bg-surface p-5 shadow-sm md:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xl leading-7 font-semibold tracking-[-0.01em]">{children}</h2>;
}

/** Small square chip, e.g. "Step 1 of 2" or "Verified purchase". */
export function Chip({
  children,
  tone = "light",
}: {
  children: ReactNode;
  tone?: "light" | "dark" | "blue";
}) {
  const t =
    tone === "dark"
      ? "bg-primary text-white"
      : tone === "blue"
        ? "bg-secondary text-white"
        : "bg-tint-strong text-primary";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 whitespace-nowrap ${labelClass} ${t}`}
    >
      {children}
    </span>
  );
}

/**
 * A highlighted note (e.g. the PAY-08 formula or the HON-02 statement). Never
 * collapsed. `icon` sits in the left gutter, like the Stitch panels.
 */
export function Note({
  children,
  tone = "info",
  icon,
}: {
  children: ReactNode;
  tone?: "info" | "dark" | "rule";
  icon?: ReactNode;
}) {
  const t =
    tone === "dark"
      ? "bg-tertiary text-canvas"
      : tone === "rule"
        ? "border-l-[3px] border-secondary bg-surface shadow-sm"
        : "bg-tint";
  return (
    <div className={`flex gap-3 p-4 text-sm leading-relaxed ${t}`}>
      {icon ? (
        <span
          className={`mt-0.5 shrink-0 ${tone === "dark" ? "text-canvas" : "text-secondary"}`}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Loading() {
  return (
    <p role="status" className="text-neutral">
      Loading…
    </p>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-l-[3px] border-crimson bg-surface p-3 text-sm text-crimson">
      {children}
    </p>
  );
}

export type StatusTone = "pending" | "held" | "ready" | "paid" | "flagged" | "forfeited";

const TONE: Record<StatusTone, string> = {
  pending: "border-status-pending text-status-pending bg-status-pending/10",
  held: "border-status-held text-status-held bg-status-held/10",
  ready: "border-status-ready text-status-ready bg-status-ready/10",
  paid: "border-status-paid text-status-paid bg-status-paid/10",
  flagged: "border-status-flagged text-status-flagged bg-status-flagged/10",
  forfeited: "border-status-forfeited text-status-forfeited bg-status-forfeited/10",
};

/** A status badge. Always carries a text label: colour is never the only signal. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-xs font-bold tracking-[0.06em] uppercase ${TONE[tone]}`}
    >
      <span aria-hidden="true">[</span>
      {children}
      <span aria-hidden="true">]</span>
    </span>
  );
}

/** Sign-in prompt that returns to `next` afterwards (existing safeNextPath flow). */
export function SignInPrompt({
  title,
  body,
  next,
  signUp = false,
}: {
  title: string;
  body: string;
  next: string;
  signUp?: boolean;
}) {
  return (
    <AppPage>
      <PageTitle title={title} />
      <Card>
        <p className="leading-relaxed">{body}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/sign-in" search={{ next }} className={btnPrimary}>
            Sign in
          </Link>
          {signUp ? (
            <Link to="/sign-up" search={{ next }} className={btnSecondary}>
              Create account
            </Link>
          ) : null}
        </div>
      </Card>
    </AppPage>
  );
}

/** Star rating as text plus symbols; never colour-coded (DESIGN_SYSTEM ratings rule). */
export function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span aria-label={`${r} out of 5 stars`} className="font-semibold whitespace-nowrap">
      <span aria-hidden="true" className="tracking-wider">
        {"★".repeat(r)}
        {"☆".repeat(5 - r)}
      </span>{" "}
      <span className="text-sm">{r}/5</span>
    </span>
  );
}
