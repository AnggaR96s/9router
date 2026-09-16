import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The per-connection model assignment used to be a native <select>, so the
// picker was drawn by the OS and read as a different design system next to the
// button controls sitting in the same row. It is now a trigger button that
// opens the same kind of modal the bulk "Apply Proxy" action already uses.
//
// These assertions pin the shape of that control: no native select in the row,
// the row defers to the page, and the page owns a single modal that writes
// through the existing save handler.

const DIR = path.join(process.cwd(), "src/app/(dashboard)/dashboard/providers/[id]");
const ROW = fs.readFileSync(path.join(DIR, "ConnectionRow.js"), "utf8");
const PAGE = fs.readFileSync(path.join(DIR, "page.js"), "utf8");

describe("per-connection model assignment picker", () => {
  it("no longer renders a native select inside the connection row", () => {
    expect(ROW).not.toMatch(/<select\b/);
  });

  it("opens the picker through the page instead of owning the options", () => {
    expect(ROW).toContain("onOpenModelPicker");
    // The trigger must still refuse to open while strict assignment is off.
    expect(ROW).toMatch(/disabled=\{!strictModelAssignment\}/);
  });

  it("wires the trigger to the page-level picker", () => {
    expect(PAGE).toContain("onOpenModelPicker=");
  });

  it("renders one modal that lists the assignment options and can clear them", () => {
    // The picker modal must be a real <Modal> (same primitive Apply Proxy uses),
    // listing every assignable model plus an explicit way back to Unassigned.
    const modal = PAGE.match(/<Modal[\s\S]{0,600}?title="Assign Model"[\s\S]{0,2000}?<\/Modal>/);
    expect(modal).not.toBeNull();
    expect(modal[0]).toContain("Unassigned");
    expect(modal[0]).toMatch(/assignmentModels\.map|assignmentModels\.length/);
  });

  it("writes through the existing save handler", () => {
    expect(PAGE).toMatch(/handleModelAssignment\(/);
  });
});
