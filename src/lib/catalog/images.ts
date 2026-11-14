// v1.9 — pictures for Top 5 picks and product pages.
//
// The catalog has no image field yet (adding one needs its own migration and
// an approval step for uploads), so a real entry shows the designed no-image
// state. APPROVED is where owner-approved or supplied pictures for real
// catalog records go, keyed by the start of the record's slug.
//
// SAMPLES are Stitch stills used only to show the gallery with pictures in
// local QA. They are opt-in: a dev server started with
// VITE_TRUFOLKS_SAMPLE_IMAGES=1 and the git-ignored files in public/qa-samples/.
// Never in a build, so staging and production never put an illustrative
// picture on a real entry. A fresh checkout without the files shows the
// no-photo state (PickPicture also falls back if any picture fails to load).
export interface PickImage {
  src: string;
  alt: string;
}

const APPROVED: Record<string, PickImage> = {};

const SAMPLES: Record<string, PickImage> = {
  "hario-v60": { src: "/qa-samples/v60-plinth.jpg", alt: "A white ceramic pour-over dripper on a pale plinth" },
  "kettle-stone": { src: "/qa-samples/cardamom-bun.jpg", alt: "A cardamom bun on a plate" },
  "field-notes": { src: "/qa-samples/notebook.jpg", alt: "An orange pocket notebook beside a pencil" },
  chemex: { src: "/qa-samples/chemex.jpg", alt: "A glass pour-over coffeemaker on a wooden bench" },
  "krown-hardware": { src: "/qa-samples/brass-pull.jpg", alt: "A brass cabinet pull on a dark wood door" },
};

const samplesOn = import.meta.env.DEV && import.meta.env.VITE_TRUFOLKS_SAMPLE_IMAGES === "1";

function match(table: Record<string, PickImage>, slug: string): PickImage | null {
  for (const [prefix, img] of Object.entries(table)) if (slug.startsWith(prefix)) return img;
  return null;
}

/** The picture for an approved catalog record, or null for the no-image state. */
export function catalogImage(slug: string | null | undefined): PickImage | null {
  if (!slug) return null;
  return match(APPROVED, slug) ?? (samplesOn ? match(SAMPLES, slug) : null);
}

/** Product page hero: a larger sample still for the V60 in local QA only. */
export function catalogHero(slug: string | null | undefined): PickImage | null {
  if (slug && samplesOn && slug.startsWith("hario-v60") && !match(APPROVED, slug)) {
    return { src: "/qa-samples/v60-pedestal.jpg", alt: "A white ceramic pour-over dripper on a concrete block" };
  }
  return catalogImage(slug);
}
