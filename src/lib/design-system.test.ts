// TruFolks Core design system guardrail (DESIGN_SYSTEM.md). Fails if:
//   * the locked tokens in src/styles.css change value or go missing;
//   * Tailwind's built-in palette is switched back on;
//   * any green / emerald / lime / teal / olive / yellow colour, or a legacy
//     token (ink, moss, sage, lime, cream) appears anywhere in src/ or the favicon;
//   * any hex colour in src/ is not one of the locked palette values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = join(root, "src");
const css = readFileSync(join(src, "styles.css"), "utf8");

export const LOCKED = {
  primary: "#0f2a44",
  tertiary: "#0a1f33",
  secondary: "#2563eb",
  neutral: "#5b6b7c",
  canvas: "#f4f6f8",
  surface: "#ffffff",
  amber: "#b45309",
  crimson: "#b91c1c",
} as const;

const ALLOWED_HEX = new Set<string>([...Object.values(LOCKED), "#ffffff", "#000000"]);

function sourceFiles(): string[] {
  return (readdirSync(src, { recursive: true }) as string[])
    .map((f) => join(src, f))
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .filter((f) => !f.endsWith("routeTree.gen.ts") && !f.endsWith("design-system.test.ts"));
}

test("the locked TruFolks Core tokens are defined with their exact values", () => {
  for (const [name, hex] of Object.entries(LOCKED)) {
    const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
    assert.ok(m, `--color-${name} is missing`);
    assert.equal(m[1].toLowerCase(), hex, `--color-${name}`);
  }
  assert.match(css, /--font-sans:\s*"Inter"/);
  assert.match(css, /--color-\*:\s*initial;/, "Tailwind's built-in palette must stay off");
  const statuses: Record<string, string> = {
    pending: LOCKED.neutral,
    held: LOCKED.neutral,
    ready: LOCKED.secondary,
    paid: LOCKED.primary,
    flagged: LOCKED.amber,
    forfeited: LOCKED.crimson,
  };
  for (const [s, hex] of Object.entries(statuses)) {
    const m = new RegExp(`--color-status-${s}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    assert.equal(m?.[1].toLowerCase(), hex, `--color-status-${s}`);
  }
});

test("no green, lime, yellow or legacy colour anywhere in src/ or the favicon", () => {
  const banned = /\b(green|emerald|lime|teal|olive|yellow|chartreuse|moss|sage)\b|\b(bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|accent|shadow|placeholder)-(ink|cream)\b/i;
  const hits: string[] = [];
  for (const f of [...sourceFiles(), join(root, "public", "favicon.svg")]) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (banned.test(line)) hits.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});

test("every hex colour in src/ is a locked palette value", () => {
  const hits: string[] = [];
  for (const f of sourceFiles()) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g)) {
      const hex = m[0].toLowerCase();
      // Only colour-looking contexts: CSS values, theme-color, fill/stroke attributes, style strings.
      const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
      if (!/(:|content:|fill=|stroke=|color|=)\s*["'`]?\s*$/i.test(before)) continue;
      if (!ALLOWED_HEX.has(hex)) hits.push(`${relative(root, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});
