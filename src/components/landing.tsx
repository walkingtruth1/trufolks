// Home at / (BRD v1.7 section 9; v1.9 final design work order). Split
// composition: on the left the owner-approved headline "Find something worth
// trying.", one trust line, a single dominant Get started action (signed-in
// visitors get Go to My Profile), with Log in, How It Works and Have a
// receipt? kept secondary. On the right, one example still at a time with a
// short caption, switched by Product example / Service example (keyboard and
// touch swipe; no autoplay). Both stills and captions are labelled as
// examples: they are not real reviews or members. On phones the headline and
// action come before the picture. The detailed explainer and receipt lookup
// stay at /how-it-works; old /#how, /#terms… bookmarks are forwarded there.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, ReceiptText } from "lucide-react";
import { Shell } from "@/components/site-chrome";
import { HOW_IT_WORKS_SECTIONS } from "@/components/how-it-works";
import { btnAction, galleryLabel } from "@/components/gallery";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const LEGACY_FRAGMENTS = new Set<string>(HOW_IT_WORKS_SECTIONS.map((s) => s.id));

type ExampleId = "product" | "service";

const EXAMPLES: Record<
  ExampleId,
  { tab: string; kind: string; title: string; quote: string; src: string; alt: string }
> = {
  product: {
    tab: "Product example",
    kind: "Product",
    title: "Hario V60 ceramic dripper",
    quote: "Easy to get right every morning, and it rinses clean in seconds.",
    src: "/examples/home-product-v60-pour-over.jpg",
    alt: "Example: someone pouring water from a kettle into a white ceramic pour-over dripper in a sunny kitchen",
  },
  service: {
    tab: "Service example",
    kind: "Service",
    title: "Interior detail at a local auto shop",
    quote: "The seats look new again. Worth booking before a long drive.",
    src: "/examples/home-service-auto-detail.jpg",
    alt: "Example: a customer checking the freshly cleaned leather seats of his car after an interior detail",
  },
};
const ORDER: ExampleId[] = ["product", "service"];

export function Landing() {
  const navigate = useNavigate();
  const { user, isPending } = useCurrentUserState();
  const signedIn = !isPending && Boolean(user);

  // Old homepage bookmarks (/#how, /#faq, /#receipt…) now live on /how-it-works.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!LEGACY_FRAGMENTS.has(id)) return;
    void navigate({ to: "/how-it-works", hash: id, replace: true }).then(() => {
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    });
  }, [navigate]);

  const secondary = "inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold tracking-[0.06em] text-black uppercase hover:underline";

  return (
    <Shell>
      <main className="w-full flex-1 bg-surface pt-16 text-black md:pt-20">
        <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-12 px-4 py-10 md:px-8 md:py-16 lg:grid-cols-12 lg:gap-16 lg:px-16 lg:py-24">
          <section aria-labelledby="welcome-title" className="lg:col-span-5 lg:pt-10">
            <p className={`${galleryLabel} inline-flex items-center gap-2 text-neutral`}>
              <span className="inline-block h-2 w-2 bg-black" aria-hidden="true" />
              Verified purchases · Friends first
            </p>
            <h1
              id="welcome-title"
              className="mt-5 text-[40px] leading-[44px] font-bold tracking-[-0.03em] text-black min-[380px]:text-[46px] min-[380px]:leading-[50px] md:text-[64px] md:leading-[68px] xl:text-[76px] xl:leading-[78px]"
            >
              Find something worth trying.
            </h1>
            <p className="mt-6 max-w-md text-[17px] leading-7 text-black/75 md:text-lg md:leading-8">
              Recommendations from people you know. Reviews marked{" "}
              <strong className="font-semibold text-black">Verified purchase</strong> are backed by a checked receipt.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              {signedIn ? (
                <Link to="/profile" className={btnAction}>
                  Go to My Profile <ArrowRight aria-hidden="true" size={18} />
                </Link>
              ) : (
                <Link to="/sign-up" search={{ next: "/profile" }} className={btnAction}>
                  Get started <ArrowRight aria-hidden="true" size={18} />
                </Link>
              )}
              <Link to="/how-it-works" className={secondary}>
                How it works <ArrowRight aria-hidden="true" size={16} />
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-1 text-[15px] text-black/70">
              {signedIn || isPending ? null : (
                <p>
                  Already a member?{" "}
                  <Link to="/sign-in" className="font-semibold text-black underline underline-offset-4">
                    Log in
                  </Link>
                </p>
              )}
              <Link to="/how-it-works" hash="receipt" className="inline-flex min-h-11 items-center gap-1.5 hover:text-black hover:underline">
                <ReceiptText aria-hidden="true" size={16} />
                Have a receipt?
              </Link>
            </div>
          </section>

          <ExampleStills />
        </div>
      </main>
    </Shell>
  );
}

/** One example still at a time. Buttons (and arrow keys) or a sideways swipe switch it. */
function ExampleStills() {
  const [active, setActive] = useState<ExampleId>("product");
  const refs = useRef<Record<ExampleId, HTMLButtonElement | null>>({ product: null, service: null });
  const start = useRef<{ x: number; y: number } | null>(null);
  const ex = EXAMPLES[active];

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next: ExampleId = e.key === "Home" ? "product" : e.key === "End" ? "service" : active === "product" ? "service" : "product";
    setActive(next);
    refs.current[next]?.focus();
  }
  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
  }
  function onUp(e: PointerEvent<HTMLDivElement>) {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(e.clientY - s.y)) return;
    setActive(dx < 0 ? "service" : "product");
  }

  return (
    <section aria-label="Examples of what people recommend" className="lg:col-span-7">
      <div role="group" aria-label="Choose an example" className="flex flex-wrap gap-2">
        {ORDER.map((id) => {
          const on = id === active;
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[id] = el;
              }}
              type="button"
              aria-pressed={on}
              aria-controls="example-still"
              onClick={() => setActive(id)}
              onKeyDown={onKey}
              className={`inline-flex min-h-11 items-center gap-2 border px-4 text-xs font-semibold tracking-[0.08em] uppercase ${
                on ? "border-black bg-black text-white" : "border-black/15 bg-surface text-black hover:border-black"
              }`}
            >
              {on ? <Check aria-hidden="true" size={14} /> : null}
              {EXAMPLES[id].tab}
            </button>
          );
        })}
      </div>

      <figure id="example-still" aria-live="polite" className="mt-5">
        <div
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => (start.current = null)}
          className="aspect-[4/3] touch-pan-y overflow-hidden bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.25)] select-none"
        >
          <img key={ex.src} src={ex.src} alt={ex.alt} draggable={false} className="h-full w-full object-cover" />
        </div>
        <figcaption className="mt-5">
          <p className={`${galleryLabel} text-neutral`}>Example · {ex.kind}</p>
          <p className="mt-1.5 text-xl leading-7 font-semibold tracking-[-0.01em] text-black md:text-2xl md:leading-8">{ex.title}</p>
          <p className="mt-1 text-[15px] leading-7 text-black/75 md:text-base">“{ex.quote}”</p>
        </figcaption>
      </figure>
      <p className="sr-only">Swipe sideways on the picture, or use the buttons above, to switch examples.</p>
    </section>
  );
}
