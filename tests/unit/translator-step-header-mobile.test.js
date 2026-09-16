import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PAGE = path.resolve(
  process.cwd(),
  "src/app/(dashboard)/dashboard/translator/page.js"
);

describe("translator step headers keep their actions inside the card", () => {
  it("lets the header row wrap instead of pushing past the border", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    // Measured at 390px: the shrink-0 action group reached 379px inside a card
    // that ends at 324px, i.e. the buttons were painted over the card border.
    expect(src).toContain('<div className="flex flex-wrap items-center justify-between gap-2">');
  });

  it("lets the step title shrink so the row can fit", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    // A flex item without min-w-0 keeps min-width:auto and refuses to shrink,
    // so the icon + number + label + filename chain forced the row wider.
    expect(src).toContain('className="flex flex-wrap items-center gap-2 flex-1 text-left group min-w-0"');
    expect(src).toContain('<h3 className="text-sm font-semibold text-text-main truncate min-w-0">');
    expect(src).toContain('<span className="text-xs text-text-muted/60 font-mono truncate min-w-0">');
  });

  it("keeps the (N chars) counter inside the box when content is loaded", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    // Reported on a phone: with content loaded the counter rendered outside the
    // card. It must never shrink and never wrap, and the row must be able to
    // wrap it onto a second line instead of pushing past the border.
    expect(src).toContain('className="text-xs text-green-500 shrink-0 whitespace-nowrap"');
  });

  it("keeps the icons from being squashed by the shrinking row", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    expect(src).toContain(
      'className="material-symbols-outlined text-[20px] text-text-muted group-hover:text-primary transition-colors shrink-0"'
    );
  });
});
