import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VISUAL_THEMES, THEME_CONFIG } from "@/shared/constants/config.js";

// "Pink Neon" is the third visual look: hot-pink accents on frosted, blurred
// surfaces with a soft glow instead of hard depth. A look is only two things —
// a registry entry (config.js) and a CSS token set (globals.css) — because the
// bootstrap script and the header picker both read VISUAL_THEMES generically.
// The failure mode of a look is therefore silent: forget one token and that
// surface quietly keeps the default warm-orange look, forget to scope a rule
// and you restyle the other two looks. These assertions cover both directions
// and measure the real numbers out of the stylesheet instead of trusting the
// palette to look fine.

const CSS_PATH = path.join(process.cwd(), "src/app/globals.css");
const CSS = fs.readFileSync(CSS_PATH, "utf8");

// Rule parsing runs on a copy whose comments are blanked out (characters
// replaced by spaces, newlines kept, so every offset still lines up with the
// original). The theme block's own banner comment mentions
// `[data-visual="pinkneon"]`, and a naive scan would read that mention as the
// selector of the following rule.
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const ID = "pinkneon";
const OTHER = "neubrutalist";
// Per-look private tokens (--nb-*, --pn-*) are each look's own business, and
// this look deliberately keeps the default typeface.
const PRIVATE = /^--(nb|pn)-/;
const PARITY_SKIP = new Set(["--font-sans"]);

const BANNER = `VISUAL THEME: ${ID.toUpperCase()}`;

function rulesFor(id) {
  const re = new RegExp(`(\\[data-visual="${id}"\\][^{}]*)\\{([^}]*)\\}`, "g");
  const out = [];
  let match;
  while ((match = re.exec(CSS_CODE))) {
    out.push({
      selector: match[1].replace(/\s+/g, " ").trim(),
      body: match[2],
    });
  }
  return out;
}

function parseTokens(body) {
  // Comments are stripped first: a comment inside the block may contain a
  // colon and a `--token` name, and a declaration preceded by a multi-line
  // comment would otherwise not look like a declaration at all.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map();
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

function tokenBlock(id, variant) {
  const want = variant === "dark" ? `[data-visual="${id}"].dark` : `[data-visual="${id}"]`;
  const rule = rulesFor(id).find((r) => r.selector === want);
  return rule ? parseTokens(rule.body) : null;
}

const BLOCKS = {
  light: tokenBlock(ID, "light"),
  dark: tokenBlock(ID, "dark"),
  other: {
    light: tokenBlock(OTHER, "light"),
    dark: tokenBlock(OTHER, "dark"),
  },
};

function resolved(name, tokens, seen = new Set()) {
  if (!tokens || seen.has(name)) return null;
  seen.add(name);
  const raw = tokens.get(name);
  if (raw === undefined) return null;
  const ref = /^var\((--[\w-]+)\)$/.exec(raw.trim());
  return ref ? resolved(ref[1], tokens, seen) : raw.trim();
}

function parseColor(value) {
  if (!value) return null;
  const v = value.trim();
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return {
      rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)),
      alpha: 1,
    };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v);
  if (fn) {
    const parts = fn[1].split(",").map((p) => p.trim());
    if (parts.length < 3) return null;
    return {
      rgb: parts.slice(0, 3).map(Number),
      alpha: parts.length > 3 ? Number(parts[3]) : 1,
    };
  }
  return null;
}

// A translucent value must be composited before it means anything: the browser
// paints the blend, not the base colour, and `getComputedStyle` reports the
// base for alpha utilities. Comparing raw values invents contrast that is not
// on screen.
function over(fg, bg) {
  const a = fg.alpha;
  return {
    rgb: fg.rgb.map((c, i) => Math.round(c * a + bg.rgb[i] * (1 - a))),
    alpha: 1,
  };
}

function luminance({ rgb }) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function paint(tokens, name) {
  return parseColor(resolved(name, tokens));
}

// The page behind the cards: tokens carrying alpha are painted on top of it.
function scene(tokens, surfaceToken) {
  const page = paint(tokens, "--color-bg");
  const surface = paint(tokens, surfaceToken);
  return over(surface, page);
}

const tokenNames = (tokens) => [...(tokens ? tokens.keys() : [])];
const structural = (tokens) =>
  tokenNames(tokens).filter((n) => !PRIVATE.test(n) && !PARITY_SKIP.has(n)).sort();

describe("pink neon visual theme", () => {
  describe("registry", () => {
    it("is offered in the visual theme list", () => {
      const entry = VISUAL_THEMES.find((t) => t.id === ID);
      expect(entry, `VISUAL_THEMES has no ${ID} entry`).toBeTruthy();
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.hint.length).toBeGreaterThan(0);
      // the picker renders the swatch as a 2x2 grid: a 3-colour swatch leaves a
      // hole, a 5th colour is silently dropped
      expect(entry.swatch).toHaveLength(4);
      for (const c of entry.swatch) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it("leaves the other looks and the default alone", () => {
      expect(THEME_CONFIG.defaultVisualTheme).toBe("default");
      const ids = VISUAL_THEMES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("default");
      expect(ids).toContain(OTHER);
    });

    it("needs no change in the bootstrap script to be restored on reload", () => {
      // the inline boot script restores whatever id localStorage holds, so a
      // new look flashes the default only if the script were given an allowlist
      const layout = fs.readFileSync(
        path.join(process.cwd(), "src/app/layout.js"),
        "utf8"
      );
      const boot = /__html:\s*`([^`]*data-theme-ready[^`]*)`/.exec(layout);
      expect(boot, "boot script not found in layout.js").toBeTruthy();
      expect(boot[1]).not.toMatch(new RegExp(OTHER));
    });
  });

  describe("stylesheet", () => {
    it("defines a token block for both schemes", () => {
      expect(BLOCKS.light, `no [data-visual="${ID}"] token block`).toBeTruthy();
      expect(BLOCKS.dark, `no [data-visual="${ID}"].dark token block`).toBeTruthy();
      expect(BLOCKS.light.size).toBeGreaterThan(20);
    });

    it("carries every structural token the existing look carries", () => {
      // Same variant-to-variant comparison: a token present only in the light
      // block means the dark scheme falls back to the default palette there.
      for (const variant of ["light", "dark"]) {
        const mine = structural(BLOCKS[variant]);
        const theirs = structural(BLOCKS.other[variant]);
        // the existing look defines ~30 structural tokens in the light block
        // and 13 in the dark one (the dark variant only restates what flips)
        expect(theirs.length).toBeGreaterThan(8);
        const missing = theirs.filter((n) => !mine.includes(n));
        expect(missing, `${variant} block is missing: ${missing.join(", ")}`).toEqual([]);
      }
    });

    it("scopes every rule it adds to this look", () => {
      const banner = CSS.indexOf(BANNER);
      expect(banner, `${BANNER} banner comment not found`).toBeGreaterThan(-1);
      const region = CSS_CODE.slice(banner);
      const selectors = [...region.matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{/g)].map((m) =>
        m[1].replace(/\s+/g, " ").trim()
      );
      expect(selectors.length).toBeGreaterThan(3);
      const unscoped = selectors.filter((s) => !s.includes(`[data-visual="${ID}"]`));
      expect(unscoped, `rules escape the look scope: ${unscoped.join(" | ")}`).toEqual([]);
    });

    it("freezes the surfaces for the blur to read through", () => {
      const frostRules = rulesFor(ID).filter((r) => /backdrop-filter:[^;]*blur/i.test(r.body));
      expect(frostRules.length, "nothing in this look is frosted").toBeGreaterThan(0);

      const blur = frostRules
        .flatMap((r) => [...r.body.matchAll(/backdrop-filter:[^;]*blur\(\s*(\d+(?:\.\d+)?)px/gi)])
        .map((m) => Number(m[1]));
      expect(Math.min(...blur)).toBeGreaterThanOrEqual(12);

      // A fully opaque surface makes the blur invisible, so the look would
      // claim frosted glass and render a normal card.
      for (const variant of ["light", "dark"]) {
        const glass = paint(BLOCKS[variant], "--pn-glass");
        expect(glass, `${variant} glass colour is unreadable`).toBeTruthy();
        expect(glass.alpha).toBeLessThan(1);
        expect(glass.alpha).toBeGreaterThan(0.35);
      }
    });

    it("only frosts classes the app actually renders", () => {
      // The stylesheet defines `.card-soft` / `.card-elev`, but nothing in the
      // app uses them — a frost rule against those names compiles fine, reads
      // fine and paints NOTHING. So every class the frost rule names has to
      // appear in the app's own source.
      const frostRules = rulesFor(ID).filter((r) => /backdrop-filter:[^;]*blur/i.test(r.body));
      const classes = new Set();
      for (const rule of frostRules) {
        for (const m of rule.selector.matchAll(/\.([A-Za-z][\w-]*)/g)) classes.add(m[1]);
        for (const m of rule.selector.matchAll(/\[class~="([^"]+)"\]/g)) classes.add(m[1]);
      }
      expect(classes.size, "the frost rule names no class").toBeGreaterThan(0);

      const sources = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(js|jsx)$/.test(entry.name)) sources.push(fs.readFileSync(full, "utf8"));
        }
      };
      walk(path.join(process.cwd(), "src"));
      const haystack = sources.join("\n");

      const dead = [...classes].filter(
        (c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(haystack)
      );
      expect(dead, `frosted classes that no component ever renders: ${dead.join(", ")}`).toEqual([]);
    });
  });

  describe("legibility (WCAG AA on the composited colours)", () => {
    const TEXT_PAIRS = [
      ["--color-text-main", "--color-surface"],
      ["--color-text-muted", "--color-surface"],
      ["--color-text-subtle", "--color-surface"],
      ["--color-text-main", "--color-bg"],
      ["--color-text-muted", "--color-bg"],
      ["--pn-text-primary", "--color-surface"],
      ["--pn-text-success", "--color-surface"],
      ["--pn-text-warning", "--color-surface"],
      ["--pn-text-info", "--color-surface"],
      ["--pn-text-danger", "--color-surface"],
      ["--pn-text-primary", "--pn-glass"],
      ["--color-text-main", "--pn-glass"],
      ["--color-text-muted", "--pn-glass"],
    ];
    const FILL_PAIRS = [
      ["--pn-ink", "--color-primary"],
      ["--pn-ink", "--color-accent"],
    ];

    for (const variant of ["light", "dark"]) {
      it(`reads on ${variant} surfaces`, () => {
        const tokens = BLOCKS[variant];
        const results = [];
        for (const [fgName, bgName] of TEXT_PAIRS) {
          const fg = paint(tokens, fgName);
          const bg = scene(tokens, bgName);
          expect(fg, `${variant}: ${fgName} is not a colour`).toBeTruthy();
          expect(bg, `${variant}: ${bgName} is not a colour`).toBeTruthy();
          const ratio = contrast(fg, bg);
          results.push([`${fgName} on ${bgName}`, ratio]);
        }
        const failing = results.filter(([, r]) => r < 4.5).map(([l, r]) => `${l} = ${r.toFixed(2)}:1`);
        expect(failing, `${variant} text under AA: ${failing.join(", ")}`).toEqual([]);
      });

      it(`keeps labels readable on ${variant} accent fills`, () => {
        const tokens = BLOCKS[variant];
        const failing = [];
        for (const [fgName, bgName] of FILL_PAIRS) {
          const ratio = contrast(paint(tokens, fgName), paint(tokens, bgName));
          if (ratio < 4.5) failing.push(`${fgName} on ${bgName} = ${ratio.toFixed(2)}:1`);
        }
        expect(failing, `${variant} fill labels under AA: ${failing.join(", ")}`).toEqual([]);
      });
    }

    it("does not put white text on the pink fill", () => {
      // white on the hot pink measures 3.3-3.5:1, so a rule that flips labels
      // to ink is not decoration — without it every primary button fails AA
      for (const variant of ["light", "dark"]) {
        const tokens = BLOCKS[variant];
        const white = { rgb: [255, 255, 255], alpha: 1 };
        expect(contrast(white, paint(tokens, "--color-primary"))).toBeLessThan(4.5);
      }
      // Class lists are compared per selector TOKEN, not by substring: the
      // substring "bg-primary" is also inside "bg-primary-hover", so a
      // substring check stays green even after the `.bg-primary` selector is
      // dropped from the rule.
      const token = `[data-visual="${ID}"] .bg-primary`;
      const inkRules = rulesFor(ID).filter(
        (r) =>
          r.body.includes("--pn-ink") &&
          r.selector
            .split(",")
            .map((s) => s.trim())
            .some((s) => s === token || s.startsWith(`${token}:`))
      );
      expect(inkRules.length, "no ink rule for solid accent fills").toBeGreaterThan(0);
    });

    // Selecting a block of text paints it with the selection colours, so this
    // is a surface like any other. The base stylesheet uses
    // `color: var(--color-primary)` for it — correct for the default look, but
    // this look redefines that token to the SOLID hot pink, so the selected
    // text came out pink on a pink wash: 2.4:1 (light) and 3.8:1 (dark), i.e.
    // the selected text all but disappears. Overriding --color-primary means
    // owning the selection colours as well, both halves of the pair.
    const selectionRule = (variant) =>
      rulesFor(ID).find(
        (r) =>
          r.selector ===
          (variant === "dark" ? `[data-visual="${ID}"].dark ::selection` : `[data-visual="${ID}"] ::selection`)
      );

    const declaration = (body, prop) => {
      const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
      const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(clean);
      return m ? m[1].trim() : null;
    };

    // A value may still be a token (`var(--pn-ink)`), and tokens are only
    // meaningful inside the block of their own variant.
    const resolveValue = (value, tokens) => {
      const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
      return ref ? resolved(ref[1], tokens) : value.trim();
    };

    for (const variant of ["light", "dark"]) {
      it(`keeps selected text readable on ${variant}`, () => {
        const rule = selectionRule(variant);
        expect(rule, `no ::selection rule for ${variant}`).toBeTruthy();

        const bgRaw = declaration(rule.body, "background-color") || declaration(rule.body, "background");
        expect(bgRaw, `${variant} selection paints no background`).toBeTruthy();

        const colorRaw = declaration(rule.body, "color");
        expect(
          colorRaw,
          `${variant} selection declares no text colour: it inherits the solid primary and turns into pink on pink`
        ).toBeTruthy();

        const tokens = BLOCKS[variant];
        const bg = parseColor(resolveValue(bgRaw, tokens));
        expect(bg, `${variant} selection background is not a colour`).toBeTruthy();

        const text = parseColor(resolveValue(colorRaw, tokens));
        expect(text, `${variant} selection text colour is not a colour`).toBeTruthy();

        // the wash sits on top of the surface the text lives on
        const painted = over(bg, scene(tokens, "--color-surface"));
        const ratio = contrast(text, painted);
        expect(
          ratio,
          `${variant}: selected text measures ${ratio.toFixed(2)}:1 on the selection wash (${bgRaw} + ${colorRaw})`
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
