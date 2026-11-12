import { useState } from "react";
import { money, offer } from "@/lib/offer";

type Step = "thanks" | "film" | "sent";

export function CheckoutWidget() {
  const [step, setStep] = useState<Step>("thanks");

  return (
    <div className="border border-primary bg-canvas">
      <div className="flex items-center justify-between border-b border-primary px-4 py-3">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase">Thank-you page</p>
        <p className="text-xs text-neutral">What the buyer sees</p>
      </div>
      <div className="p-5 sm:p-6">
        {step === "thanks" ? (
          <>
            <p className="text-xs font-medium tracking-[0.16em] text-neutral uppercase">
              Order confirmed
            </p>
            <p className="mt-2 text-2xl leading-tight font-black tracking-tight">
              Your cleanser is on the way.
            </p>
            <div className="mt-5 border border-primary bg-secondary/10 p-4">
              <p className="text-xs font-semibold tracking-[0.16em] uppercase">
                Want money back?
              </p>
              <p className="mt-2 text-base leading-snug font-semibold">
                Use it. Film 30 seconds of what you actually think. If the brand
                licenses the clip within {offer.reviewDays} days, you get{" "}
                {money(offer.shopper)} back on this order.
              </p>
              <button
                type="button"
                onClick={() => setStep("film")}
                className="mt-4 bg-tertiary px-4 py-3 text-sm font-semibold text-canvas"
              >
                I’ll film it
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-neutral">
              No followers. No script. If they pass, you owe nothing and they
              owe you nothing.
            </p>
          </>
        ) : null}

        {step === "film" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setStep("sent");
            }}
          >
            <p className="text-xs font-semibold tracking-[0.16em] uppercase">
              Unscripted. 30 seconds.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral">
              The receipt is already on the order. Say what worked, what didn’t,
              and whether you’d tell a friend.
            </p>
            <label className="mt-4 block text-xs font-semibold tracking-[0.16em] text-neutral uppercase">
              What would you tell a friend?
              <textarea
                name="take"
                required
                rows={4}
                placeholder="Honest take. Not a five-star script."
                className="mt-2 w-full border border-primary bg-canvas px-3 py-3 text-base font-normal tracking-normal text-primary normal-case outline-none placeholder:text-neutral/70 focus:bg-secondary/10"
              />
            </label>
            <button
              type="submit"
              className="mt-4 bg-tertiary px-4 py-3 text-sm font-semibold text-canvas"
            >
              Send it for review
            </button>
          </form>
        ) : null}

        {step === "sent" ? (
          <>
            <p className="text-xs font-semibold tracking-[0.16em] uppercase">In review</p>
            <p className="mt-2 text-2xl leading-tight font-black tracking-tight">
              The brand has {offer.reviewDays} days.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              If they license it for an ad, {money(offer.shopper)} comes back to
              you. If they don’t, the clip expires. TruFolks never pays you out
              of pocket.
            </p>
            <button
              type="button"
              onClick={() => setStep("thanks")}
              className="mt-4 text-sm font-semibold underline"
            >
              Replay the thank-you page
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
