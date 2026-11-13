// Ticket 5 — one person's full review history at /people/<userId> (BRD v1.6
// FR-17, HON-08, P1, LEG-01; APP-17-04). No Stitch frame exists for this
// route; it reuses the shared review card and app components.
//
// Only your own page or a friend's (enforced on the server). Every rating is
// shown, newest first, with a count per star, so a pattern (e.g. only 5 stars)
// stands out without TruFolks accusing anyone. A friend's page only lists
// reviews whose disclosure is complete; your own page also lists the ones
// friends can't see yet, marked as such (gap 19).
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Alert, AppPage, Card, linkClass, Loading, PageTitle, SignInPrompt } from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { contactMessage, NOT_SHOWN_YET } from "@/lib/contacts/messages";
import { getPersonHistory } from "@/lib/contacts/server-fns";
import type { PersonHistory } from "@/lib/contacts/engine";
import { ReviewCard } from "@/lib/reviews/review-card";

export const Route = createFileRoute("/people/$userId")({ component: PersonPage });

type Page =
  | { kind: "loading" }
  | { kind: "message"; message: string }
  | { kind: "ready"; history: PersonHistory };

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
      <AppPage>
        <Loading />
      </AppPage>
    );
  }
  if (!userId) {
    return (
      <SignInPrompt
        title="Reviews"
        body="Please sign in to see reviews from your friends."
        next={`/people/${encodeURIComponent(personId)}`}
      />
    );
  }
  const back = (
    <p className="mt-6 text-sm">
      <Link to="/contacts" className={linkClass}>
        Back to your friends
      </Link>
    </p>
  );
  if (page.kind === "message") {
    return (
      <AppPage>
        <PageTitle title="Reviews" />
        <Alert>{page.message}</Alert>
        {back}
      </AppPage>
    );
  }
  if (page.kind !== "ready") return null;
  const { person, reviews, ratingCounts } = page.history;

  return (
    <AppPage>
      <PageTitle
        eyebrow={person.isSelf ? "Your reviews" : "Friend"}
        title={person.isSelf ? "Your reviews" : `${person.name}'s reviews`}
        intro={`${reviews.length} ${reviews.length === 1 ? "review" : "reviews"}, newest first.`}
      />
      {reviews.length > 0 ? (
        <Card>
          <h2 className="font-semibold">Every rating given</h2>
          <ul
            className="mt-2 grid grid-cols-5 gap-2 text-center text-sm"
            aria-label="Ratings given"
          >
            {[5, 4, 3, 2, 1].map((stars) => (
              <li key={stars} className="border border-neutral/30 py-2">
                <span className="block font-semibold">
                  {stars} {stars === 1 ? "star" : "stars"}
                </span>
                <span className="block text-lg font-black">{ratingCounts[stars - 1]}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <p>{person.isSelf ? "You haven't posted a review yet." : "No reviews yet."}</p>
        </Card>
      )}
      {reviews.map((r) => (
        <ReviewCard
          key={r.reviewId}
          {...r}
          footer={
            person.isSelf && !r.shownToContacts ? (
              <span className="text-neutral">{NOT_SHOWN_YET}</span>
            ) : undefined
          }
        />
      ))}
      {back}
    </AppPage>
  );
}
