// v1.7 — My Profile (/profile): the main signed-in destination. The owner sees
// their avatar, name and bio, Add a review, sharing controls with an audience
// preview, My Top 5 (Products and Services, 0–5 each, keyboard-reorderable),
// Shop and All reviews. Every write is checked on the server (migration 0011);
// this page only shows the result. Visitors see /u/<handle>.
//
// v1.9: the page opens like the visitor gallery (identity, Add a review as the
// one primary action, quiet Share, the Top 5 gallery), then groups every
// editing and audience control under "Edit and share".
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Check, Copy, Eye, Lock, Plus, Globe, X } from "lucide-react";
import {
  Alert,
  AppPage,
  btnPrimary,
  btnSecondary,
  inputClass,
  labelClass,
  linkClass,
  Loading,
  SignInPrompt,
} from "@/components/ui";
import { btnAction, galleryLabel, ProfileIdentity, SectionLinks, TopFiveGallery } from "@/components/gallery";
import {
  OfferLink,
  PickRow,
  ProductLinkForm,
  SectionHeading,
  ShopList,
} from "@/components/profile-ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { ProfileReview, ProfileView, TopList } from "@/lib/profiles/engine";
import { AUDIENCE_TEXT, CATALOG_STATUS_TEXT, itemName, profileMessage } from "@/lib/profiles/messages";
import {
  getMyProfile,
  saveTopPicks,
  setProfileAudience,
  setReviewAudience,
  setShopItem,
  updateDisplayName,
  updateProfileBio,
} from "@/lib/profiles/server-fns";
import { ReviewCard } from "@/lib/reviews/review-card";

export const Route = createFileRoute("/profile")({ component: MyProfilePage });

const LIST_TITLE: Record<TopList, string> = { products: "Products", services: "Services" };
const iconBtn =
  "inline-flex h-11 w-11 items-center justify-center border border-primary/30 bg-surface text-primary hover:bg-primary hover:text-white disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-primary";

type Page = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; view: ProfileView };

function MyProfilePage() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getMyProfile().catch(() => null);
    if (!r || !r.ok) setPage({ kind: "error", message: r?.message ?? profileMessage("unavailable") ?? "" });
    else setPage({ kind: "ready", view: r.view });
  }, []);

  useEffect(() => {
    if (isPending || !userId) return;
    void load();
  }, [isPending, userId, load]);

  /** Run a write, then reload what the server now says. */
  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; message?: string } | null>, success: string) => {
      setError(null);
      setNotice(null);
      const r = await fn().catch(() => null);
      if (!r) setError(profileMessage("unavailable"));
      else if (!r.ok) setError(r.message ?? profileMessage("unavailable"));
      else setNotice(success);
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
  if (!userId) {
    return <SignInPrompt title="My Profile" body="Please log in to see your profile." next="/profile" signUp />;
  }
  if (page.kind === "error") {
    return (
      <AppPage>
        <h1 className="mb-4 text-3xl font-bold">My Profile</h1>
        <Alert>{page.message}</Alert>
      </AppPage>
    );
  }
  if (page.kind !== "ready") return null;
  const v = page.view;
  const pinned = new Set([...v.topPicks.products, ...v.topPicks.services].map((r) => r.reviewId));

  return (
    <AppPage width="wide" tone="white">
      <ProfileHeader view={v} onSaved={() => void load()} />
      <SectionLinks shop={v.shop.length} reviews={v.reviews.length} />
      <div aria-live="polite" className="mt-4 empty:hidden">
        {notice ? (
          <p className="flex items-center gap-2 border-l-[3px] border-secondary bg-surface p-3 text-sm shadow-sm">
            <Check aria-hidden="true" size={16} className="text-secondary" /> {notice}
          </p>
        ) : null}
      </div>
      {error ? (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <div className="mt-6">
        <TopFiveGallery
          view={v}
          emptyNote={() => (
            <a href="#edit-top5" className="text-sm font-semibold text-black underline underline-offset-4">
              Pin a review to your Top 5
            </a>
          )}
        />
      </div>

      <section aria-labelledby="edit-title" className="mt-20 scroll-mt-28 bg-canvas p-5 md:p-10">
        <p className={`${galleryLabel} text-neutral`}>Only you see this</p>
        <h2 id="edit-title" className="mt-1 text-2xl leading-8 font-semibold tracking-[-0.015em] text-black md:text-[28px] md:leading-9">
          Edit and share
        </h2>
        <Sharing view={v} act={act} />
      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
        <section aria-labelledby="edit-top5" className="scroll-mt-28 lg:col-span-7">
          <SectionHeading id="edit-top5" eyebrow="My Top 5" title="Choose and order your picks" />
          <div className="flex flex-col gap-8">
            {(["products", "services"] as const).map((list) => (
              <TopListEditor
                key={list}
                list={list}
                picks={v.topPicks[list]}
                candidates={v.reviews.filter((r) => r.shareable && !pinned.has(r.reviewId))}
                act={act}
              />
            ))}
          </div>
        </section>
        <section aria-labelledby="shop-title" className="scroll-mt-28 lg:col-span-5">
          <SectionHeading id="shop-title" eyebrow="Shop" title="Where to buy" />
          <ShopList
            items={v.shop}
            empty={
              <>
                Nothing in your Shop yet. Turn on <strong>Show in Shop</strong> on one of your reviews
                below. It needs product details and a seller link the TruFolks team has approved.
              </>
            }
          />
        </section>
      </div>
      </section>

      <section aria-labelledby="all-title" className="mt-16 max-w-3xl scroll-mt-28">
        <SectionHeading
          id="all-title"
          eyebrow="All reviews"
          title={`My reviews (${v.reviews.length})`}
          aside={
            <Link to="/add-review" className={btnSecondary} aria-label="Add a review (from All reviews)">
              <Plus aria-hidden="true" size={16} /> Add a review
            </Link>
          }
        />
        {v.reviews.length === 0 ? (
          <div className="border border-neutral/20 bg-surface p-5 shadow-sm">
            <p className="text-[15px] leading-6">
              You haven't posted a review yet. Start with a receipt code or one of your confirmed purchases.
            </p>
            <Link to="/add-review" className={`${btnPrimary} mt-4`}>
              Add a review
            </Link>
          </div>
        ) : (
          v.reviews.map((r) => <OwnReview key={r.reviewId} r={r} pinned={pinned.has(r.reviewId)} act={act} />)
        )}
      </section>
    </AppPage>
  );
}

// ------------------------------------------------------------------ header

function ProfileHeader({ view, onSaved }: { view: ProfileView; onSaved: () => void }) {
  const p = view.profile;
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(p.bio);
  const [name, setName] = useState(p.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window === "undefined" ? `/u/${p.handle}` : `${window.location.origin}/u/${p.handle}`;

  async function save() {
    setBusy(true);
    setErr(null);
    if (name.trim() !== p.name) {
      const n = await updateDisplayName({ data: { name } }).catch(() => null);
      if (!n || !n.ok) {
        setBusy(false);
        return setErr(n?.message ?? profileMessage("unavailable"));
      }
    }
    const r = await updateProfileBio({ data: { bio } }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return setErr(r?.message ?? profileMessage("unavailable"));
    setEditing(false);
    onSaved();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  const eyebrow = (
    <span className="inline-flex flex-wrap items-center gap-2">
      My Profile
      <span className="inline-flex items-center gap-1 normal-case tracking-normal">
        {p.audience === "public" ? <Globe aria-hidden="true" size={12} /> : <Lock aria-hidden="true" size={12} />}
        {AUDIENCE_TEXT[p.audience]}
      </span>
    </span>
  );

  const bioSlot = editing ? (
    <div className="mt-4 flex max-w-2xl flex-col gap-2">
      <label htmlFor="display-name" className="text-sm font-semibold">
        Display name <span className="font-normal text-neutral">(shown on your profile and your reviews)</span>
      </label>
      <input
        id="display-name"
        className={inputClass}
        value={name}
        maxLength={60}
        autoComplete="name"
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor="bio" className="mt-2 text-sm font-semibold">
        Bio <span className="font-normal text-neutral">({280 - bio.length} characters left)</span>
      </label>
      <textarea id="bio" className={`${inputClass} min-h-24`} value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} />
      {err ? (
        <p role="alert" className="text-sm text-crimson">
          {err}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setBio(p.bio);
            setName(p.name);
          }}
          className={btnSecondary}
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <div className="mt-3 flex max-w-2xl flex-col items-start gap-2">
      <p className={`text-base leading-7 whitespace-pre-wrap md:text-lg ${p.bio ? "text-black/80" : "text-neutral"}`}>
        {p.bio || "Add a short bio so friends know what you're into."}
      </p>
      <button type="button" onClick={() => setEditing(true)} className="min-h-11 text-sm font-semibold text-black underline underline-offset-4">
        {p.bio ? "Edit name and bio" : "Edit name, add a bio"}
      </button>
    </div>
  );

  return (
    <ProfileIdentity
      name={p.name}
      bio={p.bio}
      eyebrow={eyebrow}
      bioSlot={bioSlot}
      actions={
        <>
          <Link to="/add-review" className={btnAction}>
            <Plus aria-hidden="true" size={16} /> Add a review
          </Link>
          <button type="button" onClick={copy} className="inline-flex min-h-11 items-center justify-center gap-2 border border-black/15 bg-surface px-4 py-2 text-xs font-semibold tracking-[0.06em] text-black uppercase hover:border-black">
            {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
            {copied ? "Link copied" : "Share profile link"}
          </button>
          <Link to="/u/$handle" params={{ handle: p.handle }} className="text-xs font-semibold tracking-[0.06em] text-neutral uppercase hover:text-black">
            View as visitors see it
          </Link>
        </>
      }
    />
  );
}

// ------------------------------------------------------------------ sharing + audience preview

type Act = (fn: () => Promise<{ ok: boolean; message?: string } | null>, success: string) => Promise<void>;

function Sharing({ view, act }: { view: ProfileView; act: Act }) {
  const p = view.profile;
  const publicReviews = view.reviews.filter((r) => r.visibility === "public").length;
  return (
    <section aria-labelledby="sharing-title" className="mt-6 bg-surface p-5 md:p-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 id="sharing-title" className="text-lg leading-7 font-bold">
            Who can see my profile
          </h2>
          <fieldset className="mt-3 flex flex-col gap-2">
            <legend className="sr-only">Profile audience</legend>
            {(["friends", "public"] as const).map((a) => (
              <label
                key={a}
                className={`flex min-h-11 cursor-pointer items-start gap-3 border bg-surface p-3 ${
                  p.audience === a ? "border-secondary" : "border-neutral/30"
                }`}
              >
                <input
                  type="radio"
                  name="profile-audience"
                  className="mt-1"
                  checked={p.audience === a}
                  onChange={() =>
                    void act(
                      () => setProfileAudience({ data: { audience: a } }),
                      a === "public"
                        ? "Your profile is now visible to anyone with the link."
                        : "Your profile is Friends only again. Visitors can no longer open it.",
                    )
                  }
                />
                <span>
                  <span className="block font-semibold">{AUDIENCE_TEXT[a]}</span>
                  <span className="block text-sm text-neutral">
                    {a === "friends"
                      ? "Only people who accepted your invite. This is the default."
                      : "Your name, bio, Top 5, Shop and the reviews you make public. Switch back any time."}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="flex flex-col justify-between gap-4">
          <div className="text-[15px] leading-6">
            <p>
              Each review is shared on its own. Reviews stay <strong>Friends only</strong> until you make one
              public.
            </p>
            <p className="mt-2 text-sm text-neutral">
              {publicReviews === 0
                ? "None of your reviews are public."
                : `${publicReviews} of your reviews ${publicReviews === 1 ? "is" : "are"} public.`}{" "}
              Receipt details, amounts and rewards are never shown.
            </p>
          </div>
          <div>
            <p className={`${labelClass} mb-2 text-neutral`}>Preview my profile as</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/u/$handle" params={{ handle: p.handle }} search={{ as: "friend" }} className={btnSecondary}>
                <Eye aria-hidden="true" size={16} /> A friend
              </Link>
              <Link to="/u/$handle" params={{ handle: p.handle }} search={{ as: "anonymous" }} className={btnSecondary}>
                <Eye aria-hidden="true" size={16} /> Anyone with the link
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Top 5 editor

function TopListEditor({
  list,
  picks,
  candidates,
  act,
}: {
  list: TopList;
  picks: ProfileReview[];
  candidates: ProfileReview[];
  act: Act;
}) {
  const [adding, setAdding] = useState("");
  const ids = picks.map((r) => r.reviewId);
  const save = (next: string[], msg: string) => act(() => saveTopPicks({ data: { list, reviewIds: next } }), msg);
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    void save(next, `Moved ${itemName(picks[i])} to number ${i + 1 + d} in ${LIST_TITLE[list]}.`);
  };
  const full = picks.length >= 5;
  const selectId = `add-${list}`;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b-2 border-primary pb-2">
        <h3 className="text-lg leading-7 font-bold">{LIST_TITLE[list]}</h3>
        <span className="text-sm text-neutral tabular-nums">{picks.length} of 5</span>
      </div>
      {picks.length === 0 ? (
        <p className="border border-dashed border-neutral/40 bg-surface p-4 text-[15px] leading-6 text-neutral">
          No {list} pinned yet. Add up to five of your reviews and put them in your own order.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {picks.map((r, i) => (
            <PickRow
              key={r.reviewId}
              r={r}
              position={i + 1}
              actions={
                <>
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Move ${itemName(r)} up`}
                  >
                    <ArrowUp aria-hidden="true" size={18} />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={i === picks.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${itemName(r)} down`}
                  >
                    <ArrowDown aria-hidden="true" size={18} />
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    onClick={() =>
                      void save(
                        ids.filter((x) => x !== r.reviewId),
                        `Removed ${itemName(r)} from ${LIST_TITLE[list]}.`,
                      )
                    }
                    aria-label={`Remove ${itemName(r)} from ${LIST_TITLE[list]}`}
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </>
              }
            />
          ))}
        </ol>
      )}
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding) return;
          const r = candidates.find((c) => c.reviewId === adding);
          void save([...ids, adding], `Added ${r ? itemName(r) : "the review"} to ${LIST_TITLE[list]}.`).then(() =>
            setAdding(""),
          );
        }}
      >
        <label htmlFor={selectId} className="flex flex-1 flex-col gap-1.5 text-sm font-semibold">
          Add to {LIST_TITLE[list]}
          <select
            id={selectId}
            className={inputClass}
            value={adding}
            disabled={full || candidates.length === 0}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">
              {full
                ? "This list is full (5 of 5)"
                : candidates.length === 0
                  ? "No other shareable reviews yet"
                  : "Choose one of your reviews"}
            </option>
            {candidates.map((c) => (
              <option key={c.reviewId} value={c.reviewId}>
                {itemName(c)} — {c.merchantName} ({c.rating}/5)
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={btnSecondary} disabled={full || !adding}>
          <Plus aria-hidden="true" size={16} /> Add
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ Show in Shop

function ShopSwitch({ r, act }: { r: ProfileReview; act: Act }) {
  const id = `shop-${r.reviewId}`;
  const hint = `${id}-hint`;
  const can = r.shopEligible || r.inShop;
  const reason = !r.shareable
    ? "Available once this review's disclosure is finished."
    : !r.product
      ? "Add product details first."
      : r.product.status !== "approved"
        ? "Available once the TruFolks team approves the product."
        : r.offers.length === 0
          ? "Available once the product has a seller link the TruFolks team has approved."
          : null;
  return (
    <div className="border-t border-neutral/20 pt-3">
      <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={r.inShop}
          aria-describedby={hint}
          className="h-5 w-5"
          checked={r.inShop}
          disabled={!can}
          onChange={(e) =>
            void act(
              () => setShopItem({ data: { reviewId: r.reviewId, on: e.target.checked } }),
              e.target.checked ? `Added ${itemName(r)} to your Shop.` : `Removed ${itemName(r)} from your Shop.`,
            )
          }
        />
        Show in Shop
      </label>
      <p id={hint} className="text-sm text-neutral">
        {reason && !r.inShop
          ? reason
          : r.inShop && r.visibility !== "public"
            ? "Listed in your Shop for friends. Make the review public for others to see it there."
            : r.inShop
              ? "Listed in your Shop with its rating and disclosure."
              : "Off. Your Shop only lists the reviews you choose."}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ one of my reviews

function OwnReview({ r, pinned, act }: { r: ProfileReview; pinned: boolean; act: Act }) {
  const [linking, setLinking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const radio = `aud-${r.reviewId}`;
  return (
    <div id={`review-${r.reviewId}`} className="scroll-mt-28">
      <ReviewCard
        {...r}
        footer={
          <div className="flex flex-col gap-4">
            {!r.shareable ? (
              <p className="border-l-[3px] border-status-flagged bg-status-flagged/5 p-3 text-sm">
                Friends can't see this review yet: its disclosure is still being finished by the TruFolks team.
              </p>
            ) : null}
            <fieldset className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <legend className={`${labelClass} mb-1 text-neutral`}>Who can see this review</legend>
              {(["contacts", "public"] as const).map((a) => (
                <label key={a} className="inline-flex min-h-11 items-center gap-2 pr-4 font-semibold">
                  <input
                    type="radio"
                    name={radio}
                    checked={r.visibility === a}
                    disabled={a === "public" && !r.shareable}
                    onChange={() =>
                      void act(
                        () => setReviewAudience({ data: { reviewId: r.reviewId, audience: a } }),
                        a === "public"
                          ? "That review is now public. Anyone with its link can read it."
                          : "That review is Friends only again.",
                      )
                    }
                  />
                  {a === "contacts" ? "Friends only" : "Public"}
                </label>
              ))}
            </fieldset>
            <ShopSwitch r={r} act={act} />
            <div className="border-t border-neutral/20 pt-3">
              {r.product ? (
                <p className="text-sm">
                  <span className={`${labelClass} text-neutral`}>Product · </span>
                  {r.product.status === "approved" ? (
                    <Link to="/products/$slug" params={{ slug: r.product.slug }} className={linkClass}>
                      {r.product.name}
                    </Link>
                  ) : (
                    <span className="font-semibold">{r.product.name}</span>
                  )}
                  <span className="block text-neutral">{CATALOG_STATUS_TEXT[r.product.status]}</span>
                </p>
              ) : (
                <p className="text-sm text-neutral">
                  {saved ?? "Add product details so friends can find this item and where to buy it."}
                </p>
              )}
              {linking ? (
                <ProductLinkForm
                  reviewId={r.reviewId}
                  defaultModel={r.productLabel}
                  onCancel={() => setLinking(false)}
                  onDone={(status) => {
                    setLinking(false);
                    setSaved(CATALOG_STATUS_TEXT[status] ?? null);
                    void act(async () => ({ ok: true }), "Product details saved.");
                  }}
                />
              ) : (
                <button type="button" onClick={() => setLinking(true)} className="mt-2 text-sm font-semibold text-secondary underline">
                  {r.product ? "Change product details" : "Add product details"}
                </button>
              )}
            </div>
            {r.offers.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {r.offers.map((o) => (
                  <OfferLink key={o.offerId} offer={o} />
                ))}
              </ul>
            ) : null}
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link to="/reviews/$reviewId" params={{ reviewId: r.reviewId }} className={linkClass}>
                Open this review
              </Link>
              {pinned ? <span className="text-neutral">Pinned in My Top 5</span> : null}
            </p>
          </div>
        }
      />
    </div>
  );
}
