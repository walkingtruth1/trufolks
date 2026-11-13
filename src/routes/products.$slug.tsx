// v1.7 — a shared product page (/products/<slug>) for an approved catalog
// record. Stable URL; a merged record forwards to the one it was merged into.
// Shows the record (brand, model, variant, category, verified release year),
// approved places to buy, and every review of it this visitor may read. A
// guest only gets a page when at least one review of it is public. Signed-in
// members can ask the TruFolks team to correct the record.
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppPage, btnSecondary, Chip, inputClass, labelClass, linkClass, Loading } from "@/components/ui";
import { JoinInvite, NotShared, OfferLink, SectionHeading } from "@/components/profile-ui";
import type { ProductPage as ProductData } from "@/lib/profiles/engine";
import { profileMessage } from "@/lib/profiles/messages";
import { getProduct, requestCatalogCorrection } from "@/lib/profiles/server-fns";
import { ReviewCard } from "@/lib/reviews/review-card";

export const Route = createFileRoute("/products/$slug")({ component: ProductPage });

type Page =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; page: ProductData; signedIn: boolean };

function ProductPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setPage({ kind: "loading" });
    getProduct({ data: { slug } })
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r) return setPage({ kind: "error", message: profileMessage("unavailable") ?? "" });
        if (!r.ok) return setPage(r.reason === "not_found" ? { kind: "missing" } : { kind: "error", message: r.message });
        if ("moved" in r && r.moved) {
          void navigate({ to: "/products/$slug", params: { slug: r.moved }, replace: true });
          return;
        }
        if ("page" in r && r.page) setPage({ kind: "ready", page: r.page, signedIn: r.signedIn });
      });
    return () => {
      alive = false;
    };
  }, [slug, navigate]);

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
  const counts = [5, 4, 3, 2, 1].map((s) => reviews.filter((r) => r.rating === s).length);

  return (
    <AppPage>
      <p className={`${labelClass} text-secondary`}>{product.kind === "service" ? "Service" : "Product"}</p>
      <h1 className="mt-2 text-[28px] leading-9 font-bold tracking-[-0.02em] break-words md:text-[40px] md:leading-[48px]">
        {product.name}
      </h1>
      <dl className="mt-4 grid grid-cols-2 gap-px border border-neutral/20 bg-neutral/20 text-sm sm:grid-cols-4">
        <Fact label={product.kind === "service" ? "Business" : "Brand"} value={product.brand} />
        <Fact label="Category" value={product.category} />
        <Fact label="Variant" value={product.variant ?? "—"} />
        <Fact label="Released" value={product.releaseYear ? String(product.releaseYear) : "—"} />
      </dl>

      <section aria-labelledby="buy-title" className="mt-8">
        <SectionHeading id="buy-title" eyebrow="Shop" title="Where to buy" />
        {offers.length === 0 ? (
          <p className="text-[15px] leading-6 text-neutral">No approved sellers yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {offers.map((o) => (
              <OfferLink key={o.offerId} offer={o} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="reviews-title" className="mt-10">
        <SectionHeading id="reviews-title" eyebrow="Verified reviews" title={`Reviews (${reviews.length})`} />
        <ul className="grid grid-cols-5 gap-2 text-center text-sm" aria-label="Ratings given">
          {[5, 4, 3, 2, 1].map((s, i) => (
            <li key={s} className="border border-neutral/30 bg-surface py-2">
              <span className="block font-semibold">
                {s} {s === 1 ? "star" : "stars"}
              </span>
              <span className="block text-lg font-black">{counts[i]}</span>
            </li>
          ))}
        </ul>
        {reviews.map((r) => (
          <ReviewCard
            key={r.reviewId}
            {...r}
            footer={
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
            }
          />
        ))}
      </section>

      {page.signedIn ? <Correction slug={product.slug} /> : <JoinInvite next="/profile" />}
    </AppPage>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-3">
      <dt className={`${labelClass} text-neutral`}>{label}</dt>
      <dd className="mt-1 font-semibold break-words">{value}</dd>
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
