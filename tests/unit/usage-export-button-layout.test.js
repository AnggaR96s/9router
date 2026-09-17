import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The "Export CSV" button shares a flex row with the period selector, and that
// selector is `w-full` on mobile. A flex item shrinks below its own content, so
// the label wraps onto a second line — and because the button has a fixed
// height, the second line is painted OUTSIDE the button box. The label must
// never wrap, and the two controls must be allowed to take separate lines
// instead of squeezing each other.

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const BUTTON = read("src/shared/components/Button.js");
const PAGE = read("src/app/(dashboard)/dashboard/usage/page.js");

describe("export csv button", () => {
  it("keeps its label on one line", () => {
    // every Button renders through this base class list; a wrapping label is
    // clipped by the fixed height of every size, so this belongs in the base
    const base = /cn\(([\s\S]*?)\)\s*\}/.exec(BUTTON);
    expect(base, "base class list not found").toBeTruthy();
    expect(base[1]).toContain("whitespace-nowrap");
  });

  it("can take its own line instead of being squeezed", () => {
    const start = PAGE.indexOf('{activeTab === "overview" && (');
    const row = /<div className="([^"]*)"/.exec(PAGE.slice(start, PAGE.indexOf("Export CSV")));
    expect(row, "export row not found in the usage page").toBeTruthy();
    expect(row[1]).toContain("flex-wrap");
  });

  it("refuses to shrink below its content", () => {
    const tag = /<Button[\s\S]*?Export CSV[\s\S]*?<\/Button>/.exec(PAGE);
    expect(tag, "export button not found").toBeTruthy();
    // the sibling period selector scrolls its own overflow, so it is the one
    // that gives way; squeezed, the button would clip its own label
    expect(tag[0]).toContain("shrink-0");
  });

  it("still downloads the history as csv", () => {
    // the layout fix must not quietly change what the button does
    const tag = /<Button[\s\S]*?Export CSV[\s\S]*?<\/Button>/.exec(PAGE);
    expect(tag[0]).toContain("/api/usage/history?format=csv");
    expect(tag[0]).toContain('title="Export usage history to CSV"');
  });
});
