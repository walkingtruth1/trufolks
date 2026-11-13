// v1.7 — catalog queue at /admin/catalog (TruFolks team only; the allowlist
// is checked on the server). Approve, reject or merge queued records, correct a
// record's details (the correction path), approve or reject suggested seller
// links, add a seller or brand link, and close correction requests. Merging
// moves every review link and seller link to the kept record; the merged
// record's page forwards there.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Alert, AppPage, btnDestructive, btnPrimary, btnSecondary, inputClass, labelClass, Loading, PageTitle, SignInPrompt } from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { CatalogAdminView, QueueProduct } from "@/lib/profiles/engine";
import { profileMessage } from "@/lib/profiles/messages";
import {
  addSellerOffer,
  decideCatalogProduct,
  decideSellerOffer,
  getCatalogAdmin,
  resolveCatalogCorrection,
  updateCatalogProduct,
} from "@/lib/profiles/server-fns";

export const Route = createFileRoute("/admin/catalog")({ component: AdminCatalog });

type Page = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: CatalogAdminView };
type Act = (fn: () => Promise<{ ok: boolean; message?: string } | null>) => Promise<void>;

const NOTE: Record<string, string> = {
  new_entry: "New record",
  possible_variant: "Possible variant of another record",
};

function AdminCatalog() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getCatalogAdmin().catch(() => null);
    if (!r || !r.ok) return setPage({ kind: "error", message: r?.message ?? profileMessage("unavailable") ?? "" });
    const { ok: _ok, ...data } = r;
    setPage({ kind: "ok", data });
  }, []);

  useEffect(() => {
    if (!isPending && userId) void load();
  }, [isPending, userId, load]);

  const act: Act = useCallback(
    async (fn) => {
      setError(null);
      const r = await fn().catch(() => null);
      if (!r || !r.ok) setError(r?.message ?? profileMessage("unavailable"));
      await load();
    },
    [load],
  );

  if (isPending || (userId && page.kind === "loading")) {
    return (
      <AppPage width="wide">
        <Loading />
      </AppPage>
    );
  }
  if (!userId) return <SignInPrompt title="Catalog" body="Please sign in." next="/admin/catalog" />;
  if (page.kind === "error") {
    return (
      <AppPage>
        <PageTitle title="Catalog" />
        <Alert>{page.message}</Alert>
      </AppPage>
    );
  }
  if (page.kind !== "ok") return null;
  const d = page.data;

  return (
    <AppPage width="wide">
      <PageTitle
        eyebrow="TruFolks team"
        title="Catalog"
        intro="Check new product records before they get a public page. Merge duplicates, keep different variants apart, and only approve seller links you have checked."
      />
      {error ? <Alert>{error}</Alert> : null}

      <h2 className="mt-8 text-xl font-bold">Waiting for a check ({d.pending.length})</h2>
      {d.pending.length === 0 ? <p className="mt-2 text-neutral">Nothing waiting.</p> : null}
      <div className="mt-3 flex flex-col gap-4">
        {d.pending.map((p) => (
          <ProductRow key={p.productId} p={p} approved={d.approved} act={act} queued />
        ))}
      </div>

      <h2 className="mt-10 text-xl font-bold">Seller links ({d.offers.length})</h2>
      <div className="mt-3 flex flex-col gap-2">
        {d.offers.map((o) => (
          <div key={o.offerId} className="flex flex-col gap-2 border border-neutral/20 bg-surface p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 text-sm">
              <p className="font-semibold">
                {o.productName} — {o.kind === "brand" ? "brand shop" : "seller"}: {o.sellerName}
              </p>
              <p className="break-all text-neutral">{o.url}</p>
              <p className={`${labelClass} mt-1 text-[11px]`}>
                {o.status} · {o.referralCommission ? "referral commission" : "no commission"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {o.status === "pending" ? (
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void act(() => decideSellerOffer({ data: { offerId: o.offerId, action: "approve", referralCommission: false } }))}
                >
                  Approve
                </button>
              ) : null}
              <button
                type="button"
                className={btnDestructive}
                onClick={() =>
                  void act(() => decideSellerOffer({ data: { offerId: o.offerId, action: o.status === "pending" ? "reject" : "withdraw", referralCommission: false } }))
                }
              >
                {o.status === "pending" ? "Reject" : "Withdraw"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-bold">Correction requests ({d.corrections.length})</h2>
      <div className="mt-3 flex flex-col gap-2">
        {d.corrections.map((c) => (
          <div key={c.correctionId} className="border border-neutral/20 bg-surface p-3 text-sm">
            <p className="font-semibold">
              <Link to="/products/$slug" params={{ slug: c.slug }} className="underline">
                {c.productName}
              </Link>
            </p>
            <p className="mt-1 whitespace-pre-wrap">{c.note}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => void act(() => resolveCatalogCorrection({ data: { correctionId: c.correctionId, action: "resolve" } }))}>
                Mark fixed
              </button>
              <button type="button" className={btnSecondary} onClick={() => void act(() => resolveCatalogCorrection({ data: { correctionId: c.correctionId, action: "dismiss" } }))}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-bold">Approved records ({d.approved.length})</h2>
      <div className="mt-3 flex flex-col gap-4">
        {d.approved.map((p) => (
          <ProductRow key={p.productId} p={p} approved={d.approved} act={act} />
        ))}
      </div>
    </AppPage>
  );
}

function ProductRow({ p, approved, act, queued = false }: { p: QueueProduct; approved: QueueProduct[]; act: Act; queued?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState(p.similarTo?.status === "approved" ? p.similarTo.productId : "");
  const others = approved.filter((a) => a.productId !== p.productId);
  return (
    <div className="border border-neutral/20 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words">{p.name}</p>
          <p className="text-sm text-neutral">
            {p.kind} · {p.category} · {p.reviewCount} review{p.reviewCount === 1 ? "" : "s"}
            {p.gtin ? ` · barcode ${p.gtin}` : ""}
            {p.releaseYear ? ` · ${p.releaseYear}${p.releaseYearVerified ? " (verified)" : " (not verified)"}` : ""}
          </p>
          {queued && p.matchNote ? (
            <p className={`${labelClass} mt-1 text-[11px] text-status-flagged`}>
              {NOTE[p.matchNote] ?? p.matchNote}
              {p.similarTo ? `: ${p.similarTo.name} (${p.similarTo.status})` : ""}
            </p>
          ) : null}
        </div>
        {!queued ? (
          <Link to="/products/$slug" params={{ slug: p.slug }} className="text-sm underline">
            Page
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {queued ? (
          <>
            <button type="button" className={btnPrimary} onClick={() => void act(() => decideCatalogProduct({ data: { productId: p.productId, action: "approve", targetId: null } }))}>
              Approve as its own record
            </button>
            <button type="button" className={btnDestructive} onClick={() => void act(() => decideCatalogProduct({ data: { productId: p.productId, action: "reject", targetId: null } }))}>
              Reject
            </button>
          </>
        ) : null}
        {others.length > 0 ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (target) void act(() => decideCatalogProduct({ data: { productId: p.productId, action: "merge", targetId: target } }));
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Merge into
              <select className={`${inputClass} py-2`} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose the record to keep</option>
                {others.map((a) => (
                  <option key={a.productId} value={a.productId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={btnSecondary} disabled={!target}>
              Merge
            </button>
          </form>
        ) : null}
        <button type="button" className="text-sm font-semibold text-secondary underline" onClick={() => setEditing((x) => !x)}>
          {editing ? "Close" : "Correct details / add link"}
        </button>
      </div>
      {editing ? <EditProduct p={p} act={act} /> : null}
    </div>
  );
}

function EditProduct({ p, act }: { p: QueueProduct; act: Act }) {
  const [f, setF] = useState({
    kind: p.kind as string,
    brand: p.brand,
    model: p.model,
    variant: p.variant ?? "",
    category: p.category,
    gtin: p.gtin ?? "",
    mpn: p.mpn ?? "",
    releaseYear: p.releaseYear ? String(p.releaseYear) : "",
    releaseYearVerified: p.releaseYearVerified,
  });
  const [offer, setOffer] = useState({ sellerName: "", url: "", kind: "seller", referralCommission: false });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void act(() => updateCatalogProduct({ data: { productId: p.productId, ...f } }));
  }
  function addOffer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void act(() => addSellerOffer({ data: { productId: p.productId, ...offer } }));
  }
  const field = "flex flex-col gap-1 text-sm font-semibold";
  return (
    <div className="mt-4 grid gap-6 border-t border-neutral/20 pt-4 lg:grid-cols-2">
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Kind
          <select className={inputClass} value={f.kind} onChange={set("kind")}>
            <option value="product">Product</option>
            <option value="service">Service</option>
          </select>
        </label>
        <label className={field}>
          Brand / business
          <input className={inputClass} value={f.brand} onChange={set("brand")} />
        </label>
        <label className={field}>
          Model / name
          <input className={inputClass} value={f.model} onChange={set("model")} />
        </label>
        <label className={field}>
          Variant
          <input className={inputClass} value={f.variant} onChange={set("variant")} />
        </label>
        <label className={field}>
          Category
          <input className={inputClass} value={f.category} onChange={set("category")} />
        </label>
        <label className={field}>
          Barcode (GTIN)
          <input className={inputClass} value={f.gtin} onChange={set("gtin")} />
        </label>
        <label className={field}>
          Maker part number
          <input className={inputClass} value={f.mpn} onChange={set("mpn")} />
        </label>
        <label className={field}>
          Release year
          <input className={inputClass} value={f.releaseYear} onChange={set("releaseYear")} inputMode="numeric" maxLength={4} />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
          <input type="checkbox" checked={f.releaseYearVerified} onChange={(e) => setF({ ...f, releaseYearVerified: e.target.checked })} />
          Release year checked against the maker's own source (shown publicly only when checked)
        </label>
        <button type="submit" className={`${btnPrimary} sm:col-span-2`}>
          Save details
        </button>
      </form>
      <form onSubmit={addOffer} className="grid content-start gap-3">
        <p className="text-sm font-semibold">Add a checked place to buy</p>
        <label className={field}>
          Seller or brand name
          <input className={inputClass} value={offer.sellerName} onChange={(e) => setOffer({ ...offer, sellerName: e.target.value })} />
        </label>
        <label className={field}>
          Link (https://)
          <input className={inputClass} value={offer.url} onChange={(e) => setOffer({ ...offer, url: e.target.value })} />
        </label>
        <label className={field}>
          Type
          <select className={inputClass} value={offer.kind} onChange={(e) => setOffer({ ...offer, kind: e.target.value })}>
            <option value="seller">Seller</option>
            <option value="brand">Brand's own shop</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={offer.referralCommission} onChange={(e) => setOffer({ ...offer, referralCommission: e.target.checked })} />
          TruFolks earns a referral commission from this link
        </label>
        <button type="submit" className={btnSecondary}>
          Add link
        </button>
      </form>
    </div>
  );
}
