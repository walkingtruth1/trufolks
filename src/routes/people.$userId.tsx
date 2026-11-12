// Ticket 5 — one person's full review history at /people/<userId> (BRD v1.6
// FR-17, HON-08, P1, LEG-01). Plain, unstyled on purpose (STITCH-UI-01).
//
// Only your own page or a contact's. Every rating is shown, newest first,
// with a count per star, so a pattern (e.g. only 5 stars) stands out without
// TruFolks accusing anyone. A contact's page only lists reviews whose
// disclosure is complete; your own page also lists the ones contacts can't
// see yet, marked as such (gap 19).
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { contactMessage, NOT_SHOWN_YET } from "@/lib/contacts/messages";
import { getPersonHistory } from "@/lib/contacts/server-fns";
import type { PersonHistory } from "@/lib/contacts/engine";
import { ReviewCard } from "@/lib/reviews/review-card";

export const Route = createFileRoute("/people/$userId")({ component: PersonPage });

type Page = { kind: "loading" } | { kind: "message"; message: string } | { kind: "ready"; history: PersonHistory };

function PersonPage() {
  const { userId: personId } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    if (isPending || !userId) return;
    let alive = true;
    setPage({ kind: "loading" });
    getPersonHistory({ data: { userId: personId } })
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r) setPage({ kind: "message", message: contactMessage("unavailable") ?? "" });
        else if (!r.ok) setPage({ kind: "message", message: r.message });
        else setPage({ kind: "ready", history: r.history });
      });
    return () => {
      alive = false;
    };
  }, [personId, isPending, userId]);

  if (isPending || (userId && page.kind === "loading")) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!userId) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Please sign in to see reviews from people you know.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: `/people/${encodeURIComponent(personId)}` }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }
  if (page.kind === "message") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">Reviews</h1>
        <p role="alert">{page.message}</p>
        <p className="mt-4">
          <Link to="/contacts" className="underline">
            Back to your contacts
          </Link>
        </p>
      </main>
    );
  }
  if (page.kind !== "ready") return null;
  const { person, reviews, ratingCounts } = page.history;

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">{person.isSelf ? "Your reviews" : `${person.name}'s reviews`}</h1>
      <p>
        {reviews.length} {reviews.length === 1 ? "review" : "reviews"}, newest first.
      </p>
      {reviews.length > 0 ? (
        <ul className="mt-2" aria-label="Ratings given">
          {[5, 4, 3, 2, 1].map((stars) => (
            <li key={stars}>
              {stars} {stars === 1 ? "star" : "stars"}: {ratingCounts[stars - 1]}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2">{person.isSelf ? "You haven't posted a review yet." : "No reviews yet."}</p>
      )}
      {reviews.map((r) => (
        <div key={r.reviewId}>
          <ReviewCard {...r} />
          {person.isSelf && !r.shownToContacts ? <p className="mt-1">{NOT_SHOWN_YET}</p> : null}
        </div>
      ))}
      <p className="mt-4">
        <Link to="/contacts" className="underline">
          Back to your contacts
        </Link>
      </p>
    </main>
  );
}
