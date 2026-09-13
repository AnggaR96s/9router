import { describe, it, expect, vi } from "vitest";

// Bucketing arithmetic for the All Time chart, driven against an injected
// adapter rather than the live table.
//
// This lives in its own file on purpose: `vi.doMock` replaces the database
// driver for the module registry of the file it runs in, so keeping the mocked
// cases next to the live-table ones silently starved the live tests of real rows
// (they saw an empty adapter and asserted 0 buckets against 3 months of data).
// Vitest isolates files, so separating them is what keeps both honest.

const mkAdapter = (rows) => ({
  all: (sql) => (/FROM usageDaily/.test(sql) ? rows : []),
  get: () => undefined,
  run: () => {},
});

const day = (dateKey, promptTokens, completionTokens, cost) => ({
  dateKey,
  data: JSON.stringify({ promptTokens, completionTokens, cost }),
});

async function chartWith(rows) {
  vi.resetModules();
  vi.doMock("../../src/lib/db/driver.js", () => ({
    getAdapter: async () => mkAdapter(rows),
    default: {},
  }));
  const { getChartData } = await import("../../src/lib/db/repos/usageRepo.js");
  const out = await getChartData("all");
  vi.doUnmock("../../src/lib/db/driver.js");
  return out;
}

describe("usage chart — All Time with a synthetic table", () => {
  // The live table happens to have no month gaps (Jul/Aug/Sep 2026 are
  // contiguous), so gap-filling and current-month extension are invisible
  // against it — a mutation that drops either one still passes. These cases
  // drive the real getChartData with an injected adapter holding a deliberate
  // gap and an outdated final row, which is the only way to actually exercise
  // those two branches.
  const mkAdapter = (rows) => ({
    all: (sql) => (/FROM usageDaily/.test(sql) ? rows : []),
    get: () => undefined,
    run: () => {},
  });

  const day = (dateKey, promptTokens, completionTokens, cost) => ({
    dateKey,
    data: JSON.stringify({ promptTokens, completionTokens, cost }),
  });

  async function chartWith(rows) {
    vi.resetModules();
    vi.doMock("../../src/lib/db/driver.js", () => ({
      getAdapter: async () => mkAdapter(rows),
      default: {},
    }));
    const { getChartData } = await import("../../src/lib/db/repos/usageRepo.js");
    const out = await getChartData("all");
    vi.doUnmock("../../src/lib/db/driver.js");
    return out;
  }

  it("zero-fills a month with no traffic instead of collapsing the series", async () => {
    // Jan has data, Feb does not, Mar does. A series that skips Feb would look
    // like two consecutive months and misstate the timeline.
    const chart = await chartWith([
      day("2026-01-05", 100, 50, 1),
      day("2026-03-10", 200, 100, 2),
    ]);
    const labels = chart.map((r) => r.label);
    expect(labels).toContain("Feb 2026");
    const feb = chart.find((r) => r.label === "Feb 2026");
    expect(feb.tokens).toBe(0);
    expect(feb.cost).toBe(0);
    // and it sits between them, in order
    expect(labels.indexOf("Jan 2026")).toBeLessThan(labels.indexOf("Feb 2026"));
    expect(labels.indexOf("Feb 2026")).toBeLessThan(labels.indexOf("Mar 2026"));
  }, 30_000);

  it("extends the series through the current month even when data stops earlier", async () => {
    // A chart that ended at the last stored day would hide the in-progress month.
    const chart = await chartWith([day("2026-01-05", 100, 50, 1)]);
    const now = new Date();
    const expectedLast = new Date(now.getFullYear(), now.getMonth(), 1)
      .toLocaleDateString("en-US", { month: "short", year: "numeric" });
    expect(chart.at(-1).label).toBe(expectedLast);
    expect(chart.length).toBeGreaterThan(1);
    // every month after the data-bearing one is a zero bucket
    for (const b of chart.slice(1)) expect(b.tokens).toBe(0);
  }, 30_000);

  it("sums day rows into a month rather than emitting one bucket per day", async () => {
    const chart = await chartWith([
      day("2026-01-05", 100, 50, 1),
      day("2026-01-20", 10, 5, 0.5),
      day("2026-01-31", 1, 1, 0.25),
    ]);
    // Three day rows collapse into ONE month bucket — but the series still runs
    // through the current month, so length is not 1: Jan is the first bucket and
    // everything after it is a zero-filled month up to today.
    expect(chart[0].label).toBe("Jan 2026");
    expect(chart[0].tokens).toBe(100 + 50 + 10 + 5 + 1 + 1);
    expect(chart[0].cost).toBeCloseTo(1.75, 10);
    // The three January days are one bucket, not three.
    expect(chart.filter((r) => r.label === "Jan 2026").length).toBe(1);
    // and no later bucket carries January's tokens
    expect(chart.slice(1).reduce((a, r) => a + r.tokens, 0)).toBe(0);
  }, 30_000);

  it("returns [] for an empty table", async () => {
    expect(await chartWith([])).toEqual([]);
  }, 30_000);
});

