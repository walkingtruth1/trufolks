// Ticket 5 — the Friends page at /contacts (BRD v1.6 FR-02, FR-16, FR-17,
// FR-18, P1, P5, P6, LEG-01, NFR-06; APP-17-04). Styled from the Stitch
// Contacts pair (visual reference only). Shoppers see "Friends"; the route,
// code and tables keep "contacts".
//
// * Recent reviews from friends, newest first. Only reviews whose disclosure
//   is attached in full reach this page (LEG-01, gap 19 — enforced in SQL).
// * Places your friends reviewed (FR-18); `?place=<merchantId>` shows only
//   that business's reviews.
// * Your invite link (FR-02): shown once when made; making a new one turns
//   the old one off. Friendship needs the other person to accept. No address
//   book access. Your friends, with remove / block, and the people you
//   blocked. No follower counts or ranking anywhere (FR-05, P6).
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Link2, UserPlus } from "lucide-react";
import {
  Alert,
  AppPage,
  btnDark,
  btnDestructive,
  btnPrimary,
  btnSecondary,
  Card,
  labelClass,
  linkClass,
  Loading,
  PageTitle,
  SectionTitle,
  SignInPrompt,
} from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { contactMessage } from "@/lib/contacts/messages";
import {
  changeContact,
  createInviteLink,
  getContactFeed,
  getContactsHome,
  revokeInviteLink,
} from "@/lib/contacts/server-fns";
import type { ContactList, ContactPlace, ContactReview, InviteState } from "@/lib/contacts/engine";
import { ReviewCard } from "@/lib/reviews/review-card";

export const Route = createFileRoute("/contacts")({
  validateSearch: (search: Record<string, unknown>): { place?: string } =>
    typeof search.place === "string" && search.place.length <= 100 ? { place: search.place } : {},
  head: () => ({ meta: [{ title: "Friends — TruFolks" }] }),
  component: ContactsPage,
});

const UNAVAILABLE = contactMessage("unavailable") ?? "";

function longDate(isoTime: string): string {
  return new Date(isoTime).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

type Home = {
  invite: InviteState | null;
  contacts: ContactList["contacts"];
  blocked: ContactList["blocked"];
  places: ContactPlace[];
  myUserId: string;
};

function ContactsPage() {
  const { place } = Route.useSearch();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [home, setHome] = useState<Home | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);

  const loadHome = useCallback(async () => {
    const r = await getContactsHome().catch(() => null);
    if (!r || !r.ok) {
      setHomeError(r?.message ?? UNAVAILABLE);
      return;
    }
    setHomeError(null);
    setHome({
      invite: r.invite,
      contacts: r.contacts,
      blocked: r.blocked,
      places: r.places,
      myUserId: r.myUserId,
    });
  }, []);

  useEffect(() => {
    if (!isPending && userId) void loadHome();
  }, [isPending, userId, loadHome]);

  if (isPending) {
    return (
      <AppPage>
        <Loading />
      </AppPage>
    );
  }
  if (!userId) {
    return (
      <SignInPrompt
        title="Friends"
        body="Please sign in to see what your friends recommend."
        next="/contacts"
      />
    );
  }

  const placeName = place
    ? home?.places.find((p) => p.merchantId === place)?.merchantName
    : undefined;

  return (
    <AppPage width="wide">
      <PageTitle
        eyebrow="Friends"
        title="What your friends recommend"
        intro="Honest reviews of verified purchases from people who accepted your invite, or whose invite you accepted. Every rating shows — good, mixed and bad."
      />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-x-6">
        <section
          aria-labelledby="feed-title"
          className="order-2 lg:order-none lg:col-start-1 lg:row-span-3 lg:row-start-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 bg-tint p-1.5">
            <div className="flex flex-wrap gap-1">
              <h2 id="feed-title" className={`${labelClass} bg-primary px-4 py-2.5 text-white`}>
                {place ? `Reviews of ${placeName ?? "this place"}` : "Friends' reviews"}
              </h2>
              <Link
                to="/people/$userId"
                params={{ userId }}
                className={`${labelClass} px-4 py-2.5 text-neutral hover:text-primary`}
              >
                Your own reviews
              </Link>
            </div>
            {place ? (
              <Link to="/contacts" className={`${labelClass} px-3 py-2 text-secondary`}>
                Show all reviews
              </Link>
            ) : (
              <span className={`${labelClass} px-3 py-2 text-neutral`}>Newest first</span>
            )}
          </div>
          <div className="mt-2 border-t-[3px] border-secondary" aria-hidden="true" />
          <Feed key={place ?? ""} merchantId={place ?? null} />
        </section>

        {homeError ? (
          <div className="order-1 lg:order-none lg:col-start-2 lg:row-start-1">
            <Alert>{homeError}</Alert>
          </div>
        ) : null}
        {home ? (
          <>
            <div className="order-1 lg:order-none lg:col-start-2 lg:row-start-1">
              <InviteSection invite={home.invite} onChange={loadHome} />
            </div>
            {!place ? (
              <div className="order-3 lg:order-none lg:col-start-2 lg:row-start-2">
                <Places places={home.places} />
              </div>
            ) : null}
            <div className="order-4 lg:order-none lg:col-start-2 lg:row-start-3">
              <ContactsSection home={home} onChange={loadHome} />
            </div>
          </>
        ) : null}
      </div>
    </AppPage>
  );
}

function Feed({ merchantId }: { merchantId: string | null }) {
  const [reviews, setReviews] = useState<ContactReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");

  const load = useCallback(
    async (before: string | null) => {
      setState("loading");
      const r = await getContactFeed({ data: { before, merchantId } }).catch(() => null);
      if (!r || !r.ok) {
        setState("error");
        return;
      }
      setReviews((prev) => (before ? [...prev, ...r.reviews] : r.reviews));
      setCursor(r.nextCursor);
      setState("idle");
    },
    [merchantId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <>
      {reviews.map((r) => (
        <ReviewCard
          key={r.reviewId}
          {...r}
          footer={
            <Link to="/people/$userId" params={{ userId: r.authorId }} className={linkClass}>
              See all of {r.reviewerName}'s reviews
            </Link>
          }
        />
      ))}
      {state === "idle" && reviews.length === 0 ? (
        <Card className="mt-4">
          <p>No reviews from your friends yet. When a friend posts a review, it shows here.</p>
          <p className="mt-2 text-sm text-neutral">
            Send your invite link to someone you know to get started.
          </p>
        </Card>
      ) : null}
      {state === "loading" ? (
        <div className="mt-4">
          <Loading />
        </div>
      ) : null}
      {state === "error" ? (
        <div className="mt-4">
          <Alert>{UNAVAILABLE}</Alert>
        </div>
      ) : null}
      {state === "idle" && cursor ? (
        <button
          type="button"
          onClick={() => void load(cursor)}
          className={btnDark + " mt-4 w-full"}
        >
          Show more
        </button>
      ) : null}
    </>
  );
}

function Places({ places }: { places: ContactPlace[] }) {
  if (places.length === 0) return null;
  return (
    <Card>
      <SectionTitle>Places your friends reviewed</SectionTitle>
      <ul className="mt-4 flex flex-col gap-2 text-[15px]">
        {places.map((p) => (
          <li key={p.merchantId}>
            <Link
              to="/contacts"
              search={{ place: p.merchantId }}
              className="flex items-center justify-between gap-3 bg-tint px-3 py-2.5 hover:bg-tint-strong"
            >
              <span className="min-w-0">
                <span className="block font-medium">{p.merchantName}</span>
                <span className="block text-[13px] leading-5 text-neutral">
                  {p.reviewCount} {p.reviewCount === 1 ? "review" : "reviews"} from {p.contactCount}{" "}
                  {p.contactCount === 1 ? "friend" : "friends"}
                </span>
              </span>
              <span className="shrink-0 bg-surface px-2 py-0.5 text-xs font-semibold">
                {p.reviewCount}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InviteSection({
  invite,
  onChange,
}: {
  invite: InviteState | null;
  onChange: () => Promise<void>;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function make() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await createInviteLink().catch(() => null);
    if (!r || !r.ok) setMessage(r?.message ?? UNAVAILABLE);
    else {
      setLink(`${window.location.origin}/invite/${r.token}`);
      await onChange();
    }
    setBusy(false);
  }

  async function turnOff() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await revokeInviteLink().catch(() => null);
    if (!r || !r.ok) setMessage(r?.message ?? UNAVAILABLE);
    else {
      setLink(null);
      await onChange();
    }
    setBusy(false);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Copied.");
    } catch {
      setMessage("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  return (
    <Card className="bg-surface">
      <p className={`${labelClass} flex items-center gap-1.5 text-secondary`}>
        <UserPlus aria-hidden="true" size={14} />
        Invite a friend
      </p>
      <h2 className="mt-2 text-xl leading-7 font-semibold">Make an invite link</h2>
      <p className="mt-2 text-[13px] leading-5 text-neutral">
        Send your invite link to a friend — by text or a message app. When they open it and accept,
        you both see each other's reviews. Anyone with the link can accept it, so only send it to
        people you know.
      </p>
      {link ? (
        <div className="mt-4 bg-tint p-2">
          <p className={`${labelClass} px-1 pb-1.5 text-neutral`}>
            Your new link — copy it now, we only show it once
          </p>
          <div className="flex items-center gap-2 bg-surface px-2">
            <Link2 aria-hidden="true" size={16} className="shrink-0 text-neutral" />
            <input
              readOnly
              value={link}
              aria-label="Your invite link"
              className="w-full bg-surface py-2 font-mono text-[13px] text-primary"
              onFocus={(e) => e.target.select()}
            />
          </div>
          <button type="button" onClick={() => void copy()} className={btnPrimary + " mt-2 w-full"}>
            Copy link
          </button>
        </div>
      ) : invite ? (
        <p className="mt-4 bg-tint p-3 text-[13px] leading-5">
          You have a link made on {longDate(invite.createdAt)}. It works until{" "}
          {longDate(invite.expiresAt)}.
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void make()}
          disabled={busy}
          className={(invite || link ? btnSecondary : btnPrimary) + " w-full"}
        >
          {invite || link ? "Make a new link (the old one stops working)" : "Make an invite link"}
        </button>
        {invite || link ? (
          <button
            type="button"
            onClick={() => void turnOff()}
            disabled={busy}
            className={btnSecondary + " w-full"}
          >
            Turn off my link
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      ) : null}
    </Card>
  );
}

function ContactsSection({ home, onChange }: { home: Home; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(
    otherId: string,
    action: "remove" | "block" | "unblock",
    confirmText?: string,
  ) {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(otherId);
    setMessage(null);
    const r = await changeContact({ data: { userId: otherId, action } }).catch(() => null);
    if (!r || !r.ok) setMessage(r?.message ?? UNAVAILABLE);
    await onChange();
    setBusy(null);
  }

  return (
    <Card>
      <SectionTitle>Your friends</SectionTitle>
      {home.contacts.length === 0 ? (
        <p className="mt-2 text-sm">No friends yet. Send your invite link to someone you know.</p>
      ) : null}
      <ul className="mt-4 flex flex-col gap-2">
        {home.contacts.map((c) => (
          <li
            key={c.userId}
            className="flex flex-wrap items-center justify-between gap-2 bg-tint px-3 py-2"
          >
            <Link to="/people/$userId" params={{ userId: c.userId }} className={linkClass}>
              {c.name}
            </Link>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void act(
                    c.userId,
                    "remove",
                    `Remove ${c.name}? You'll both stop seeing each other's reviews.`,
                  )
                }
                className={btnSecondary + " min-h-9 px-3 py-1.5"}
              >
                Remove
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void act(
                    c.userId,
                    "block",
                    `Block ${c.name}? You'll both stop seeing each other's reviews, and they can't use your invite link.`,
                  )
                }
                className={btnDestructive}
              >
                Block
              </button>
            </span>
          </li>
        ))}
      </ul>
      {home.blocked.length > 0 ? (
        <div className="mt-4 border-t border-neutral/20 pt-3">
          <h3 className="font-semibold">People you blocked</h3>
          <ul className="mt-1 divide-y divide-neutral/20">
            {home.blocked.map((b) => (
              <li key={b.userId} className="flex items-center justify-between gap-2 py-2">
                {b.name}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(b.userId, "unblock")}
                  className={btnSecondary + " min-h-9 px-3 py-1.5"}
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-neutral">
            Unblocking doesn't make you friends again. They'd need a new invite.
          </p>
        </div>
      ) : null}
      {message ? (
        <div className="mt-2">
          <Alert>{message}</Alert>
        </div>
      ) : null}
    </Card>
  );
}
