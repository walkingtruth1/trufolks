// v1.9 gallery pieces (final design work order; Stitch "radical reduction"
// frames as visual reference only). White planes, black type, square corners,
// depth from spacing and soft light rather than heavy borders. The one primary
// action per view uses the `action` token with black text (DESIGN_SYSTEM.md).
// Only facts the app holds are shown: item, business, category, rating,
// Verified purchase and the reviewer's own words. No invented scores, prices,
// stock or shipping claims.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, BadgeCheck, Check, Share2, ShieldCheck } from "lucide-react";
import type { ProfileReview, ProfileView, TopList } from "@/lib/profiles/engine";
import { itemName } from "@/lib/profiles/messages";
import { catalogImage, type PickImage } from "@/lib/catalog/images";
import { disclosureLines } from "@/lib/reviews/disclosure";

export const galleryLabel = "text-[11px] leading-4 font-semibold tracking-[0.08em] uppercase";
export const btnAction =
  "inline-flex min-h-12 items-center justify-center gap-2 bg-action px-6 py-3 text-sm font-semibold tracking-[0.06em] text-black uppercase hover:bg-black hover:text-white";
export const btnQuiet =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-black/15 bg-surface px-4 py-2 text-xs font-semibold tracking-[0.06em] text-black uppercase hover:border-black";
/** The soft, planar lift used instead of tile borders. */
export const lift = "bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.12)]";

const LIST_LABEL: Record<TopList, string> = { products: "Products", services: "Services" };

/** Plain facts for one pick, split the way the gallery shows them. */
export function pickFacts(r: ProfileReview, list: TopList) {
  const approved = r.product && r.product.status === "approved" ? r.product : null;
  const service = list === "services" || approved?.kind === "service";
  return {
    title: service ? (approved?.model ?? r.productLabel) : itemName(r),
    business: service ? (approved?.brand ?? r.merchantName) : r.merchantName,
    businessLabel: service ? "Business" : "Bought at",
    category: approved?.category || (service ? "Service" : "Product"),
    product: approved,
    service,
    image: catalogImage(approved?.slug),
  };
}

function excerpt(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

function initials(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "·";
}

/** A picture, or the designed no-image state (soft light, the item's initials). */
export function PickPicture({
  image,
  title,
  className = "",
  big = false,
}: {
  image: PickImage | null;
  title: string;
  className?: string;
  big?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  // A server-rendered picture can fail before hydration, when onError isn't attached yet.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0 && image) setFailed(image.src);
  }, [image]);
  if (image && failed !== image.src) {
    return (
      <div className={`overflow-hidden bg-canvas ${className}`}>
        <img
          ref={img}
          src={image.src}
          alt={image.alt}
          loading="lazy"
          onError={() => setFailed(image.src)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={`No photo yet for ${title}`}
      className={`flex flex-col items-center justify-center gap-2 bg-canvas bg-[radial-gradient(120%_90%_at_30%_20%,var(--color-surface)_0%,var(--color-canvas)_70%)] ${className}`}
    >
      <span aria-hidden="true" className={`font-semibold tracking-[-0.03em] text-black/20 ${big ? "text-7xl" : "text-4xl"}`}>
        {(title.trim()[0] ?? "·").toUpperCase()}
      </span>
      <span aria-hidden="true" className={`${galleryLabel} text-neutral`}>
        No photo yet
      </span>
    </div>
  );
}

/** The review's disclosure travels with any quote from it (LEG-01), at full size. */
export function DisclosureLine({ r }: { r: ProfileReview }) {
  return (
    <div className="flex gap-2 text-[13px] leading-5 text-black">
      <ShieldCheck aria-hidden="true" size={15} className="mt-0.5 shrink-0" />
      <div>{r.disclosure ? disclosureLines(r.disclosure).map((line) => <p key={line}>{line}</p>) : <p>Disclosure missing.</p>}</div>
    </div>
  );
}

function VerifiedTag() {
  return (
    <span className={`${galleryLabel} inline-flex items-center gap-1 text-black`}>
      <BadgeCheck aria-hidden="true" size={14} /> Verified purchase
    </span>
  );
}

function RatingText({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="text-sm font-semibold whitespace-nowrap text-black">
      <span aria-hidden="true">
        {"★".repeat(r)}
        {"☆".repeat(5 - r)} {r}/5
      </span>
      <span className="sr-only">Rated {r} out of 5</span>
    </span>
  );
}

/** Where a pick's item link goes: the product page, remembering whose profile it came from. */
function ItemLink({ r, handle, children, className }: { r: ProfileReview; handle: string; children: ReactNode; className: string }) {
  const p = r.product && r.product.status === "approved" ? r.product : null;
  if (!p) return <span className={className}>{children}</span>;
  return (
    <Link to="/products/$slug" params={{ slug: p.slug }} search={{ from: handle, review: r.reviewId }} className={`${className} hover:underline`}>
      {children}
    </Link>
  );
}

/** Products / Services switch. Arrow keys move between the two. */
export function CategoryToggle({
  value,
  counts,
  onChange,
  label,
}: {
  value: TopList;
  counts: Record<TopList, number>;
  onChange: (l: TopList) => void;
  label: string;
}) {
  const refs = useRef<Record<TopList, HTMLButtonElement | null>>({ products: null, services: null });
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next: TopList = e.key === "Home" ? "products" : e.key === "End" ? "services" : value === "products" ? "services" : "products";
    onChange(next);
    refs.current[next]?.focus();
  }
  return (
    <div role="group" aria-label={label} className="inline-flex border border-black/15 bg-surface p-1">
      {(["products", "services"] as const).map((l) => {
        const on = value === l;
        return (
          <button
            key={l}
            ref={(el) => {
              refs.current[l] = el;
            }}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(l)}
            onKeyDown={onKey}
            className={`inline-flex min-h-11 items-center gap-2 px-4 text-xs font-semibold tracking-[0.08em] uppercase sm:px-5 ${
              on ? "bg-black text-white" : "text-black hover:bg-canvas"
            }`}
          >
            {on ? <Check aria-hidden="true" size={14} /> : null}
            {LIST_LABEL[l]}
            <span className={on ? "text-white/70" : "text-neutral"}>{counts[l]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Top 5 gallery: one large featured pick with an excerpt and Read review,
 * then up to four smaller picks. Adapts to one pick, missing pictures and none.
 */
export function TopFiveGallery({
  view,
  emptyNote,
}: {
  view: ProfileView;
  /** Shown when the chosen list is empty (the owner gets a way to fill it). */
  emptyNote?: (list: TopList) => ReactNode;
}) {
  const counts = { products: view.topPicks.products.length, services: view.topPicks.services.length };
  const [list, setList] = useState<TopList>(counts.products === 0 && counts.services > 0 ? "services" : "products");
  const picks = view.topPicks[list];
  const handle = view.profile.handle;
  const first = view.profile.name.split(/\s+/)[0] || view.profile.name;

  return (
    <section aria-labelledby="top5-title">
      <div className="flex flex-col gap-4 border-b border-black/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={`${galleryLabel} text-neutral`}>Top 5</p>
          <h2 id="top5-title" className="mt-1 text-2xl leading-8 font-semibold tracking-[-0.015em] text-black md:text-[28px] md:leading-9">
            {view.isOwner && view.relation === "owner" ? "My Top 5" : `${first}'s Top 5`}
          </h2>
        </div>
        <CategoryToggle value={list} counts={counts} onChange={setList} label="Show Top 5 products or services" />
      </div>

      <div aria-live="polite" className="mt-8">
        {picks.length === 0 ? (
          <div className="flex flex-col items-start gap-3 bg-canvas p-6 md:p-8">
            <p className="text-[15px] leading-6 text-black">Nothing pinned in {LIST_LABEL[list]} yet.</p>
            {emptyNote ? emptyNote(list) : null}
          </div>
        ) : (
          <>
            <Featured r={picks[0]} list={list} handle={handle} />
            {picks.length > 1 ? (
              <ol start={2} className="mt-10 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4" aria-label={`${LIST_LABEL[list]} 2 to ${picks.length}`}>
                {picks.slice(1, 5).map((r, i) => (
                  <SmallPick key={r.reviewId} r={r} list={list} handle={handle} position={i + 2} />
                ))}
              </ol>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function Featured({ r, list, handle }: { r: ProfileReview; list: TopList; handle: string }) {
  const f = pickFacts(r, list);
  return (
    <article aria-labelledby={`pick-${r.reviewId}`} className={`grid grid-cols-1 lg:grid-cols-12 ${lift}`}>
      <div className="relative lg:col-span-7">
        <span className={`${galleryLabel} absolute top-0 left-0 z-10 bg-black px-2.5 py-1.5 text-white`}>No. 1</span>
        <PickPicture image={f.image} title={f.title} big className="aspect-[4/3] h-full w-full lg:aspect-auto lg:min-h-[420px]" />
      </div>
      <div className="flex flex-col gap-4 bg-canvas p-6 md:p-8 lg:col-span-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`${galleryLabel} text-neutral`}>{f.category}</p>
          {r.verifiedPurchase ? <VerifiedTag /> : null}
        </div>
        <div>
          <h3 id={`pick-${r.reviewId}`} className="text-2xl leading-8 font-semibold tracking-[-0.015em] break-words text-black md:text-[28px] md:leading-9">
            <ItemLink r={r} handle={handle} className="">
              {f.title}
            </ItemLink>
          </h3>
          <p className="mt-1 text-sm leading-5 text-neutral">
            <span className="sr-only">{f.businessLabel}: </span>
            {f.business}
          </p>
        </div>
        <blockquote className="bg-surface p-5 text-[15px] leading-7 text-black italic">
          <p>“{excerpt(r.honestThought, 240)}”</p>
          <footer className={`${galleryLabel} mt-3 text-neutral not-italic`}>{r.reviewerName}</footer>
        </blockquote>
        <RatingText rating={r.rating} />
        <DisclosureLine r={r} />
        <div className="mt-auto flex flex-col gap-3 pt-2">
          <Link to="/reviews/$reviewId" params={{ reviewId: r.reviewId }} className={`${btnAction} w-full justify-between`}>
            Read review <ArrowRight aria-hidden="true" size={18} />
          </Link>
          {f.product ? (
            <Link
              to="/products/$slug"
              params={{ slug: f.product.slug }}
              search={{ from: handle, review: r.reviewId }}
              className={`${btnQuiet} w-full justify-between`}
            >
              {f.service ? "View service" : "Where to buy"} <ArrowUpRight aria-hidden="true" size={16} />
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SmallPick({ r, list, handle, position }: { r: ProfileReview; list: TopList; handle: string; position: number }) {
  const f = pickFacts(r, list);
  return (
    <li className="flex gap-4 border-b border-black/10 pb-6 sm:flex-col sm:gap-0 sm:border-0 sm:pb-0">
      <div className="relative w-24 shrink-0 sm:w-full">
        <span className={`${galleryLabel} absolute top-0 left-0 z-10 bg-black px-2 py-1 text-white`}>
          <span className="sr-only">Number </span>
          {String(position).padStart(2, "0")}
        </span>
        <PickPicture image={f.image} title={f.title} className={`aspect-square w-full sm:aspect-[4/3] ${lift}`} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-x-2 sm:mt-4">
          <p className={`${galleryLabel} min-w-0 truncate text-neutral`}>{f.category}</p>
          {r.verifiedPurchase ? (
            <span className={`${galleryLabel} inline-flex items-center gap-1 text-black`}>
              <BadgeCheck aria-hidden="true" size={13} /> Verified
            </span>
          ) : null}
        </div>
        <h3 className="mt-1 text-base leading-6 font-semibold break-words text-black sm:text-lg">
          <ItemLink r={r} handle={handle} className="">
            {f.title}
          </ItemLink>
        </h3>
        <p className="text-[13px] leading-5 text-neutral">
          <span className="sr-only">{f.businessLabel}: </span>
          {f.business}
        </p>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-black/80">“{excerpt(r.honestThought, 160)}”</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <RatingText rating={r.rating} />
        </div>
        <div className="mt-2">
          <DisclosureLine r={r} />
        </div>
        <Link
          to="/reviews/$reviewId"
          params={{ reviewId: r.reviewId }}
          className="mt-auto inline-flex min-h-11 items-center justify-between gap-2 pt-2 text-xs font-semibold tracking-[0.08em] text-black uppercase hover:underline sm:mt-3 sm:border-t sm:border-black/10"
        >
          Read review <span className="sr-only">of {f.title}</span>
          <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </div>
    </li>
  );
}

/** All reviews as a compact register: what, where, rating and a link to the full review. */
export function ReviewRegister({ reviews, handle }: { reviews: ProfileReview[]; handle: string }) {
  return (
    <ul className="border-t border-black/10">
      {reviews.map((r) => {
        const f = pickFacts(r, r.product?.kind === "service" ? "services" : "products");
        return (
          <li key={r.reviewId} className="flex flex-col gap-2 border-b border-black/10 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-base leading-6 font-semibold break-words text-black">
                <ItemLink r={r} handle={handle} className="">
                  {itemName(r)}
                </ItemLink>
              </p>
              <p className="text-[13px] leading-5 text-neutral">
                {r.merchantName} · {new Date(r.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                {f.product ? ` · ${f.category}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1">
              <RatingText rating={r.rating} />
              {r.verifiedPurchase ? <VerifiedTag /> : null}
              <Link
                to="/reviews/$reviewId"
                params={{ reviewId: r.reviewId }}
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold tracking-[0.08em] text-black uppercase hover:underline"
              >
                Read review <span className="sr-only">of {itemName(r)}</span>
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A quiet Share action: the phone's share sheet when there is one, else copy the link. */
export function ShareButton({ path, title }: { path: string; title: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function share() {
    const url = `${window.location.origin}${path}`;
    try {
      if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={share} className={btnQuiet}>
        {state === "copied" ? <Check aria-hidden="true" size={14} /> : <Share2 aria-hidden="true" size={14} />}
        {state === "copied" ? "Link copied" : "Share"}
      </button>
      <span role="status" className="text-xs text-neutral empty:hidden">
        {state === "failed" ? `Copy this link: ${path}` : ""}
      </span>
    </span>
  );
}

/** Profile identity: avatar or initials, name, short bio, quiet Share. */
export function ProfileIdentity({
  name,
  bio,
  eyebrow,
  sharePath,
  actions,
  bioSlot,
}: {
  name: string;
  bio: string;
  eyebrow?: ReactNode;
  sharePath?: string;
  actions?: ReactNode;
  /** Replaces the bio (the owner's edit form). */
  bioSlot?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6 pb-10 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-5 md:gap-8">
        <span
          aria-hidden="true"
          className={`flex h-16 w-16 shrink-0 items-center justify-center text-xl font-semibold text-black md:h-24 md:w-24 md:text-3xl ${lift}`}
        >
          {initials(name)}
        </span>
        <div className="min-w-0">
          {eyebrow ? <p className={`${galleryLabel} text-neutral`}>{eyebrow}</p> : null}
          <h1 className="mt-1 text-[32px] leading-[38px] font-semibold tracking-[-0.02em] break-words text-black md:text-[44px] md:leading-[48px]">
            {name}
          </h1>
          {bioSlot ?? (bio ? <p className="mt-3 max-w-2xl text-base leading-7 whitespace-pre-wrap text-black/80 md:text-lg">{bio}</p> : null)}
        </div>
      </div>
      {sharePath || actions ? (
        <div className="flex shrink-0 flex-wrap items-start gap-3 md:flex-col md:items-end">
          {actions}
          {sharePath ? <ShareButton path={sharePath} title={`${name} on TruFolks`} /> : null}
        </div>
      ) : null}
    </header>
  );
}

/** In-page links to the other profile sections, so Shop and All reviews stay easy to find. */
export function SectionLinks({ shop, reviews }: { shop: number; reviews: number }) {
  const a = "inline-flex min-h-11 items-center gap-2 text-xs font-semibold tracking-[0.08em] text-black uppercase hover:underline";
  return (
    <nav aria-label="On this profile" className="mb-10 flex flex-wrap gap-x-8 gap-y-1 border-y border-black/10 py-2">
      <a href="#top5-title" className={a}>
        Top 5
      </a>
      <a href="#shop-title" className={a}>
        Shop <span className="text-neutral">{shop}</span>
      </a>
      <a href="#all-title" className={a}>
        All reviews <span className="text-neutral">{reviews}</span>
      </a>
    </nav>
  );
}
