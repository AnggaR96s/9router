// Mobile layout invariants (reference viewport 390px) for rows that render
// server-controlled long strings: absolute DB paths and proxy error messages.
// A long unbreakable string inside a non-shrinkable flex child visually escapes
// its card. Pixel-level proof comes from measuring the rendered page; these
// assertions pin the class invariants that keep those strings inside their boxes.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const REPO = process.cwd();
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const STATUS = "src/app/(dashboard)/dashboard/system-status";
const POOLS = "src/app/(dashboard)/dashboard/proxy-pools/page.js";

describe("system status mobile layout", () => {
  const storage = read(`${STATUS}/components/StorageUsageCard.js`);

  it("lets the absolute DB path wrap instead of escaping the total-storage box", () => {
    const dbPathRow = storage.match(/<p className="[^"]*font-mono[^"]*"[^>]*>\s*\{storage\.dbPath\}/);
    expect(dbPathRow).not.toBe(null);
    expect(dbPathRow[0]).toMatch(/break-all|break-words/);
    expect(dbPathRow[0]).not.toMatch(/whitespace-nowrap|truncate/);
  });

  it("keeps the total size on the label row and immune to shrinking", () => {
    const total = storage.match(/\{formatBytes\(storage\.totalStorageBytes\)\}/);
    expect(total).not.toBe(null);
    const span = storage.slice(storage.lastIndexOf("<span", total.index), total.index);
    expect(span).toMatch(/shrink-0/);
  });

  it("gives the entity count grid two columns on narrow screens", () => {
    expect(storage).toMatch(/grid grid-cols-2 sm:grid-cols-4 gap-2 text-center/);
  });

  describe("V8 engine card", () => {
    const process_ = read(`${STATUS}/components/ProcessDetailsCard.js`);

    it("keeps the GC button in a header that may wrap, with a non-shrinking button", () => {
      const header = process_.match(/<div className="[^"]*border-b[^"]*pb-3">/);
      expect(header).not.toBe(null);
      expect(header[0]).toMatch(/flex-wrap|flex-col/);
      expect(process_).toMatch(/className="text-xs shrink-0"/);
    });

    it("moves the GC message out of the title row into its own wrapping line", () => {
      const header = process_.match(/<div className="[^"]*border-b[^"]*pb-3">[\s\S]*?\n        <\/div>/);
      expect(header).not.toBe(null);
      expect(header[0]).not.toContain("{gcResult}");
      const resultLine = process_.match(/\{gcResult && \([\s\S]*?<\/p>/);
      expect(resultLine).not.toBe(null);
      expect(resultLine[0]).toMatch(/break-words/);
      expect(resultLine[0]).not.toMatch(/whitespace-nowrap|truncate/);
    });

    it("disables the button when the runtime cannot collect, and says why", () => {
      expect(process_).toMatch(/disabled=\{gcLoading \|\| !gcAvailable\}/);
      const hint = process_.match(/\{!gcAvailable && \([\s\S]*?<\/p>/);
      expect(hint).not.toBe(null);
      expect(hint[0]).toContain("--expose-gc");
    });
  });

  it("keeps the tab strip scrollable inside the page instead of clipping it", () => {
    const page = read(`${STATUS}/page.js`);
    expect(page).toMatch(/min-w-0 max-w-full custom-scrollbar/);
  });
});

describe("proxy pool rows", () => {
  const pools = read(POOLS);

  it("wraps the last-tested / last-error line so it stays inside the card", () => {
    const row = pools.match(/<p className="text-\[11px\][^"]*mt-1[^"]*">[\s\S]*?<\/p>/);
    expect(row).not.toBe(null);
    expect(row[0]).toMatch(/break-words/);
    expect(row[0]).toMatch(/break-all/);
    expect(row[0]).not.toMatch(/whitespace-nowrap|truncate/);
  });
});