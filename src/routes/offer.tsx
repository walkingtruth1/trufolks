import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckoutWidget } from "@/components/checkout-widget";
import { JoinForm } from "@/components/join-form";
import { LicenseDesk } from "@/components/license-desk";
import { Shell } from "@/components/site-chrome";
import { money, offer } from "@/lib/offer";

const note = `We get real customers, not creators, to film what they actually think after they buy.

In ${offer.days} days you get up to ${offer.clips} raw clips. Receipt on every one. You pay nothing to look. ${money(offer.license)} only if you license a clip for Meta or TikTok. The buyer gets ${money(offer.shopper)} back. If you pass, you owe nothing.

Want the first batch on one product?`;

export const Route = createFileRoute("/offer")({
  head: () => ({
    meta: [
      { title: "14-day pilot — TruFolks" },
      {
        name: "description",
        content:
          "Ten receipt-verified customer videos in 14 days. Pay only for the clips you run as ads.",
      },
    ],
  }),
  component: OfferPage,
});

function OfferPage() {
  return (
    <Shell>
      <main className="mx-auto w-full max-w-7xl px-5 pb-20 sm:px-10">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase">
          The pilot · for one product
        </p>
        <h1 className="mt-4 max-w-4xl text-4xl leading-none font-black tracking-tight uppercase sm:text-6xl">
          Ten real buyers. {offer.days} days. Pay only for the clips you run.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed">
          UGC you can buy today is actors with a brief. This is someone who
          already paid for the product, filmed it on a phone, and gets paid only
          if you use it.
        </p>

        <dl className="mt-10 grid border border-ink sm:grid-cols-4">
          <Stat k="To look" v={money(0)} />
          <Stat k="To license one clip" v={money(offer.license)} />
          <Stat k="Buyer gets back" v={money(offer.shopper)} />
          <Stat k="You can run it" v={`${offer.usageDays} days`} />
        </dl>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] uppercase">
              Where this sits later
            </p>
            <h2 className="mt-3 text-3xl leading-none font-black tracking-tight uppercase">
              Every checkout. Not a casting call.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-moss">
              The billion-dollar version is this box on the thank-you page. You
              do not build that first. You sell this pilot by hand. The embed
              comes after brands are already paying to license.
            </p>
            <ol className="mt-6 max-w-md space-y-3 text-sm leading-relaxed">
              <li>
                <span className="font-bold">1.</span> Buyer checks out as they do today.
              </li>
              <li>
                <span className="font-bold">2.</span> They can film an honest take. No script.
              </li>
              <li>
                <span className="font-bold">3.</span> You have {offer.reviewDays} days to license it or pass.
              </li>
              <li>
                <span className="font-bold">4.</span> Their refund is your license fee, not your cash.
              </li>
            </ol>
          </div>
          <CheckoutWidget />
        </div>

        <section className="mt-16">
          <p className="text-xs font-semibold tracking-[0.16em] uppercase">
            Click it like a buyer’s video just landed
          </p>
          <h2 className="mt-3 text-3xl leading-none font-black tracking-tight uppercase">
            License it, or pay nothing.
          </h2>
          <div className="mt-6">
            <LicenseDesk />
          </div>
        </section>

        <section className="mt-16 grid items-start gap-10 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] uppercase">
              The note you send
            </p>
            <h2 className="mt-3 text-3xl leading-none font-black tracking-tight uppercase">
              Don’t pitch a platform. Pitch one product.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-moss">
              Ad management comes after the first clip is running. Then you can
              place it on Meta and get paid from their ad budget. Not before.
              Charging to “be the agency” before a license is how this dies.
            </p>
            <CopyNote />
            <Link to="/" className="mt-6 inline-block text-sm font-semibold underline">
              Back to TruFolks
            </Link>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold tracking-[0.16em] uppercase">
              Ask for the pilot
            </p>
            <JoinForm role="brand" />
          </div>
        </section>
      </main>
    </Shell>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-ink p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <dt className="text-xs font-medium tracking-[0.14em] text-moss uppercase">{k}</dt>
      <dd className="mt-2 text-2xl font-black tracking-tight">{v}</dd>
    </div>
  );
}

function CopyNote() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-6 border border-ink p-4">
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{note}</p>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(note);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
        className="mt-4 bg-lime px-4 py-3 text-sm font-semibold text-ink"
      >
        {copied ? "Copied" : "Copy the note"}
      </button>
    </div>
  );
}
