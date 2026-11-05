import { Link } from "@tanstack/react-router";
import { Shell } from "@/components/site-chrome";

const shopperSteps = [
  {
    n: "01",
    title: "Show us the receipt",
    body: "Submit a recent purchase receipt. Real ownership comes first.",
  },
  {
    n: "02",
    title: "Keep it unscripted",
    body: "Film a mobile review. What worked, what didn’t, what you’d tell a friend.",
  },
  {
    n: "03",
    title: "Get paid for your perspective",
    body: "Eligible, approved reviews can earn payment. No five-star script required.",
  },
];

const brandSteps = [
  {
    n: "01",
    title: "Start with proof",
    body: "Every review starts with a verified purchase, not a gifted product.",
  },
  {
    n: "02",
    title: "Find your next hook",
    body: "Discover candid perspectives and product moments worth testing.",
  },
  {
    n: "03",
    title: "License. Edit. Launch.",
    body: "License content for your paid social campaigns, with usage terms agreed up front.",
  },
];

export function Landing() {
  return (
    <Shell>
      <main>
        <section className="mx-auto grid w-full max-w-7xl items-start gap-10 px-5 pb-14 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:pb-20">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] uppercase">
              Bought it. Used it. Tell the truth.
            </p>
            <h1 className="mt-4 text-5xl leading-none font-black tracking-tight uppercase sm:text-6xl lg:text-7xl">
              Less influence.
              <br />
              More truth.
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed">
              Real purchases. Unscripted opinions. We connect everyday shoppers
              with brands that want content people actually believe.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/shoppers"
                className="border border-ink bg-lime px-5 py-4 text-base font-semibold"
              >
                I’m a shopper
              </Link>
              <Link
                to="/offer"
                className="border border-ink bg-ink px-5 py-4 text-base font-semibold text-cream"
              >
                I’m a brand
              </Link>
            </div>
          </div>

          <figure className="overflow-hidden border border-ink bg-ink">
            <img
              src="/review-phone.png"
              alt="A shopper in a kitchen holding a skincare bottle for an unscripted review"
              className="aspect-[4/3] w-full object-cover object-center"
            />
            <figcaption className="px-4 py-3">
              <p className="text-sm font-semibold text-lime">Verified TruFolks Creator</p>
              <p className="mt-1 text-xs text-cream/80">
                Skincare Brand ‘A’, Purchased 30 days ago. Raw Video Clip
              </p>
            </figcaption>
          </figure>
        </section>

        <div className="bg-lime px-5 py-5 text-center">
          <p className="text-sm font-extrabold tracking-wide uppercase sm:text-base">
            Zero fake reviews. 100% receipt-verified.
          </p>
        </div>

        <section className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-10 sm:py-20">
          <p className="text-xs font-medium tracking-[0.16em] uppercase">
            Real people. Real value. Both ways.
          </p>
          <div className="mt-8 grid gap-4 lg:grid-cols-2 lg:gap-5">
            <article className="flex h-full flex-col border border-ink p-6 sm:p-8">
              <p className="text-xs font-medium tracking-[0.16em] uppercase">
                01 / For everyday shoppers
              </p>
              <h2 className="mt-5 text-4xl leading-none font-black tracking-tight uppercase sm:text-5xl">
                Your opinion. Not a performance.
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed">
                You don’t need followers. You need a product you actually bought
                and something honest to say.
              </p>
              <ol className="mt-8">
                {shopperSteps.map((step) => (
                  <li key={step.n} className="border-t border-sage py-5">
                    <p className="text-xl font-bold tracking-tight">
                      {step.n} {step.title}
                    </p>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-moss">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
              <Link
                to="/shoppers"
                className="mt-auto inline-block w-fit border border-ink bg-lime px-5 py-3 text-sm font-semibold"
              >
                Join as a shopper
              </Link>
            </article>

            <article className="flex h-full flex-col bg-ink p-6 text-cream sm:p-8">
              <p className="text-xs font-semibold tracking-[0.16em] text-lime uppercase">
                02 / For brands & ad directors
              </p>
              <h2 className="mt-5 text-4xl leading-none font-black tracking-tight uppercase sm:text-5xl">
                Stop scrolls. Not trust.
              </h2>
              <p className="mt-5 max-w-md text-base leading-relaxed text-cream/85">
                License raw video hooks from real customers. Built for your next
                Meta or TikTok creative test—not another polished endorsement.
              </p>
              <ol className="mt-8">
                {brandSteps.map((step) => (
                  <li key={step.n} className="border-t border-cream/20 py-5">
                    <p className="text-xl font-bold tracking-tight">
                      {step.n} {step.title}
                    </p>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-cream/70">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
              <Link
                to="/offer"
                className="mt-auto inline-block w-fit bg-lime px-5 py-3 text-sm font-semibold text-ink"
              >
                See the 14-day pilot
              </Link>
            </article>
          </div>
        </section>
      </main>
    </Shell>
  );
}
