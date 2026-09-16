import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The dashboard header is a plain flex child, so nothing in the shell pinned it:
// it stayed on screen only because the page never scrolled at the root. On a
// mobile browser the URL bar makes the visible viewport shorter than a 100vh
// shell, which leaves the document scrollable, and the first downward scroll
// carries the header off screen. The shell now sizes itself to the dynamic
// viewport and clips with `overflow-clip` (clipping without turning the shell
// into a scroll container), so the sticky header resolves against the document
// and stays put even when something does scroll the root.

const HEADER = path.join(process.cwd(), "src/shared/components/Header.js");
const LAYOUT = path.join(
  process.cwd(),
  "src/shared/components/layouts/DashboardLayout.js"
);
const CSS = path.join(process.cwd(), "src/app/globals.css");

// grab the class expression (quoted string or template literal) that sits on
// the same element as `needle`, without regex gymnastics.
function classExpr(src, needle) {
  const at = src.indexOf(needle);
  if (at === -1) return null;
  // the class attribute is either before the needle (needle sits inside the
  // class list) or after it (needle is the element's tag name).
  let open = src.lastIndexOf("className=", at);
  if (open === -1 || open + 400 < at) {
    const fwd = src.indexOf("className=", at);
    const tagEnd = src.indexOf(">", at);
    open = fwd !== -1 && (tagEnd === -1 || fwd < tagEnd) ? fwd : -1;
  }
  if (open === -1) return null;
  let q = open + "className=".length;
  if (src[q] === "{") q += 1;
  const quote = src[q];
  if (quote !== '"' && quote !== "`") return null;
  const start = q + 1;
  const end = src.indexOf(quote, start);
  if (end === -1 || end < at) return null;
  return src.slice(start, end);
}

const headerSrc = fs.readFileSync(HEADER, "utf8");
const layoutSrc = fs.readFileSync(LAYOUT, "utf8");
const cssSrc = fs.readFileSync(CSS, "utf8");

describe("dashboard header stays visible while scrolling", () => {
  it("sticks the header to the top of the viewport", () => {
    const cls = classExpr(headerSrc, "<header");
    expect(cls).toBeTruthy();
    expect(cls).toContain("sticky");
    expect(cls).toContain("top-0");
  });

  it("keeps a background on the stuck header for small screens", () => {
    const cls = classExpr(headerSrc, "<header");
    expect(cls).toContain("bg-surface/60");
    expect(cls).toContain("backdrop-blur-xl");
  });

  it("clips the shell without making it a scroll container", () => {
    const cls = classExpr(layoutSrc, "dashboard-shell");
    expect(cls).toBeTruthy();
    expect(cls).toContain("overflow-clip");
    // overflow-hidden would make the shell the sticky containing scroll box,
    // which leaves the header stranded when the document scrolls.
    expect(cls).not.toContain("overflow-hidden");
  });

  it("sizes the shell to the dynamic viewport, with a 100vh fallback", () => {
    const cls = classExpr(layoutSrc, "dashboard-shell");
    // h-screen/h-dvh as utilities cannot be layered safely: the generated CSS
    // puts .h-screen after .h-dvh, so the fallback would always win.
    expect(cls).not.toContain("h-screen");
    expect(cls).not.toContain("h-dvh");
    expect(cssSrc).toMatch(/\.dashboard-shell\s*\{[^}]*height:\s*100vh/);
    expect(cssSrc).toMatch(
      /@supports\s*\(height:\s*100dvh\)\s*\{[^}]*\.dashboard-shell\s*\{[^}]*height:\s*100dvh/s
    );
  });

  it("stops the inner scroller from chaining its overscroll to the root", () => {
    const cls = classExpr(layoutSrc, "custom-scrollbar");
    expect(cls).toBeTruthy();
    expect(cls).toContain("overscroll-contain");
  });
});
