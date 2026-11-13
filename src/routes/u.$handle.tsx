// v1.7 — a member's profile at its stable visitor URL (/u/<handle>). What each
// visitor sees is decided on the server (migration 0011): the owner, an
// accepted friend, a signed-in member, or a guest. Friends only by default;
// strangers see only a published profile and its public reviews. Blocked or
// unknown → "isn't available" (never says which). The owner can preview the
// page as a friend or as anyone (?as=friend | anonymous).
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Lock, Users } from "lucide-react";
import { AppPage, btnSecondary, Chip, labelClass, linkClass, Loading } from "@/components/ui";
import {
  Avatar,
  JoinInvite,
  NotShared,
  PickRow,
  ProductFooter,
  SectionHeading,
  ShopList,
} from "@/components/profile-ui";
import type { ProfileView, TopList } from "@/lib/profiles/engine";
import { profileMessage } from "@/lib/profiles/messages";
import { getProfile } from "@/lib/profiles/server-fns";
import { ReviewCard } from "@/lib/reviews/review-card";

type As = "friend" | "anonymous";

export const Route = createFileRoute("/u/$handle")({
  validateSearch: (search: Record<string, unknown>): { as?: As } =>
    search.as === "friend" || search.as === "anonymous" ? { as: search.as } : {},
  component: VisitorProfile,
});

type Page =
  | { kind: "loading" }
  | { kind: "missing"; signedIn: boolean }
  | { kind: "error"; message: string }
  | { kind: "ready"; view: ProfileView; signedIn: boolean };

const RELATION_TEXT: Record<ProfileView["relation"], string> = {
  owner: "This is you",
  friend: "Your friend",
  member: "Shared publicly",
  anonymous: "Shared publicly",
};

function VisitorProfile() {
  const { handle } = Route.useParams();
  const { as } = Route.useSearch();
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setPage({ kind: "loading" });
    getProfile({ data: { handle, as: as ?? null } })
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r) setPage({ kind: "error", message: profileMessage("unavailable") ?? "" });
        else if (!r.ok)
          setPage(r.reason === "not_found" ? { kind: "missing", signedIn: false } : { kind: "error", message: r.message });
        else setPage({ kind: "ready", view: r.view, signedIn: r.signedIn });
      });
    return () => {
      alive = false;
    };
  }, [handle, as]);

  const here = `/u/${encodeURIComponent(handle)}`;
  if (page.kind === "loading") {
    return (
      <AppPage width="wide">
        <Loading />
      </AppPage>
    );
  }
  if (page.kind === "missing" || page.kind === "error") {
    return (
      <AppPage>
        <NotShared what="profile" next={here} signedIn={false} />
      </AppPage>
    );
  }
  if (page.kind !== "ready") return null;
  const v = page.view;
  const p = v.profile;
  const picks = v.topPicks.products.length + v.topPicks.services.length;
  const guest = !page.signedIn;

  return (
    <AppPage width="wide">
      {v.isOwner ? <PreviewBar handle={p.handle} as={as ?? null} audience={p.audience} /> : null}
      <header className="border border-neutral/20 bg-surface p-5 shadow-sm md:p-8">
        <div className="flex items-start gap-4">
          <Avatar name={p.name} />
          <div className="min-w-0">
            <p className={`${labelClass} flex items-center gap-1.5 text-secondary`}>
              {v.relation === "friend" ? <Users aria-hidden="true" size={14} /> : null}
              {RELATION_TEXT[v.relation]}
            </p>
            <h1 className="mt-1 text-[28px] leading-9 font-bold tracking-[-0.02em] break-words md:text-[40px] md:leading-[48px]">
              {p.name}
            </h1>
            {p.bio ? <p className="mt-2 max-w-2xl text-[15px] leading-6 whitespace-pre-wrap">{p.bio}</p> : null}
          </div>
        </div>
      </header>

      {v.isOwner && v.relation === "anonymous" && p.audience === "friends" ? (
        <p className="mt-6 flex items-start gap-2 border-l-[3px] border-status-flagged bg-surface p-4 text-[15px] leading-6 shadow-sm">
          <Lock aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
          Your profile is Friends only, so anyone else following this link sees “This profile isn't available.”
        </p>
      ) : null}

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
        <section aria-labelledby="top5-title" className="lg:col-span-7">
          <SectionHeading id="top5-title" eyebrow="Top 5" title={`${p.name}'s Top 5`} />
          {picks === 0 ? (
            <p className="border border-dashed border-neutral/40 bg-surface p-4 text-[15px] leading-6 text-neutral">
              Nothing pinned here yet.
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              {(["products", "services"] as TopList[])
                .filter((l) => v.topPicks[l].length > 0)
                .map((l) => (
                  <div key={l}>
                    <h3 className="mb-3 border-b-2 border-primary pb-2 text-lg leading-7 font-bold">
                      {l === "products" ? "Products" : "Services"}
                    </h3>
                    <ol className="flex flex-col gap-2">
                      {v.topPicks[l].map((r, i) => (
                        <PickRow key={r.reviewId} r={r} position={i + 1} />
                      ))}
                    </ol>
                  </div>
                ))}
            </div>
          )}
        </section>
        <section aria-labelledby="shop-title" className="lg:col-span-5">
          <SectionHeading id="shop-title" eyebrow="Shop" title="Where to buy" />
          <ShopList items={v.shop} empty="No shop links yet." />
        </section>
      </div>

      <section aria-labelledby="all-title" className="mt-12 max-w-3xl">
        <SectionHeading id="all-title" eyebrow="All reviews" title={`Reviews (${v.reviews.length})`} />
        {v.reviews.length === 0 ? (
          <p className="border border-neutral/20 bg-surface p-5 text-[15px] leading-6 text-neutral shadow-sm">
            No reviews shared here yet.
          </p>
        ) : (
          v.reviews.map((r) => (
            <ReviewCard
              key={r.reviewId}
              {...r}
              footer={
                <div className="flex flex-col gap-3">
                  <ProductFooter r={r} />
                  <Link to="/reviews/$reviewId" params={{ reviewId: r.reviewId }} className={linkClass}>
                    Open this review
                  </Link>
                </div>
              }
            />
          ))
        )}
      </section>

      {guest ? <JoinInvite next="/profile" /> : null}
    </AppPage>
  );
}

function PreviewBar({ handle, as, audience }: { handle: string; as: As | null; audience: "friends" | "public" }) {
  const tab = (active: boolean) =>
    `inline-flex min-h-11 items-center px-3 text-xs font-semibold tracking-[0.06em] uppercase ${
      active ? "bg-primary text-white" : "bg-surface text-primary hover:text-secondary"
    }`;
  return (
    <div className="mb-6 flex flex-col gap-3 border border-secondary/30 bg-tint p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Eye aria-hidden="true" size={16} className="text-secondary" />
        Previewing your profile
        <Chip>{audience === "public" ? "Published" : "Friends only"}</Chip>
      </p>
      <nav aria-label="Preview as" className="flex flex-wrap items-center gap-1">
        <Link to="/u/$handle" params={{ handle }} search={{}} className={tab(as === null)} aria-current={as === null ? "page" : undefined}>
          Me
        </Link>
        <Link to="/u/$handle" params={{ handle }} search={{ as: "friend" }} className={tab(as === "friend")} aria-current={as === "friend" ? "page" : undefined}>
          A friend
        </Link>
        <Link
          to="/u/$handle"
          params={{ handle }}
          search={{ as: "anonymous" }}
          className={tab(as === "anonymous")}
          aria-current={as === "anonymous" ? "page" : undefined}
        >
          Anyone
        </Link>
        <Link to="/profile" className={`${btnSecondary} ml-1 min-h-11 py-2`}>
          Edit
        </Link>
      </nav>
    </div>
  );
}
