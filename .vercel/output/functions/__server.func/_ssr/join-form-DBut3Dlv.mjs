import { i as __toESM } from "../_runtime.mjs";
import { K as require_jsx_runtime, q as require_react } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/join-form-DBut3Dlv.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var KEY = "trufolks.leads";
function saveLead(lead) {
	const next = {
		...lead,
		at: (/* @__PURE__ */ new Date()).toISOString()
	};
	const prev = readLeads();
	prev.push(next);
	localStorage.setItem(KEY, JSON.stringify(prev));
	return next;
}
function readLeads() {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
var copy = {
	shopper: {
		detail: "What did you buy?",
		detailHint: "Product and brand",
		extra: "Where did you buy it?",
		extraHint: "Store, site, or pharmacy",
		submit: "Put me on the list",
		done: "You’re in. When a brand wants a real take on something you bought, this is how we find you."
	},
	brand: {
		detail: "Brand or company",
		detailHint: "Who’s looking for the hook",
		extra: "What do you want to test?",
		extraHint: "Product, channel, Meta or TikTok",
		submit: "Request a look",
		done: "Request saved. We’ll use this to match receipt-verified clips, not gifted ones."
	}
};
function JoinForm({ role }) {
	const text = copy[role];
	const [done, setDone] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	function onSubmit(event) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const name = String(data.get("name") || "").trim();
		const email = String(data.get("email") || "").trim();
		const detail = String(data.get("detail") || "").trim();
		const extra = String(data.get("extra") || "").trim();
		if (!name || !email || !email.includes("@") || !detail) {
			setError("Name, a real email, and the first detail are required.");
			return;
		}
		saveLead({
			role,
			name,
			email,
			detail,
			extra
		});
		setError("");
		setDone(true);
	}
	if (done) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "border border-ink bg-lime p-6 sm:p-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-semibold tracking-[0.18em] uppercase",
				children: "Saved"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 text-2xl leading-tight font-black tracking-tight",
				children: text.done
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-sm leading-relaxed text-ink/80",
				children: "Held on this device for now, so you can see the flow. Next we can send these straight to your inbox."
			})
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		onSubmit,
		className: "border border-ink bg-cream p-6 sm:p-8",
		noValidate: true,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Name",
						name: "name",
						placeholder: "Your name"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Email",
						name: "email",
						type: "email",
						placeholder: "you@email.com"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: text.detail,
						name: "detail",
						placeholder: text.detailHint
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: text.extra,
						name: "extra",
						placeholder: text.extraHint,
						optional: true
					})
				]
			}),
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-sm font-medium",
				role: "alert",
				children: error
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "submit",
				className: "mt-6 bg-lime px-5 py-4 text-base font-semibold text-ink transition-transform hover:-translate-y-px",
				children: text.submit
			})
		]
	});
}
function Field({ label, name, placeholder, type = "text", optional = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "block",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "mb-2 flex items-baseline justify-between text-xs font-semibold tracking-[0.16em] text-moss uppercase",
			children: [label, optional ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "tracking-normal normal-case",
				children: "Optional"
			}) : null]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			name,
			type,
			placeholder,
			autoComplete: name === "email" ? "email" : "name",
			className: "w-full border border-ink bg-cream px-4 py-3 text-base text-ink outline-none placeholder:text-moss/70 focus:bg-lime/30"
		})]
	});
}
//#endregion
export { JoinForm as t };
