import { useState } from "react";
import { money, offer } from "@/lib/offer";

type Decision = "open" | "licensed" | "passed";

export function LicenseDesk() {
  const [decision, setDecision] = useState<Decision>("open");

  return (
    <article className="border border-primary bg-tertiary text-canvas">
      <div className="grid md:grid-cols-[220px_1fr]">
        <img
          src="/review-phone.png"
          alt="Sample raw clip still"
          className="h-56 w-full object-cover object-center md:h-full"
        />
        <div className="p-5 sm:p-6">
          <p className="text-xs font-semibold tracking-[0.16em] text-canvas uppercase">
            Sample clip · receipt verified
          </p>
          <h3 className="mt-2 text-2xl leading-tight font-black tracking-tight">
            Skincare brand A. Bought 30 days ago.
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-canvas/75">
            Raw phone video. Not gifted. Not scripted. You have {offer.reviewDays}{" "}
            days to license it or let it expire.
          </p>

          {decision === "open" ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setDecision("licensed")}
                className="bg-secondary px-4 py-3 text-sm font-semibold text-white"
              >
                License for {money(offer.license)}
              </button>
              <button
                type="button"
                onClick={() => setDecision("passed")}
                className="border border-canvas/40 px-4 py-3 text-sm font-semibold"
              >
                Pass. Pay nothing.
              </button>
            </div>
          ) : null}

          {decision === "licensed" ? (
            <div className="mt-5 border border-secondary bg-secondary p-4 text-white">
              <p className="text-xs font-semibold tracking-[0.16em] uppercase">Licensed</p>
              <p className="mt-2 text-sm leading-relaxed">
                You pay {money(offer.license)}. The buyer gets {money(offer.shopper)}.
                TruFolks keeps {money(offer.keep)}. That {money(offer.keep)} pays for
                the next batch of receipts. You get {offer.usageDays} days on Meta or
                TikTok. You did not fund this with your own cash.
              </p>
            </div>
          ) : null}

          {decision === "passed" ? (
            <p className="mt-5 text-sm leading-relaxed text-canvas/80">
              Passed. Invoice is {money(0)}. The clip is not yours to run.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
