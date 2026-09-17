// Telemetry must not blow up when the DB driver is unavailable: the status page
// keeps showing host metrics, only the DB portion drops to zero.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => {
    throw new Error("[DB] No SQLite driver available");
  },
}));

describe("telemetry without a DB driver", () => {
  it("still returns host metrics with storage zeroed out", async () => {
    const { getSystemTelemetry } = await import("@/lib/system/statsCollector.js");
    const t = await getSystemTelemetry();

    expect(t.application.pid).toBe(process.pid);
    expect(t.host.cpu.coreCount).toBeGreaterThan(0);
    expect(t.storage.connected).toBe(false);
    expect(t.storage.counts).toEqual({ providers: 0, proxyPools: 0, keys: 0, combos: 0 });
    expect(t.storage.totalStorageBytes).toBe(
      t.storage.dbSizeBytes + t.storage.walSizeBytes + t.storage.shmSizeBytes
    );
  });
});