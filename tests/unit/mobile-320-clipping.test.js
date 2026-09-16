import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const HEADER = path.resolve(process.cwd(), "src/shared/components/Header.js");
describe("the dashboard header stays reachable on a 320px viewport", () => {
  it("lets a truncating title actually shrink (truncate needs min-w-0)", () => {
    const src = fs.readFileSync(HEADER, "utf8");
    // Without min-w-0 a flex item keeps min-width:auto, so the title refuses to
    // shrink, the breadcrumb row grows past the viewport and the shell clips it
    // away instead of showing an ellipsis (measured right 363 vs 320).
    const h1s = [...src.matchAll(/<h1 className="([^"]*)"/g)].map((m) => m[1]);
    expect(h1s.length).toBeGreaterThanOrEqual(2);
    for (const cls of h1s) {
      if (cls.includes("truncate")) expect(cls).toContain("min-w-0");
    }
  });

  it("lets the breadcrumb row and its crumbs shrink", () => {
    const src = fs.readFileSync(HEADER, "utf8");
    const shrinkable = [...src.matchAll(/className="flex items-center gap-2 min-w-0"/g)];
    expect(shrinkable.length).toBeGreaterThanOrEqual(2);
  });

});