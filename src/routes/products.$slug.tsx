// v1.7 — a shared product page (/products/<slug>) for an approved catalog
// record. Stable URL; a merged record forwards to the one it was merged into.
// Shows the record (brand, model, variant, category, verified release year),
// approved places to buy, and every review of it this visitor may read. A
// guest only gets a page when at least one review of it is public. Signed-in
// members can ask the TruFolks team to correct the record.
//
// v1.9 layout (final design work order): two columns on desktop, the picture
// and the relevant review on the left, the item and Where to buy on the right.
// On phones: the item first, then the relevant review, then seller links, all
// in normal page flow. ?from=<handle>&review=<id> (set by profile links) keeps
// the reviewer the visitor came from at the top, with a way back.
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { AppPage, btnSecondary, Chip, inputClass, linkClass, Loading } from "@/components/ui";
import { JoinInvite, NotShared } from "@/components/profile-ui";
import { btnAction, btnQuiet, galleryLabel, lift, PickPicture } from "@/components/gallery";
import { catalogHero } from "@/lib/catalog/images";
import type { ProductPage as ProductData, ProfileReview, ShopOffer } from "@/lib/profiles/engine";
import { profileMessage } from "@/lib/profiles/messages";
import { getProduct, requestCatalogCorrection } from "@/lib/profiles/server-fns";
import { ReviewCard } from "@/lib/reviews/review-card";

type Search = { from?: string; review?: string };

export const Route = createFileRoute("/products/$slug")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const out: Search = {};
    if (typeof search.from === "string" && /^[a-z0-9-]{1,40}$/i.test(search.from)) out.from = search.from;
    if (typeof search.review === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(search.review)) out.review = search.review;
    return out;
  },
  component: ProductPage,
});

type Page =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; page: ProductData; signedIn: boolean };

function ProductPage() {
  const { slug } = Route.useParams();
  const { from, review } = Route.useSearch();
  const navigate = useNavigate();
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setPage({ kind: "loading" });
    getProduct({ data: { slug, review: review ?? "" } })
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r) return setPage({ kind: "error", message: profileMessage("unavailable") ?? "" });
        if (!r.ok) return setPage(r.reason === "not_found" ? { kind: "missing" } : { kind: "error", message: r.message });
        if ("moved" in r && r.moved) {
          void navigate({ to: "/products/$slug", params: { slug: r.moved }, search: { from, review }, replace: true });
          return;
        }
        if ("page" in r && r.page) setPage({ kind: "ready", page: r.page, signedIn: r.signedIn });
      });
    return () => {
      alive = false;
    };
  }, [slug, navigate, from, review]);

  const here = `/products/${encodeURIComponent(slug)}`;
  if (page.kind === "loading") {
    return (
      <AppPage>
        <Loading />
      </AppPage>
    );
  }
  if (page.kind !== "ready") {
    return (
      <AppPage>
        <NotShared what="product page" next={here} signedIn={false} />
      </AppPage>
    );
  }
  const { product, offers, reviews } = page.page;
  const service = product.kind === "service";
  // The review the visitor came for: the one linked, else the reviewer they came from, else the newest.
  const lead =
    reviews.find((r) => r.reviewId === page.page.leadReviewId) ??
    reviews.find((r) => from && r.authorHandle === from) ??
    reviews[0] ??
    null;
  const fromReviewer = lead && from && lead.authorHandle === from ? lead : null;
  const others = reviews.filter((r) => r !== lead);
  const hero = catalogHero(product.slug);

  return (
    <AppPage width="wide" tone="white">
      <nav aria-label="Breadcrumb" className={`${galleryLabel} mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-neutral`}>
        <Link to="/" className="hover:text-black">
          Home
        </Link>
        {fromReviewer?.authorHandle ? (
          <>
            <span aria-hidden="true">/</span>
            <Link to="/u/$handle" params={{ handle: fromReviewer.authorHandle }} className="hover:text-black">
              {fromReviewer.reviewerName}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="min-w-0 break-words text-black">
          {product.name}
        </span>
      </nav>

      {fromReviewer?.authorHandle ? (
        <div className="mb-10 flex flex-col gap-3 bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <p className="text-[15px] leading-6 text-black">
            You came from <strong className="font-semibold">{fromReviewer.reviewerName}</strong>'s profile.
          </p>
          <Link to="/u/$handle" params={{ handle: fromReviewer.authorHandle }} className={btnQuiet}>
            <ArrowLeft aria-hidden="true" size={14} /> Back to their profile
          </Link>
        </div>
      ) : null}

      {/* DOM and phone order: item, picture, review, sellers. Desktop places the same
          elements in two columns with grid rows, without changing the reading order. */}
      <div className="flex flex-col gap-10 lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-12 lg:gap-y-10">
        <header className="lg:col-span-5 lg:col-start-8 lg:row-start-1">
          <p className={`${galleryLabel} text-neutral`}>
            {service ? "Service" : "Product"} · {product.category}
          </p>
          <h1 className="mt-2 text-[32px] leading-[38px] font-semibold tracking-[-0.02em] break-words text-black md:text-[44px] md:leading-[48px]">
            {product.name}
          </h1>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-black/10 pt-5 text-sm">
            <Fact label={service ? "Business" : "Brand"} value={product.brand} />
            <Fact label={service ? "Service" : "Model"} value={product.model} />
            {product.variant ? <Fact label="Variant" value={product.variant} /> : null}
            {product.releaseYear ? <Fact label="Released" value={String(product.releaseYear)} /> : null}
          </dl>
        </header>

        <figure className="lg:col-span-7 lg:row-span-2 lg:row-start-1">
          <PickPicture image={hero} title={product.name} big className={`aspect-[4/3] w-full ${lift}`} />
        </figure>

        <section aria-labelledby="lead-review" className="lg:col-span-7 lg:row-start-3">
          <h2 id="lead-review" className={`${galleryLabel} text-neutral`}>
            {lead ? (fromReviewer ? `${lead.reviewerName}'s review` : "Firsthand review") : "Reviews"}
          </h2>
          {lead ? (
            <ReviewCard {...lead} footer={<ReviewLinks r={lead} />} />
          ) : (
            <p className="mt-3 text-[15px] leading-6 text-neutral">No reviews you can read yet.</p>
          )}
        </section>

        <section aria-labelledby="buy-title" className={`p-6 md:p-8 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-2 ${lift}`}>
          <h2 id="buy-title" className="text-xl leading-7 font-semibold tracking-[-0.01em] text-black">
            {service ? "Book or visit" : "Where to buy"}
          </h2>
          {offers.length === 0 ? (
            <p className="mt-3 text-[15px] leading-6 text-neutral">
              No approved {service ? "links" : "sellers"} yet. The TruFolks team checks every link before it's shown.
            </p>
          ) : (
            <ul className="mt-5 flex flex-col gap-4">
              {offers.map((o, i) => (
                <SellerLink key={o.offerId} offer={o} service={service} primary={i === 0} />
              ))}
            </ul>
          )}
          <p className="mt-5 border-t border-black/10 pt-4 text-[13px] leading-5 text-neutral">
            Links open another site. You don't need a TruFolks account to follow them.
          </p>
        </section>
      </div>

      {others.length > 0 ? (
        <section aria-labelledby="reviews-title" className="mt-20 max-w-3xl">
          <p className={`${galleryLabel} text-neutral`}>Verified reviews</p>
          <h2 id="reviews-title" className="mt-1 text-2xl leading-8 font-semibold tracking-[-0.015em] text-black">
            More reviews ({others.length})
          </h2>
          {others.map((r) => (
            <ReviewCard key={r.reviewId} {...r} footer={<ReviewLinks r={r} />} />
          ))}
        </section>
      ) : null}

      {page.signedIn ? <Correction slug={product.slug} /> : <JoinInvite next="/profile" />}
    </AppPage>
  );
}

function ReviewLinks({ r }: { r: ProfileReview }) {
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1">
      <Link to="/reviews/$reviewId" params={{ reviewId: r.reviewId }} className={linkClass}>
        Open this review
      </Link>
      {r.authorHandle ? (
        <Link to="/u/$handle" params={{ handle: r.authorHandle }} className={linkClass}>
          More from {r.reviewerName}
        </Link>
      ) : null}
    </p>
  );
}

/** One approved seller or business link, with its own referral disclosure. */
function SellerLink({ offer, service, primary }: { offer: ShopOffer; service: boolean; primary: boolean }) {
  const label = service
    ? offer.kind === "brand"
      ? "Visit business"
      : "View service"
    : offer.kind === "brand"
      ? "From the brand"
      : "Buy at";
  return (
    <li className="flex flex-col gap-1.5">
      <a
        href={offer.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={`${primary ? btnAction : btnQuiet} w-full justify-between text-left`}
      >
        <span className="min-w-0 break-words">
          {label}
          <span className="font-normal normal-case"> · {offer.sellerName}</span>
        </span>
        <ArrowUpRight aria-hidden="true" size={16} className="shrink-0" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <span className="text-[12px] leading-4 text-neutral">
        {offer.referralCommission
          ? "TruFolks may earn a referral commission from this link."
          : "TruFolks earns no commission from this link."}
      </span>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={`${galleryLabel} text-neutral`}>{label}</dt>
      <dd className="mt-1 font-semibold break-words text-black">{value}</dd>
    </div>
  );
}

function Correction({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!note.trim()) return setState({ ok: false, msg: "Tell us what's wrong." });
    const r = await requestCatalogCorrection({ data: { slug, note } }).catch(() => null);
    if (!r || !r.ok) return setState({ ok: false, msg: r?.message ?? profileMessage("unavailable") ?? "" });
    setNote("");
    setOpen(false);
    setState({ ok: true, msg: "Thanks. The TruFolks team will check it." });
  }
  return (
    <section className="mt-10 border-t border-neutral/20 pt-6">
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={`mb-3 text-sm ${state.ok ? "" : "text-crimson"}`}>
          {state.msg}
        </p>
      ) : null}
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="correction" className="text-sm font-semibold">
            What should be corrected? <Chip>Checked by the TruFolks team</Chip>
          </label>
          <textarea id="correction" className={`${inputClass} min-h-24`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="submit" className={btnSecondary}>
              Send correction
            </button>
            <button type="button" className="text-sm font-semibold underline" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-secondary underline">
          Suggest a correction to this product
        </button>
      )}
    </section>
  );
}
