// The System Status page prints application.eventLoop.* as "Event Loop Lag".
// Those numbers come from monitorEventLoopDelay, whose histogram records the
// interval between its own ticks: every bucket carries the sampling resolution.
// A healthy gateway therefore showed ~20ms of "lag" and the KPI warned forever
// while the real loop lag was ~0. Raw nanoseconds below are what this runtime
// actually reported: 20.09ms between two ticks of a healthy loop, 319.03ms for
// a deliberate 300ms block.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getSystemTelemetry, __test__ } from "@/lib/system/statsCollector.js";

const { toLagMs, EVENT_LOOP_RESOLUTION_MS } = __test__;

// Real timer drift in this process, measured by hand: each 20ms tick against
// the deadline it was scheduled for. Negative means the timer ran early.
async function manualLagMs(durationMs) {
  const lags = [];
  const t0 = performance.now();
  let n = 0;
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      n += 1;
      lags.push(now - (t0 + n * EVENT_LOOP_RESOLUTION_MS));
      if (now - t0 >= durationMs) return resolve();
      setTimeout(tick, Math.max(0, t0 + (n + 1) * EVENT_LOOP_RESOLUTION_MS - now));
    };
    setTimeout(tick, EVENT_LOOP_RESOLUTION_MS);
  });
  const sorted = [...lags].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe("system status event loop lag", () => {
  it("reports a healthy tick as ~0 lag instead of the sampling interval", () => {
    expect(toLagMs(20.09 * 1e6)).toBeLessThan(EVENT_LOOP_RESOLUTION_MS / 4);
  });

  it("keeps the size of a real stall instead of swallowing it", () => {
    // a 300ms block that the histogram logged as 319.03ms
    expect(toLagMs(319.03 * 1e6)).toBeGreaterThan(250);
    // and a stall past the old 100s ceiling must not collapse to 0
    expect(toLagMs(1.5e11)).toBeGreaterThan(100000);
  });

  it("never reports a negative lag when a tick fires early", () => {
    expect(toLagMs(0.01 * 1e6)).toBe(0);
    expect(toLagMs(0)).toBe(0);
    expect(toLagMs(Number.NaN)).toBe(0);
  });

  it("ignores the Int64 sentinel an empty histogram reports for min", () => {
    // First sample after boot: min is 9223372036854775807 until a tick lands.
    expect(toLagMs(9223372036854775807)).toBe(0);
  });

  it("wires that conversion into the telemetry the page actually reads", async () => {
    // Measuring the drift fills the histogram with ticks at the same time, so
    // both numbers describe the same window of the same process and have to
    // agree: the histogram may not sit a whole resolution above the real drift.
    const manualP50 = await manualLagMs(600);
    const telemetry = await getSystemTelemetry();
    const reportedP50 = telemetry.application.eventLoop.p50Ms;

    expect(reportedP50).toBeLessThan(EVENT_LOOP_RESOLUTION_MS / 2);
    expect(Math.abs(reportedP50 - manualP50)).toBeLessThan(EVENT_LOOP_RESOLUTION_MS / 2);
  });

  it("takes the sampler resolution from the same constant it subtracts", () => {
    // Two separate 20s would let the fix drift silently: change one and the
    // reported lag is offset by the difference forever. The sampler and the
    // conversion must read one constant.
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/system/statsCollector.js"),
      "utf8"
    );
    expect(src).toMatch(/const EVENT_LOOP_RESOLUTION_MS = (\d+);/);
    expect(src).toMatch(/monitorEventLoopDelay\(\{ resolution: EVENT_LOOP_RESOLUTION_MS \}\)/);
    expect(src).not.toMatch(/monitorEventLoopDelay\(\{ resolution: \d/);
  });
});
