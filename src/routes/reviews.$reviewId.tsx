// v1.7 — one review at its own link (/reviews/<id>). The original verified
// review with its rating, three answers and full disclosure, the catalog
// product and approved seller links. Who may read it is decided on the server
// (migration 0011): the author, friends (Friends only or public), and anyone
// for a review the author made public. A guest gets a sign-up invitation
// after the review.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppPage, linkClass, Loading } from "@/components/ui";
import { JoinInvite, NotShared, ProductFooter } from "@/components/profile-ui";
import type { ProfileReview } from "@/lib/profiles/engine";
import { profileMessage } from "@/lib/profiles/messages";
import { getReview } from "@/lib/profiles/server-fns";
import { ReviewCard } from "@/lib/reviews/review-card";

export const Route = createFileRoute("/reviews/$reviewId")({ component: ReviewPage });

type Page =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; review: ProfileReview; isOwner: boolean; signedIn: boolean };

function ReviewPage() {
  const { reviewId } = Route.useParams();
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setPage({ kind: "loading" });
    getReview({ data: { reviewId } })
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r) setPage({ kind: "error", message: profileMessage("unavailable") ?? "" });
        else if (!r.ok) setPage(r.reason === "not_found" ? { kind: "missing" } : { kind: "error", message: r.message });
        else setPage({ kind: "ready", review: r.review, isOwner: r.isOwner, signedIn: r.signedIn });
      });
    return () => {
      alive = false;
    };
  }, [reviewId]);

  const here = `/reviews/${encodeURIComponent(reviewId)}`;
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
        <NotShared what="review" next={here} signedIn={false} />
      </AppPage>
    );
  }
  const r = page.review;
  return (
    <AppPage tone="white">
      <p className="text-xs font-semibold tracking-[0.06em] text-secondary uppercase">
        {r.visibility === "public" ? "Public review" : "Shared with friends"}
      </p>
      <h1 className="mt-2 text-[28px] leading-9 font-bold tracking-[-0.02em] break-words">
        {r.reviewerName} on {r.product?.status === "approved" ? r.product.name : r.productLabel}
      </h1>
      <ReviewCard {...r} footer={<ProductFooter r={r} />} />
      <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {r.authorHandle ? (
          <Link to="/u/$handle" params={{ handle: r.authorHandle }} className={linkClass}>
            {page.isOwner ? "My public page" : `More from ${r.reviewerName}`}
          </Link>
        ) : null}
        {page.isOwner ? (
          <Link to="/profile" hash={`review-${r.reviewId}`} className={linkClass}>
            Manage on My Profile
          </Link>
        ) : null}
      </p>
      {!page.signedIn ? <JoinInvite next="/profile" /> : null}
    </AppPage>
  );
}
