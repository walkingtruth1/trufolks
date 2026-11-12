// Ticket 5 — the contacts page at /contacts (BRD v1.6 FR-02, FR-16, FR-17,
// FR-18, P1, P5, P6, LEG-01, NFR-06). Plain, unstyled on purpose (STITCH-UI-01).
//
// * Your contacts' reviews, newest first. Only reviews whose disclosure is
//   attached in full reach this page (LEG-01, gap 19 — enforced in SQL).
// * Places your contacts reviewed (FR-18); `?place=<merchantId>` shows only
//   that business's reviews.
// * Your invite link (FR-02): shown once when made; making a new one turns
//   the old one off. Your contacts, with remove / block, and the people you
//   blocked. No follower counts or ranking anywhere (FR-05, P6).
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  component: ContactsPage,
});

const UNAVAILABLE = contactMessage("unavailable") ?? "";

function longDate(isoTime: string): string {
  return new Date(isoTime).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
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
    setHome({ invite: r.invite, contacts: r.contacts, blocked: r.blocked, places: r.places, myUserId: r.myUserId });
  }, []);

  useEffect(() => {
    if (!isPending && userId) void loadHome();
  }, [isPending, userId, loadHome]);

  if (isPending) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p>Loading…</p>
      </main>
    );
  }
  if (!userId) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">Contacts</h1>
        <p>Please sign in to see reviews from people you know.</p>
        <p className="mt-2">
          <Link to="/sign-in" search={{ next: "/contacts" }} className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  const placeName = place ? home?.places.find((p) => p.merchantId === place)?.merchantName : undefined;

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-semibold">Contacts</h1>
      <p>
        <Link to="/people/$userId" params={{ userId }} className="underline">
          Your own reviews
        </Link>
      </p>

      <section className="mt-6">
        <h2 className="text-xl font-semibold">
          {place ? `Reviews of ${placeName ?? "this place"} from your contacts` : "Reviews from your contacts"}
        </h2>
        {place ? (
          <p className="mt-1">
            <Link to="/contacts" className="underline">
              Show all reviews
            </Link>
          </p>
        ) : null}
        <Feed key={place ?? ""} merchantId={place ?? null} />
      </section>

      {homeError ? <p role="alert" className="mt-6">{homeError}</p> : null}
      {home ? (
        <>
          {!place ? <Places places={home.places} /> : null}
          <InviteSection invite={home.invite} onChange={loadHome} />
          <ContactsSection home={home} onChange={loadHome} />
        </>
      ) : null}
    </main>
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
        <div key={r.reviewId}>
          <ReviewCard {...r} />
          <p className="mt-1">
            <Link to="/people/$userId" params={{ userId: r.authorId }} className="underline">
              See all of {r.reviewerName}'s reviews
            </Link>
          </p>
        </div>
      ))}
      {state === "idle" && reviews.length === 0 ? (
        <p className="mt-2">
          No reviews from your contacts yet. When people you know post a review, it shows here.
        </p>
      ) : null}
      {state === "loading" ? <p className="mt-2">Loading…</p> : null}
      {state === "error" ? <p role="alert" className="mt-2">{UNAVAILABLE}</p> : null}
      {state === "idle" && cursor ? (
        <button type="button" onClick={() => void load(cursor)} className="mt-4 rounded border px-4 py-2">
          Show more
        </button>
      ) : null}
    </>
  );
}

function Places({ places }: { places: ContactPlace[] }) {
  if (places.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="text-xl font-semibold">Places your contacts reviewed</h2>
      <ul className="mt-2">
        {places.map((p) => (
          <li key={p.merchantId} className="mt-1">
            <Link to="/contacts" search={{ place: p.merchantId }} className="underline">
              {p.merchantName}
            </Link>{" "}
            — {p.reviewCount} {p.reviewCount === 1 ? "review" : "reviews"} from {p.contactCount}{" "}
            {p.contactCount === 1 ? "contact" : "contacts"}
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteSection({ invite, onChange }: { invite: InviteState | null; onChange: () => Promise<void> }) {
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
    <section className="mt-6">
      <h2 className="text-xl font-semibold">Invite people you know</h2>
      <p className="mt-1">
        Send your invite link to people you know — by text or a message app. When they open it and accept, you both
        see each other's reviews. Anyone with the link can accept it, so only send it to people you know.
      </p>
      {link ? (
        <div className="mt-2">
          <p>Your new link. Copy it now — we only show it once:</p>
          <input readOnly value={link} className="mt-1 w-full border px-2 py-1" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => void copy()} className="mt-2 rounded border px-4 py-2">
            Copy link
          </button>
        </div>
      ) : invite ? (
        <p className="mt-2">
          You have a link made on {longDate(invite.createdAt)}. It works until {longDate(invite.expiresAt)}.
        </p>
      ) : null}
      <p className="mt-2">
        <button type="button" onClick={() => void make()} disabled={busy} className="rounded border px-4 py-2">
          {invite || link ? "Make a new link (the old one stops working)" : "Make an invite link"}
        </button>
      </p>
      {invite || link ? (
        <p className="mt-2">
          <button type="button" onClick={() => void turnOff()} disabled={busy} className="rounded border px-4 py-2">
            Turn off my link
          </button>
        </p>
      ) : null}
      {message ? <p role="status" className="mt-2">{message}</p> : null}
    </section>
  );
}

function ContactsSection({ home, onChange }: { home: Home; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(otherId: string, action: "remove" | "block" | "unblock", confirmText?: string) {
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
    <section className="mt-6">
      <h2 className="text-xl font-semibold">Your contacts</h2>
      {home.contacts.length === 0 ? <p className="mt-1">No contacts yet. Send your invite link to someone you know.</p> : null}
      <ul className="mt-2">
        {home.contacts.map((c) => (
          <li key={c.userId} className="mt-2">
            <Link to="/people/$userId" params={{ userId: c.userId }} className="underline">
              {c.name}
            </Link>{" "}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act(c.userId, "remove", `Remove ${c.name}? You'll both stop seeing each other's reviews.`)}
              className="ml-2 rounded border px-2"
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
              className="ml-2 rounded border px-2"
            >
              Block
            </button>
          </li>
        ))}
      </ul>
      {home.blocked.length > 0 ? (
        <>
          <h3 className="mt-4 font-semibold">People you blocked</h3>
          <ul className="mt-1">
            {home.blocked.map((b) => (
              <li key={b.userId} className="mt-1">
                {b.name}{" "}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(b.userId, "unblock")}
                  className="ml-2 rounded border px-2"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1">Unblocking doesn't make you contacts again. They'd need a new invite.</p>
        </>
      ) : null}
      {message ? <p role="alert" className="mt-2">{message}</p> : null}
    </section>
  );
}
