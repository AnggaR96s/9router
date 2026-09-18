import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The sidebar nav is a `flex-1 overflow-y-auto` child, so it can only scroll when
// its flex column has a DEFINITE height to divide up. `min-h-full` is only a
// floor: a nav taller than the viewport made the aside grow past its container
// instead of making the nav scroll. On the desktop shell the wrapper stretched
// the aside to the shell height and hid the bug; in the mobile drawer
// (`fixed inset-y-0`) the aside grew to its content height (~716px), ran past the
// bottom of the screen, and left the last rows unreachable with the wheel doing
// nothing over the sidebar. `h-full` gives the column the container's exact
// height, so the nav becomes the one scroll container.
//
// Measured on the running dashboard at 390x640: before, aside 716px, nav
// clientHeight == scrollHeight == 600 (nothing to scroll) and a wheel over the
// nav left Error Log + Settings below the fold; after, aside 640px, nav 524px vs
// 600px of content, and the same wheel reached every row. At 1440x700 the two
// versions measure identically, so the desktop path is unchanged.

const SIDEBAR = path.join(process.cwd(), "src/shared/components/Sidebar.js");
const LAYOUT = path.join(
  process.cwd(),
  "src/shared/components/layouts/DashboardLayout.js"
);

const sidebarSrc = fs.readFileSync(SIDEBAR, "utf8");
const layoutSrc = fs.readFileSync(LAYOUT, "utf8");

// class list of the first `<tag className="...">` in the source.
function tagClass(src, tag) {
  const m = src.match(new RegExp("<" + tag + "\\s+className=\"([^\"]*)\""));
  return m ? m[1] : null;
}

describe("sidebar scrolls when its content is taller than the viewport", () => {
  it("gives the sidebar column a definite height, not just a floor", () => {
    const cls = tagClass(sidebarSrc, "aside");
    expect(cls).toBeTruthy();
    expect(cls).toContain("h-full");
    // min-h-full lets the column grow with its content, which is the bug: the
    // nav then has no shorter box to scroll inside.
    expect(cls).not.toContain("min-h-full");
    expect(cls).toContain("flex-col");
  });

  it("keeps the nav as the single scroll container", () => {
    const cls = tagClass(sidebarSrc, "nav");
    expect(cls).toBeTruthy();
    expect(cls).toContain("flex-1");
    expect(cls).toContain("overflow-y-auto");
  });

  it("keeps the mobile drawer a definite-height container for h-full to resolve against", () => {
    const m = layoutSrc.match(/className=\{`([^`]*translate-x-0[^`]*)`\}/);
    expect(m).toBeTruthy();
    const cls = m[1];
    expect(cls).toContain("fixed");
    expect(cls).toContain("inset-y-0");
    expect(cls).toContain("lg:hidden");
  });

  it("keeps the desktop wrapper a stretched flex parent", () => {
    // h-full resolves against this wrapper; as a stretched flex item of the
    // 100dvh shell its height is definite on desktop too.
    expect(layoutSrc).toContain('className="hidden lg:flex"');
  });
});
