import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/site-chrome";
import { money, offer } from "@/lib/offer";

export const Route = createFileRoute("/brands")({
  head: () => ({
    meta: [{ title: "Brands — TruFolks" }],
  }),
  component: BrandsPage,
});

function BrandsPage() {
  return (
    <Shell>
      <main className="mx-auto w-full max-w-3xl px-5 pb-20 sm:px-10">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase">
          For brands
        </p>
        <h1 className="mt-4 text-4xl leading-none font-black tracking-tight uppercase sm:text-6xl">
          Pay only for the clips you run.
        </h1>
        <p className="mt-5 text-base leading-relaxed">
          Up to {offer.clips} receipt-verified videos in {offer.days} days.{" "}
          {money(0)} to look. {money(offer.license)} to license one for{" "}
          {offer.usageDays} days on Meta or TikTok.
        </p>
        <Link
          to="/offer"
          className="mt-8 inline-block bg-lime px-5 py-4 text-base font-semibold text-ink"
        >
          Read the pilot
        </Link>
      </main>
    </Shell>
  );
}
