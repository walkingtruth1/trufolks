// v1.7 — Add a review (/add-review), opened from My Profile and Rewards.
// Start with a receipt code (the existing /r/<code> flow: claim, photo,
// checks) or pick up one of the shopper's own purchases, each with its real
// status and next step. Ready purchases open the existing review form; nothing
// here changes verification, reward calculation, disclosure, preview or posting.
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ReceiptText } from "lucide-react";
import {
  Alert,
  AppPage,
  btnPrimary,
  btnSecondary,
  inputClass,
  labelClass,
  Loading,
  PageTitle,
  SignInPrompt,
  StatusBadge,
  type StatusTone,
} from "@/components/ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { MyPurchase, PurchaseState } from "@/lib/profiles/engine";
import { profileMessage, PURCHASE_STATE } from "@/lib/profiles/messages";
import { getMyPurchases } from "@/lib/profiles/server-fns";

export const Route = createFileRoute("/add-review")({ component: AddReviewPage });

const TONE: Record<PurchaseState, StatusTone> = {
  pending_photo: "flagged",
  pending: "pending",
  rejected: "forfeited",
  not_ready: "held",
  ready: "ready",
  posted: "paid",
};

type Page = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; purchases: MyPurchase[] };

function AddReviewPage() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const [page, setPage] = useState<Page>({ kind: "loading" });

  useEffect(() => {
    if (isPending || !userId) return;
    let alive = true;
    getMyPurchases()
      .catch(() => null)
      .then((r) => {
        if (!alive) return;
        if (!r || !r.ok) setPage({ kind: "error", message: r?.message ?? profileMessage("unavailable") ?? "" });
        else setPage({ kind: "ok", purchases: r.purchases });
      });
    return () => {
      alive = false;
    };
  }, [isPending, userId]);

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
        title="Add a review"
        body="Please log in to claim a receipt or review one of your purchases."
        next="/add-review"
        signUp
      />
    );
  }

  return (
    <AppPage>
      <p className="mb-4 text-sm">
        <Link to="/profile" className="font-semibold text-secondary underline">
          ← My Profile
        </Link>
      </p>
      <PageTitle
        eyebrow="Add a review"
        title="Review something you bought"
        intro="Every review starts with a checked receipt. Your rating never changes what you get back."
      />
      <ClaimReceipt />
      <section aria-labelledby="purchases-title" className="mt-10">
        <h2 id="purchases-title" className="text-xl leading-7 font-bold">
          My purchases
        </h2>
        <p className="mt-1 text-sm text-neutral">Receipts you've claimed, newest first.</p>
        <div className="mt-4">
          {page.kind === "loading" ? (
            <Loading />
          ) : page.kind === "error" ? (
            <Alert>{page.message}</Alert>
          ) : page.purchases.length === 0 ? (
            <p className="border border-dashed border-neutral/40 bg-surface p-4 text-[15px] leading-6 text-neutral">
              No purchases yet. Enter the code from your receipt above to start.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {page.purchases.map((p) => (
                <PurchaseRow key={p.purchaseId} p={p} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </AppPage>
  );
}

function ClaimReceipt() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return setError("Type the code that came with your receipt.");
    void navigate({ to: "/r/$code", params: { code: c } });
  }
  return (
    <section id="claim" aria-labelledby="claim-title" className="scroll-mt-28 border-2 border-primary bg-surface p-5 shadow-[4px_4px_0_0_var(--color-primary)] md:p-6">
      <h2 id="claim-title" className="flex items-center gap-2 text-lg leading-7 font-bold">
        <ReceiptText aria-hidden="true" size={20} className="text-secondary" /> Claim a receipt
      </h2>
      <p className="mt-1 text-[15px] leading-6 text-neutral">
        Type the short code on your receipt, or scan its TruFolks code with your camera.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="add-receipt-code" className="sr-only">
          Receipt code
        </label>
        <input
          id="add-receipt-code"
          className={`${inputClass} sm:flex-1`}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Receipt code"
        />
        <button type="submit" className={btnPrimary}>
          Continue <ArrowRight aria-hidden="true" size={16} />
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-crimson">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PurchaseRow({ p }: { p: MyPurchase }) {
  const s = PURCHASE_STATE[p.state];
  return (
    <li className="border border-neutral/20 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base leading-6 font-semibold break-words">{p.productLabel}</p>
          <p className="text-[13px] leading-5 text-neutral">
            {p.merchantName}
            {p.purchasedAt
              ? ` · ${new Date(p.purchasedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
              : ""}
          </p>
          {p.campaignName ? <p className={`${labelClass} mt-1 text-[11px] text-neutral`}>Offer: {p.campaignName}</p> : null}
        </div>
        <StatusBadge tone={TONE[p.state]}>{s.label}</StatusBadge>
      </div>
      <p className="mt-3 text-[15px] leading-6">{s.next}</p>
      {p.state === "ready" ? (
        <Link to="/review/$purchaseId" params={{ purchaseId: p.purchaseId }} className={`${btnPrimary} mt-3`}>
          Write your review <ArrowRight aria-hidden="true" size={16} />
        </Link>
      ) : p.state === "posted" && p.reviewId ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/reviews/$reviewId" params={{ reviewId: p.reviewId }} className={btnSecondary}>
            Open review
          </Link>
          <Link to="/profile" hash={`review-${p.reviewId}`} className={btnSecondary}>
            Pin or share
          </Link>
        </div>
      ) : null}
    </li>
  );
}
