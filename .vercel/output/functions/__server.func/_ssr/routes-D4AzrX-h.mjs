import { K as require_jsx_runtime, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as Shell } from "./site-chrome-CJ6xr57P.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-D4AzrX-h.js
var import_jsx_runtime = require_jsx_runtime();
var shopperSteps = [
	{
		n: "01",
		title: "Show us the receipt",
		body: "Submit a recent purchase receipt. Real ownership comes first."
	},
	{
		n: "02",
		title: "Keep it unscripted",
		body: "Film a mobile review. What worked, what didn’t, what you’d tell a friend."
	},
	{
		n: "03",
		title: "Get paid for your perspective",
		body: "Eligible, approved reviews can earn payment. No five-star script required."
	}
];
var brandSteps = [
	{
		n: "01",
		title: "Start with proof",
		body: "Every review starts with a verified purchase, not a gifted product."
	},
	{
		n: "02",
		title: "Find your next hook",
		body: "Discover candid perspectives and product moments worth testing."
	},
	{
		n: "03",
		title: "License. Edit. Launch.",
		body: "License content for your paid social campaigns, with usage terms agreed up front."
	}
];
function Landing() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "mx-auto grid w-full max-w-7xl items-start gap-10 px-5 pb-14 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:pb-20",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs font-medium tracking-[0.16em] uppercase",
					children: "Bought it. Used it. Tell the truth."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
					className: "mt-4 text-5xl leading-none font-black tracking-tight uppercase sm:text-6xl lg:text-7xl",
					children: [
						"Less influence.",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
						"More truth."
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-6 max-w-md text-base leading-relaxed",
					children: "Real purchases. Unscripted opinions. We connect everyday shoppers with brands that want content people actually believe."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-8 flex flex-wrap gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/shoppers",
						className: "border border-ink bg-lime px-5 py-4 text-base font-semibold",
						children: "I’m a shopper"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/brands",
						className: "border border-ink bg-ink px-5 py-4 text-base font-semibold text-cream",
						children: "I’m a brand"
					})]
				})
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figure", {
				className: "overflow-hidden border border-ink bg-ink",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
					src: "/review-phone.png",
					alt: "A shopper in a kitchen holding a skincare bottle for an unscripted review",
					className: "aspect-[4/3] w-full object-cover object-center"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figcaption", {
					className: "px-4 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm font-semibold text-lime",
						children: "Verified TruFolks Creator"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-xs text-cream/80",
						children: "Skincare Brand ‘A’, Purchased 30 days ago. Raw Video Clip"
					})]
				})]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "bg-lime px-5 py-5 text-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm font-extrabold tracking-wide uppercase sm:text-base",
				children: "Zero fake reviews. 100% receipt-verified."
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "mx-auto w-full max-w-7xl px-5 py-14 sm:px-10 sm:py-20",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium tracking-[0.16em] uppercase",
				children: "Real people. Real value. Both ways."
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-8 grid gap-4 lg:grid-cols-2 lg:gap-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "flex h-full flex-col border border-ink p-6 sm:p-8",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium tracking-[0.16em] uppercase",
							children: "01 / For everyday shoppers"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "mt-5 text-4xl leading-none font-black tracking-tight uppercase sm:text-5xl",
							children: "Your opinion. Not a performance."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-5 max-w-md text-base leading-relaxed",
							children: "You don’t need followers. You need a product you actually bought and something honest to say."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
							className: "mt-8",
							children: shopperSteps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
								className: "border-t border-sage py-5",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "text-xl font-bold tracking-tight",
									children: [
										step.n,
										" ",
										step.title
									]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-2 max-w-md text-sm leading-relaxed text-moss",
									children: step.body
								})]
							}, step.n))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/shoppers",
							className: "mt-auto inline-block w-fit border border-ink bg-lime px-5 py-3 text-sm font-semibold",
							children: "Join as a shopper"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "flex h-full flex-col bg-ink p-6 text-cream sm:p-8",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-semibold tracking-[0.16em] text-lime uppercase",
							children: "02 / For brands & ad directors"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "mt-5 text-4xl leading-none font-black tracking-tight uppercase sm:text-5xl",
							children: "Stop scrolls. Not trust."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-5 max-w-md text-base leading-relaxed text-cream/85",
							children: "License raw video hooks from real customers. Built for your next Meta or TikTok creative test—not another polished endorsement."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
							className: "mt-8",
							children: brandSteps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
								className: "border-t border-cream/20 py-5",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "text-xl font-bold tracking-tight",
									children: [
										step.n,
										" ",
										step.title
									]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-2 max-w-md text-sm leading-relaxed text-cream/70",
									children: step.body
								})]
							}, step.n))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/brands",
							className: "mt-auto inline-block w-fit bg-lime px-5 py-3 text-sm font-semibold text-ink",
							children: "Talk to us as a brand"
						})
					]
				})]
			})]
		})
	] }) });
}
var SplitComponent = Landing;
//#endregion
export { SplitComponent as component };
