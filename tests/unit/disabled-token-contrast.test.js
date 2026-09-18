import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A token is only as good as its value. The disabled text step is checked here
// against each palette's own muted surfaces, with the same WCAG 2.1 relative
// luminance the browser probe uses, so pasting a too-light grey into a theme
// fails the suite instead of shipping.
const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

const BLOCKS = [
  ["default light", ":root"],
  ["default dark", ".dark"],
  ["neubrutalist light", '[data-visual="neubrutalist"]'],
  ["neubrutalist dark", '[data-visual="neubrutalist"].dark'],
  ["pinkneon light", '[data-visual="pinkneon"]'],
  ["pinkneon dark", '[data-visual="pinkneon"].dark']
];

const bodyOf = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(CSS);
  if (!m) throw new Error(`theme block not found: ${selector}`);
  return m[1];
};

const tokenOf = (body, name) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`token not found: ${name}`);
  return m[1].trim();
};

const channels = (value) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(value);
  if (!rgba) throw new Error(`unsupported colour: ${value}`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
};

// A translucent surface sits on the palette's own page background.
// `--color-bg` may point at a palette variable (neubrutalist uses --nb-paper).
const resolve = (value, depth = 0) => {
  const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!ref) return value;
  if (depth > 4) throw new Error(`unresolved colour chain: ${value}`);
  const m = new RegExp(`${ref[1]}:\\s*(?!var\\()([^;]+);`).exec(CSS);
  if (!m) throw new Error(`unknown variable: ${ref[1]}`);
  return resolve(m[1].trim(), depth + 1);
};

const flatten = (value, backdrop) => {
  const [r, g, b, a] = channels(resolve(value));
  if (a >= 1) return [r, g, b];
  const [br, bg, bb] = backdrop;
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
};

const luminance = ([r, g, b]) => {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (fg, backdrop) => {
  const [a, b] = [luminance(fg), luminance(backdrop)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

describe("disabled text token clears AA on every palette", () => {
  for (const [label, selector] of BLOCKS) {
    it(`${label} reaches 4.5:1 on the muted surfaces`, () => {
      const body = bodyOf(selector);
      const page = flatten(tokenOf(body, "--color-bg"), [255, 255, 255]);
      const text = flatten(tokenOf(body, "--color-text-disabled"), page);
      expect(contrast(text, page), `${label}: page ${tokenOf(body, "--color-bg")}`).toBeGreaterThanOrEqual(4.5);
      const surfaces = ["--color-surface-2", "--color-surface-3"].map((name) => ({
        name,
        value: tokenOf(body, name)
      }));
      for (const { name, value } of surfaces) {
        const ratio = contrast(text, flatten(value, page));
        expect(ratio, `${label}: ${name} ${value} vs disabled text = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});