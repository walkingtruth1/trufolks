import { createFileRoute, Link } from "@tanstack/react-router";
import { JoinForm } from "@/components/join-form";
import { Shell } from "@/components/site-chrome";
import { money, offer } from "@/lib/offer";

export const Route = createFileRoute("/shoppers")({
  head: () => ({
    meta: [{ title: "Shoppers — TruFolks" }],
  }),
  component: ShoppersPage,
});

function ShoppersPage() {
  return (
    <Shell>
      <main className="mx-auto grid w-full max-w-7xl gap-10 px-5 pb-20 sm:px-10 lg:grid-cols-2 lg:items-start">
        <div>
          <p className="text-xs font-medium tracking-[0.16em] uppercase">
            01 / For everyday shoppers
          </p>
          <h1 className="mt-4 text-4xl leading-none font-black tracking-tight uppercase sm:text-6xl">
            Your opinion. Not a performance.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed">
            You don’t need followers. You need a product you actually bought and
            something honest to say.
          </p>
          <ul className="mt-8 max-w-md space-y-4 text-sm leading-relaxed text-neutral">
            <li>
              <span className="font-bold text-primary">Receipt first.</span> A real
              purchase, not a gift or a script.
            </li>
            <li>
              <span className="font-bold text-primary">Film it raw.</span> Phone
              video, the way you’d tell a friend.
            </li>
            <li>
              <span className="font-bold text-primary">Get {money(offer.shopper)} if it’s used.</span>{" "}
              The brand pays that when they license the clip. If they pass, nobody
              owes anyone.
            </li>
          </ul>
          <Link to="/" className="mt-8 inline-block text-sm font-semibold underline">
            Back to TruFolks
          </Link>
        </div>
        <JoinForm role="shopper" />
      </main>
    </Shell>
  );
}
