import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PAGE = path.resolve(
  process.cwd(),
  "src/app/(dashboard)/dashboard/providers/[id]/page.js"
);

function modelsHeaderRow() {
  const src = fs.readFileSync(PAGE, "utf8");
  const start = src.indexOf("const canImportProviderModels");
  if (start === -1) return null;
  const end = src.indexOf("})()}", start);
  if (end === -1) return null;
  return src.slice(start, end);
}

describe("provider page — models header controls on a 390px viewport", () => {
  it("found the models header row block", () => {
    expect(modelsHeaderRow()).toBeTruthy();
  });

  it("lets the action row wrap instead of overflowing the card", () => {
    const block = modelsHeaderRow();
    // Three buttons (105 + 95 + 101px + gaps) need 317px but the row only gets
    // ~274px inside the card on a 390px viewport, so without wrapping the last
    // button is pushed past the card's right edge (measured: right 370 vs 352).
    expect(block).toContain('className="flex flex-wrap gap-2"');
    expect(block).not.toMatch(/className="flex gap-2"/);
  });

  it("keeps each action label on one line inside its box", () => {
    const block = modelsHeaderRow();
    const buttons = block.split("<Button").slice(1);
    expect(buttons.length).toBe(3);
    // A wrapped label needs 37px of height in a 28px button, so the second line
    // is painted outside the button's border.
    for (const b of buttons) {
      expect(b.slice(0, b.indexOf("</Button>") > -1 ? b.indexOf("</Button>") : 400)).toContain(
        "whitespace-nowrap"
      );
    }
  });

  it("keeps the heading and the thinking selector inside the card on 320px", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    const i = src.indexOf('{"Available Models"}');
    expect(i).toBeGreaterThan(-1);
    const rowStart = src.lastIndexOf('<div className="', i);
    const row = src.slice(rowStart, i);
    // At 320px the heading wraps to two lines and the selector no longer fits
    // beside it, so it hung 2px past the card's border (measured right 284 vs 282).
    expect(row).toContain("flex-wrap");
  });
});