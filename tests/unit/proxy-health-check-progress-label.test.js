import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// "Checking 3/12" is a progress readout, not an inactive control: it is the only
// sign that a bulk check is moving. Rendered as a disabled primary Button it picks
// up two dimming layers (`disabled:opacity-50` plus `disabled:text-text-muted`),
// and in the neubrutalist/pinkneon looks a theme rule keyed on `.bg-brand-500`
// overrides the colour with the theme ink. On the compiled CSS that label measures
// 1.25:1 (pinkneon dark) up to 3.51:1 — invisible to barely readable, in all six
// theme combinations. It must be its own element with a legible colour pair.

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const PAGE = read("src/app/(dashboard)/dashboard/proxy-pools/page.js");

const branch = () => {
  const start = PAGE.indexOf("{healthChecking ?");
  expect(start, "health-check progress branch not found").toBeGreaterThan(-1);
  return PAGE.slice(start, PAGE.indexOf("Health Check", start));
};

const chipClasses = () => {
  const m = /className="([^"]*)"/.exec(branch());
  expect(m, "status element class list not found").toBeTruthy();
  return m[1];
};

describe("proxy health check progress label", () => {
  it("is a status element, not the dimmed trigger button", () => {
    expect(branch()).not.toMatch(/<Button[\s\S]*Checking/);
  });

  it("uses a colour pair that stays legible in every theme", () => {
    const cls = chipClasses();
    expect(cls).toContain("bg-surface-3");
    expect(cls).toContain("text-text-main");
    expect(cls).not.toContain("text-white");
    expect(cls).not.toContain("bg-brand-500");
    expect(cls).not.toContain("opacity-50");
  });

  it("keeps the spinner so the state still reads as in-progress", () => {
    expect(branch()).toContain("progress_activity");
    expect(branch()).toContain("animate-spin");
  });

  it("matches the small button metrics so the row never shifts", () => {
    const cls = chipClasses();
    for (const token of ["h-7", "px-3", "text-xs", "rounded-[8px]", "whitespace-nowrap"]) {
      expect(cls).toContain(token);
    }
  });
});
