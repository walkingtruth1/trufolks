// v1.7 — a member's profile at its stable visitor URL (/u/<handle>). What each
// visitor sees is decided on the server (migration 0011): the owner, an
// accepted friend, a signed-in member, or a guest. Friends only by default;
// strangers see only a published profile and its public reviews. Blocked or
// unknown → "isn't available" (never says which). The owner can preview the
// page as a friend or as anyone (?as=friend | anonymous).
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Lock, Users } from "lucide-react";
import { AppPage, btnSecondary, Chip, Loading } from "@/components/ui";
import { JoinInvite, NotShared, SectionHeading, ShopList } from "@/components/profile-ui";
import { ProfileIdentity, ReviewRegister, SectionLinks, TopFiveGallery } from "@/components/gallery";
import type { ProfileView } from "@/lib/profiles/engine";
import { profileMessage } from "@/lib/profiles/messages";
import { getProfile } from "@/lib/profiles/server-fns";

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
  const guest = !page.signedIn;

  return (
    <AppPage width="wide" tone="white">
      {v.isOwner ? <PreviewBar handle={p.handle} as={as ?? null} audience={p.audience} /> : null}
      <ProfileIdentity
        name={p.name}
        bio={p.bio}
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            {v.relation === "friend" ? <Users aria-hidden="true" size={13} /> : null}
            {RELATION_TEXT[v.relation]}
          </span>
        }
        sharePath={here}
      />

      {v.isOwner && v.relation === "anonymous" && p.audience === "friends" ? (
        <p className="mb-8 flex items-start gap-2 border-l-[3px] border-status-flagged bg-canvas p-4 text-[15px] leading-6">
          <Lock aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
          Your profile is Friends only, so anyone else following this link sees “This profile isn't available.”
        </p>
      ) : null}

      <SectionLinks shop={v.shop.length} reviews={v.reviews.length} />

      <TopFiveGallery view={v} />

      <div className="mt-20 grid grid-cols-1 gap-16 lg:grid-cols-12 lg:gap-12">
        <section aria-labelledby="shop-title" className="scroll-mt-28 lg:col-span-5">
          <SectionHeading id="shop-title" eyebrow="Shop" title="Where to buy" />
          <ShopList items={v.shop} empty="No shop links yet." />
        </section>

        <section aria-labelledby="all-title" className="scroll-mt-28 lg:col-span-7">
          <SectionHeading id="all-title" eyebrow="All reviews" title={`Reviews (${v.reviews.length})`} />
          {v.reviews.length === 0 ? (
            <p className="bg-canvas p-5 text-[15px] leading-6 text-neutral">No reviews shared here yet.</p>
          ) : (
            <ReviewRegister reviews={v.reviews} handle={p.handle} />
          )}
        </section>
      </div>

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
