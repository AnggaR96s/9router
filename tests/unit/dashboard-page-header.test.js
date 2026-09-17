// The dashboard top bar takes its title, description and icon from a route map in
// Header.js. A route missing from that map renders an empty header (the page body
// still shows, the top bar does not), so every dashboard page must be mapped.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { getPageInfo } from "@/shared/components/pageInfo.js";

const DASHBOARD_DIR = path.join(process.cwd(), "src/app/(dashboard)/dashboard");

function collectRoutes(dir = DASHBOARD_DIR, prefix = "/dashboard") {
  const routes = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    const route = `${prefix}/${entry.name}`;
    if (fs.existsSync(path.join(child, "page.js"))) routes.push(route);
    routes.push(...collectRoutes(child, route));
  }
  return routes;
}

// Dynamic segments must be resolved to something before the map can match them.
const withSampleParams = (route) => route.replace(/\[[^\]]+\]/g, "sample");

const routes = collectRoutes();

describe("dashboard header route map", () => {
  it("discovers every dashboard page", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/dashboard/system-status");
    expect(routes).toContain("/dashboard/proxy-pools");
  });

  it.each(routes)("%s renders a header title and icon", (route) => {
    const info = getPageInfo(withSampleParams(route));

    expect(typeof info.title).toBe("string");
    expect(info.title.trim()).not.toBe("");
    // media provider detail pages carry their identity in breadcrumbs instead
    expect(Boolean(info.icon) || (info.breadcrumbs?.length ?? 0) > 0).toBe(true);
  });

  it("returns an empty header for an unmapped route", () => {
    expect(getPageInfo("/dashboard/does-not-exist").title).toBe("");
  });

  it("keeps the top bar wired to the map it tests", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/shared/components/Header.js"), "utf8");
    expect(src).toContain('from "@/shared/components/pageInfo"');
    expect(src).not.toContain("const getPageInfo");
  });
});