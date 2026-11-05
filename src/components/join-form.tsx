import { useState, type FormEvent } from "react";
import { saveLead, type LeadRole } from "@/lib/leads";

const copy = {
  shopper: {
    detail: "What did you buy?",
    detailHint: "Product and brand",
    extra: "Where did you buy it?",
    extraHint: "Store, site, or retailer",
    submit: "Put me on the list",
    done: "You’re in. When a brand wants a real take on something you bought, this is how we find you.",
  },
  brand: {
    detail: "Brand or company",
    detailHint: "Who’s looking for the hook",
    extra: "What do you want to test?",
    extraHint: "Product, channel, Meta or TikTok",
    submit: "Request the pilot",
    done: "Request saved. One product, 14 days, pay only if you license a clip.",
  },
} as const;

export function JoinForm({ role }: { role: LeadRole }) {
  const text = copy[role];
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const detail = String(data.get("detail") || "").trim();
    const extra = String(data.get("extra") || "").trim();

    if (!name || !email || !email.includes("@") || !detail) {
      setError("Name, a real email, and the first detail are required.");
      return;
    }

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: data,
      });
      const result = await response.json();

      if (result.success) {
        saveLead({ role, name, email, detail, extra });
        setError("");
        setDone(true);
      } else {
        setError(result.message || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  }

  if (done) {
    return (
      <div className="border border-ink bg-lime p-6 sm:p-8">
        <p className="text-xs font-semibold tracking-[0.18em] uppercase">Saved</p>
        <p className="mt-3 text-2xl leading-tight font-black tracking-tight">
          {text.done}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink/80">
          Your response has been recorded. We'll reach out to your email with next steps soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border border-ink bg-cream p-6 sm:p-8" noValidate>
      <input type="hidden" name="access_key" value={import.meta.env.VITE_WEB3FORMS_KEY} />
      <input type="hidden" name="subject" value={`New TruFolks ${role} Submission`} />
      <input type="hidden" name="from_name" value="TruFolks Network" />

      <div className="grid gap-5">
        <Field label="Name" name="name" placeholder="Your name" />
        <Field label="Email" name="email" type="email" placeholder="you@email.com" />
        <Field label={text.detail} name="detail" placeholder={text.detailHint} />
        <Field label={text.extra} name="extra" placeholder={text.extraHint} optional />
      </div>
      {error ? (
        <p className="mt-4 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="mt-6 bg-lime px-5 py-4 text-base font-semibold text-ink transition-transform hover:-translate-y-px"
      >
        {text.submit}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  placeholder,
  type = "text",
  optional = false,
}: {
  label: string;
  name: string;
  placeholder: string;
  type?: string;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between text-xs font-semibold tracking-[0.16em] text-moss uppercase">
        {label}
        {optional ? <span className="tracking-normal normal-case">Optional</span> : null}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={name === "email" ? "email" : "name"}
        className="w-full border border-ink bg-cream px-4 py-3 text-base text-ink outline-none placeholder:text-moss/70 focus:bg-lime/30"
      />
    </label>
  );
}