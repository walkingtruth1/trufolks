// v1.7 — shared pieces for My Profile, visitor profiles, review and product
// pages. TruFolks Core tokens only (DESIGN_SYSTEM.md). Seller links appear only
// for approved offers; there is never an empty purchase button. Review
// incentives are disclosed on the review card; referral commissions are
// disclosed next to each seller link, separately.
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, BadgeCheck, ShieldCheck, ShoppingBag } from "lucide-react";
import { btnPrimary, btnSecondary, inputClass, labelClass, linkClass, Stars } from "@/components/ui";
import type { ProfileReview, ShopOffer } from "@/lib/profiles/engine";
import { itemName, profileMessage } from "@/lib/profiles/messages";
import { linkReviewToProduct } from "@/lib/profiles/server-fns";
import { disclosureLines } from "@/lib/reviews/disclosure";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, size = "lg" }: { name: string; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-primary font-bold text-white ${
        size === "lg" ? "h-16 w-16 text-2xl md:h-20 md:w-20 md:text-3xl" : "h-9 w-9 text-sm"
      }`}
    >
      {initials(name)}
    </span>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  aside,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className={`${labelClass} text-secondary`}>{eyebrow}</p> : null}
        <h2 id={id} className="mt-1 text-xl leading-7 font-bold tracking-[-0.01em] md:text-2xl md:leading-8">
          {title}
        </h2>
      </div>
      {aside}
    </div>
  );
}

/** One seller or brand link, with its own referral disclosure. */
export function OfferLink({ offer }: { offer: ShopOffer }) {
  return (
    <li className="flex flex-col gap-1">
      <a
        href={offer.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex min-h-11 items-center justify-between gap-2 border border-primary bg-surface px-4 py-2 text-sm font-semibold text-primary hover:bg-primary hover:text-white"
      >
        <span className="min-w-0 break-words">
          {offer.kind === "brand" ? "From the brand: " : "Buy at "}
          {offer.sellerName}
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

/** A compact Top 5 entry linking to the full review. */
export function PickRow({ r, position, actions }: { r: ProfileReview; position: number; actions?: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 border border-neutral/20 bg-surface p-3 shadow-sm sm:flex-row sm:items-center md:p-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="pt-0.5 text-sm font-bold text-secondary tabular-nums" aria-hidden="true">
          {String(position).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <Link
            to="/reviews/$reviewId"
            params={{ reviewId: r.reviewId }}
            className="block text-base leading-6 font-semibold break-words hover:text-secondary hover:underline"
          >
            <span className="sr-only">Number {position}: </span>
            {itemName(r)}
          </Link>
          <p className="text-[13px] leading-5 text-neutral">{r.merchantName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Stars rating={r.rating} />
            {r.verifiedPurchase ? (
              <span className={`${labelClass} inline-flex items-center gap-1 text-[11px] text-primary`}>
                <BadgeCheck aria-hidden="true" size={14} className="text-secondary" /> Verified purchase
              </span>
            ) : null}
          </p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}

/** Shop: reviews with approved seller links. Each entry points to the review too. */
export function ShopList({ items, empty }: { items: ProfileReview[]; empty: ReactNode }) {
  if (items.length === 0) {
    return <div className="border border-dashed border-neutral/40 bg-surface p-4 text-[15px] leading-6 text-neutral">{empty}</div>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((r) => (
        <li key={r.reviewId} className="border border-neutral/20 bg-surface p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <ShoppingBag aria-hidden="true" size={18} className="mt-1 shrink-0 text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-base leading-6 font-semibold break-words">{itemName(r)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm">
                <Stars rating={r.rating} />
                <Link to="/reviews/$reviewId" params={{ reviewId: r.reviewId }} className={linkClass}>
                  Read the review
                </Link>
              </p>
            </div>
          </div>
          {/* The review's disclosure travels with the recommendation (LEG-01), at full size. */}
          <div className="mt-3 flex gap-2 bg-tint-strong p-3 text-[13px] leading-5 text-primary">
            <ShieldCheck aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-secondary" />
            <div>
              {r.disclosure ? (
                disclosureLines(r.disclosure).map((line) => <p key={line}>{line}</p>)
              ) : (
                <p>Disclosure missing.</p>
              )}
            </div>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {r.offers.map((o) => (
              <OfferLink key={o.offerId} offer={o} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Product line under a review card: catalog link (approved) and seller links. */
export function ProductFooter({ r, showOffers = true }: { r: ProfileReview; showOffers?: boolean }) {
  if (!r.product || r.product.status !== "approved") return null;
  return (
    <div className="flex flex-col gap-3">
      <p>
        <span className={`${labelClass} text-neutral`}>Product · </span>
        <Link to="/products/$slug" params={{ slug: r.product.slug }} className={linkClass}>
          {r.product.name}
        </Link>
      </p>
      {showOffers && r.offers.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {r.offers.map((o) => (
            <OfferLink key={o.offerId} offer={o} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** For visitors without an account: shown after the review or Shop content. */
export function JoinInvite({ next }: { next: string }) {
  return (
    <aside
      aria-labelledby="join-title"
      className="mt-10 border-2 border-primary bg-surface p-5 shadow-[4px_4px_0_0_var(--color-primary)] md:p-8"
    >
      <p className={`${labelClass} text-secondary`}>Join TruFolks</p>
      <h2 id="join-title" className="mt-1 text-xl leading-7 font-bold md:text-2xl md:leading-8">
        Start your own TruFolks profile
      </h2>
      <p className="mt-2 max-w-xl text-[15px] leading-6 text-neutral">
        Reviews marked Verified purchase are backed by a checked receipt. See what your friends really
        think, and keep your own Top 5.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Link to="/sign-up" search={{ next }} className={btnPrimary}>
          Get started
        </Link>
        <Link to="/sign-in" search={{ next }} className="text-sm font-semibold text-primary underline">
          Log in
        </Link>
      </div>
    </aside>
  );
}

/** Not found / not shared: never says which, so a visitor can't probe. */
export function NotShared({ what, next, signedIn }: { what: string; next: string; signedIn: boolean }) {
  return (
    <div className="border border-neutral/20 bg-surface p-5 shadow-sm md:p-6">
      <h1 className="text-2xl leading-8 font-bold">This {what} isn't available</h1>
      <p className="mt-2 text-[15px] leading-6 text-neutral">
        It may be shared with friends only, or the link may be wrong.
      </p>
      {signedIn ? (
        <Link to="/profile" className={`${btnSecondary} mt-5`}>
          Go to My Profile
        </Link>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/sign-in" search={{ next }} className={btnPrimary}>
            Log in
          </Link>
          <Link to="/sign-up" search={{ next }} className={btnSecondary}>
            Get started
          </Link>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ product details form

const fieldLabel = "flex flex-col gap-1.5 text-sm font-semibold";

/**
 * Link one of your reviews to a shared catalog record. Exact matches join the
 * existing record; anything else waits for the TruFolks team.
 */
export function ProductLinkForm({
  reviewId,
  defaultModel,
  onDone,
  onCancel,
}: {
  reviewId: string;
  defaultModel: string;
  onDone: (status: string) => void;
  onCancel?: () => void;
}) {
  const [kind, setKind] = useState<"product" | "service">("product");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [variant, setVariant] = useState("");
  const [category, setCategory] = useState("");
  const [gtin, setGtin] = useState("");
  const [offerSeller, setOfferSeller] = useState("");
  const [offerUrl, setOfferUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!brand.trim() || !model.trim() || !category.trim()) {
      setError("Brand (or business), name and category are needed.");
      return;
    }
    if (offerUrl.trim() && (!/^https:\/\/\S+$/.test(offerUrl.trim()) || !offerSeller.trim())) {
      setError("A place to buy needs the seller's name and a link starting with https://.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await linkReviewToProduct({
      data: { reviewId, kind, brand, model, variant, category, gtin, mpn: "", offerSeller, offerUrl },
    }).catch(() => null);
    setBusy(false);
    if (!r) return setError(profileMessage("unavailable"));
    if (!r.ok) return setError(r.message);
    onDone(r.status);
  }

  const id = (s: string) => `${reviewId}-${s}`;
  return (
    <form onSubmit={submit} noValidate className="mt-3 flex flex-col gap-3 border border-secondary/20 bg-tint p-4">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className={`${labelClass} mb-2 text-neutral`}>This is a</legend>
        {(["product", "service"] as const).map((k) => (
          <label key={k} className="inline-flex min-h-11 items-center gap-2 font-semibold">
            <input type="radio" name={id("kind")} checked={kind === k} onChange={() => setKind(k)} />
            {k === "product" ? "Product" : "Service"}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={fieldLabel}>
          {kind === "product" ? "Brand" : "Business"}
          <input className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={80} />
        </label>
        <label className={fieldLabel}>
          {kind === "product" ? "Model or name" : "Service name"}
          <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} maxLength={120} />
        </label>
        <label className={fieldLabel}>
          Variant <span className="font-normal text-neutral">(size, colour, edition — optional)</span>
          <input className={inputClass} value={variant} onChange={(e) => setVariant(e.target.value)} maxLength={80} />
        </label>
        <label className={fieldLabel}>
          Category
          <input
            className={inputClass}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={60}
            placeholder={kind === "product" ? "e.g. Coffee gear" : "e.g. Haircut"}
          />
        </label>
        {kind === "product" ? (
          <label className={fieldLabel}>
            Barcode <span className="font-normal text-neutral">(UPC/EAN — optional)</span>
            <input
              className={inputClass}
              value={gtin}
              onChange={(e) => setGtin(e.target.value)}
              inputMode="numeric"
              maxLength={20}
            />
          </label>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-secondary">Suggest where to buy (optional)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={fieldLabel}>
            Seller or brand name
            <input className={inputClass} value={offerSeller} onChange={(e) => setOfferSeller(e.target.value)} maxLength={80} />
          </label>
          <label className={fieldLabel}>
            Link
            <input
              className={inputClass}
              value={offerUrl}
              onChange={(e) => setOfferUrl(e.target.value)}
              placeholder="https://"
              type="url"
              maxLength={500}
            />
          </label>
        </div>
        <p className="mt-2 text-neutral">The TruFolks team checks every link before it's shown.</p>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-crimson">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : "Save product details"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
