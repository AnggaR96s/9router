import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A disabled (or loading) Button must stay readable. The base class carried
// `disabled:opacity-50`, which composites the label AND its own fill against the
// ancestor, and the `[data-visual]` theme blocks force the theme ink onto any
// `.bg-brand-500` fill (unlayered rules outrank the `disabled:` utility).
// Measured on the compiled CSS the label landed at 1.78 (default light) down to
// 1.25:1 (pinkneon dark) against a 4.5:1 threshold. The dimming must come from a
// per-theme text token that stays legible on the muted surfaces instead.

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const BUTTON = read("src/shared/components/Button.js");
const CSS = read("src/app/globals.css");

describe("disabled/loading button legibility", () => {
  it("never dims the whole button with a blanket opacity", () => {
    // Check the class lists, not the prose: the comment above names the utility
    // it replaced, and only a real class string can dim what is on screen.
    const classStrings = [...BUTTON.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    for (const cls of classStrings) {
      expect(cls, `class list still dims: ${cls}`).not.toContain("disabled:opacity-50");
    }
    const base = classStrings.find((c) => c.includes("font-semibold"));
    expect(base, "base class list not found").toBeTruthy();
    expect(base).not.toMatch(/disabled:opacity-/);
  });

  it("gives every variant its own disabled text colour", () => {
    const variants = /const variants = \{([\s\S]*?)\n\};/.exec(BUTTON);
    expect(variants, "variant table not found").toBeTruthy();
    const entries = [...variants[1].matchAll(/^\s*(\w+):\s*"([^"]*)"/gm)];
    expect(entries.length).toBe(6);
    for (const [, name, cls] of entries) {
      expect(cls, `${name} has no disabled text colour`).toMatch(/disabled:text-text-disabled/);
    }
  });

  it("keeps the disabled surface the themes already define", () => {
    const variants = /const variants = \{([\s\S]*?)\n\};/.exec(BUTTON);
    for (const name of ["primary", "danger", "success"]) {
      const line = new RegExp(`${name}:\\s*"([^"]*)"`).exec(variants[1]);
      expect(line, `${name} variant not found`).toBeTruthy();
      expect(line[1], `${name} must fall back to a muted surface`).toContain("disabled:bg-surface-3");
    }
  });

  it("keeps the disabled fill from inheriting the theme ink", () => {
    // Both palettes that force an ink onto a brand fill need their own scoped
    // rule: the theme guard rejects an unscoped rule, and the utility alone
    // loses to the ink rule on specificity.
    for (const theme of ["neubrutalist", "pinkneon"]) {
      const rule = new RegExp(
        `\\[data-visual="${theme}"\\] button:disabled\\[class\\*="bg-brand-"\\][\\s\\S]*?color:\\s*var\\(--color-text-disabled\\)`
      ).exec(CSS);
      expect(rule, `no scoped disabled-fill rule for ${theme}`).toBeTruthy();
    }
  });

  it("defines the token in every theme and exposes it as a utility", () => {
    const mapped = CSS.match(/--color-text-disabled:\s*var\(--color-text-disabled\);/g) || [];
    expect(mapped.length, "not mapped in @theme inline").toBe(1);
    const declared = CSS.match(/--color-text-disabled: (?!var\()/g) || [];
    expect(declared.length, "expected one declaration per theme combination").toBe(6);
  });
});