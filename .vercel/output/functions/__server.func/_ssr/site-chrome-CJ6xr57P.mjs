import { K as require_jsx_runtime, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/site-chrome-CJ6xr57P.js
var import_jsx_runtime = require_jsx_runtime();
function SiteHeader() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-7 sm:px-10",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
			to: "/",
			className: "flex items-center gap-3",
			"aria-label": "TruFolks home",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
				src: "/trufolks-mark.png",
				alt: "",
				width: 46,
				height: 46,
				className: "h-11 w-11"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-2xl font-extrabold tracking-tight",
				children: "TruFolks®"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "hidden text-xs font-medium tracking-[0.18em] uppercase md:block",
			children: "The anti-influencer network"
		})]
	});
}
function SiteFooter() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", {
		className: "bg-ink text-cream",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto max-w-7xl px-5 py-16 sm:px-10 sm:py-20",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs font-semibold tracking-[0.18em] text-lime uppercase",
					children: "Our non-negotiable"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "mt-5 max-w-4xl text-4xl leading-none font-black tracking-tight uppercase sm:text-6xl",
					children: "The truth has a paper trail."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-6 max-w-xl text-base leading-relaxed text-cream/80",
					children: "Not gifted. Not staged. Not paid to pretend. A receipt proves the purchase. An honest review tells the rest."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-12 flex flex-col gap-3 border-t border-cream/20 pt-6 sm:flex-row sm:items-center sm:justify-between",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-lg font-extrabold tracking-tight",
						children: "TruFolks®"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs tracking-wide text-cream/70 uppercase",
						children: "© 2026 TruFolks. Keep it real."
					})]
				})
			]
		})
	});
}
function Shell({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-screen bg-cream text-ink",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SiteHeader, {}),
			children,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SiteFooter, {})
		]
	});
}
//#endregion
export { Shell as t };
