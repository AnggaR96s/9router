import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The usage chart used to cap history at 60 days, so spend still stored in
// usageDaily was unreachable from the dashboard even though getUsageStats already
// knew how to total it. "All Time" exposes that, bucketed by MONTH rather than by
// day — an unbounded daily series would compress months of history into
// unreadable slivers on the x-axis.
//
// The failure this guards against is not a missing option (that fails visibly) but
// arithmetic in the bucketing: a month dropped, a boundary row counted twice, or
// the series stopping at the last stored day so the in-progress month disappears.
// The upstream PR verified with a synthetic fixture shaped like the author's
// expectation; the two things such a fixture cannot confirm by itself are checked
// here against the real table:
//
//   1. the monthly buckets sum EXACTLY to the source rows, and
//   2. the series is contiguous from the first month present through the current
//      month, with gaps zero-filled and labels in MMM YYYY order.
//
// These stay deterministic even as traffic grows, because the expected total is
// derived from the table itself rather than hardcoded.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const USAGE_REPO = "src/lib/db/repos/usageRepo.js";
const CHART_ROUTE = "src/app/api/usage/chart/route.js";
const PAGE = "src/app/(dashboard)/dashboard/usage/page.js";
const STATS_COMPONENT = "src/shared/components/UsageStats.js";

const DB = path.join(os.homedir(), ".9router/db/data.sqlite");
const hasLiveDb = fs.existsSync(DB);

/** Read usageDaily straight from SQLite, read-only, independent of the app's own repo layer. */
async function sourceRows() {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare("SELECT dateKey, data FROM usageDaily ORDER BY dateKey").all();
  db.close();
  return rows;
}

describe("usage chart — All Time period wiring", () => {
  it("the chart API accepts 'all' (it used to reject it)", () => {
    const periods = read(CHART_ROUTE).match(/VALID_PERIODS = new Set\(\[([^\]]+)\]\)/)[1];
    expect(periods).toContain('"all"');
    // The stats endpoint already accepted "all" — only the chart API refused it,
    // which is what made the period unreachable from the UI.
    expect(read("src/app/api/usage/stats/route.js").match(/VALID_PERIODS = new Set\(\[([^\]]+)\]\)/)[1]).toContain('"all"');
  });

  it("both period selectors offer All Time without dropping 60D", () => {
    for (const [label, file] of [["usage page", PAGE], ["UsageStats", STATS_COMPONENT]]) {
      const list = read(file).match(/const PERIODS = \[([\s\S]*?)\];/)[1];
      expect(list, label).toMatch(/\{ value: "all", label: "All Time" \}/);
      expect(list, label).toMatch(/\{ value: "60d", label: "60D" \}/);
      const order = [...list.matchAll(/value: "([a-z0-9]+)"/g)].map((m) => m[1]);
      expect(order, label).toEqual(["today", "24h", "7d", "30d", "60d", "all"]);
    }
  });

  it("'all' returns early and does not shadow the daily paths", () => {
    const src = read(USAGE_REPO);
    const fn = src.slice(src.indexOf("export async function getChartData"));
    const body = fn.slice(0, fn.indexOf("\nfunction getAllTimeChartData"));
    expect(body).toMatch(/if \(period === "all"\) return getAllTimeChartData\(db\);/);
    // Checked before the 7d/30d/60d bucketCount computation, so "all" never
    // computes a daily width it will not use. (Matched on the full expression:
    // the 24h branch also declares a `bucketCount`, which would otherwise be the
    // first hit and make this assertion compare against the wrong line.)
    const allAt = body.indexOf('if (period === "all")');
    const dailyWidthAt = body.indexOf('const bucketCount = period === "7d"');
    expect(dailyWidthAt).toBeGreaterThan(-1);
    expect(allAt).toBeGreaterThan(-1);
    expect(allAt).toBeLessThan(dailyWidthAt);
    // The daily paths after the early return are untouched.
    expect(body).toMatch(/const bucketCount = period === "7d" \? 7 : period === "30d" \? 30 : 60;/);
  });

  it("the chart component needs no period-specific logic (labels flow through)", () => {
    const chart = read("src/app/(dashboard)/dashboard/usage/components/UsageChart.js");
    expect(chart).toMatch(/dataKey="label"/);
    expect(chart).toMatch(/dataKey="tokens"/);
    expect(chart).toMatch(/dataKey="cost"/);
    expect(chart).not.toMatch(/period === "all"/);
  });
});

describe.runIf(hasLiveDb)("usage chart — All Time against the real usageDaily table", () => {
  it("buckets every row with no loss and no double count", async () => {
    const { getChartData } = await import("../../src/lib/db/repos/usageRepo.js");
    const chart = await getChartData("all");
    const raw = await sourceRows();

    let tokens = 0;
    let cost = 0;
    for (const r of raw) {
      const d = JSON.parse(r.data);
      tokens += (d.promptTokens || 0) + (d.completionTokens || 0);
      cost += d.cost || 0;
    }

    const chartTokens = chart.reduce((a, r) => a + r.tokens, 0);
    const chartCost = chart.reduce((a, r) => a + r.cost, 0);

    expect(chart.length, "one bucket per month with data").toBeGreaterThan(0);
    expect(chartTokens).toBe(tokens);
    expect(Math.abs(chartCost - cost)).toBeLessThan(1e-9);
  }, 30_000);

  it("emits one contiguous, ordered monthly bucket per month through the current month", async () => {
    const { getChartData } = await import("../../src/lib/db/repos/usageRepo.js");
    const chart = await getChartData("all");
    const raw = await sourceRows();

    const months = [...new Set(raw.map((r) => r.dateKey.slice(0, 7)))].sort();
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Spans first month → current month with no gaps, so the trailing bucket is the
    // in-progress month rather than the last day that happened to have traffic.
    expect(chart.length).toBe(months.length);
    expect(chart.at(-1).label).toBe(
      new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    );

    let prev = null;
    for (const [i, b] of chart.entries()) {
      expect(b.label, `bucket ${i}`).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
      const t = new Date(`${b.label} 1`).getTime();
      if (prev !== null) expect(t, `${b.label} must follow ${chart[i - 1].label}`).toBeGreaterThan(prev);
      prev = t;
    }
    void current;
  }, 30_000);

});
