// System Status page: host, application, and storage telemetry must match the
// real sources (live DB schema, file stats, route handlers), never invented numbers.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { getAdapter } from "@/lib/db/driver.js";
import { DATA_FILE } from "@/lib/db/paths.js";
import { getSystemTelemetry } from "@/lib/system/statsCollector.js";
import { GET, POST } from "@/app/api/system/status/route.js";

const REPO = process.cwd();

function jsonRequest(body) {
  return new Request("http://localhost/api/system/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("system telemetry", () => {
  it("collects complete host, application, and storage telemetry", async () => {
    const t = await getSystemTelemetry();

    expect(typeof t.timestamp).toBe("number");
    expect(typeof t.host.hostname).toBe("string");
    expect(t.host.cpu.coreCount).toBeGreaterThan(0);
    expect(t.host.memory.totalBytes).toBeGreaterThan(0);
    expect(t.host.memory.usagePercent).toBeGreaterThanOrEqual(0);
    expect(t.host.memory.usagePercent).toBeLessThanOrEqual(100);
    expect(t.host.network.length).toBeGreaterThan(0);

    expect(t.application.pid).toBe(process.pid);
    expect(t.application.memory.rssBytes).toBeGreaterThan(0);
    expect(t.application.memory.heapTotalBytes).toBeGreaterThan(0);
    expect(t.application.v8Heap.heapSizeLimit).toBeGreaterThan(0);
    expect(t.application.eventLoop).toBeTruthy();
    expect(typeof t.application.handlesAndRequests.activeHandles).toBe("number");
  });

  it("counts rows from the real DB schema, not foreign table names", async () => {
    const t = await getSystemTelemetry();
    const adapter = await getAdapter();

    // Read straight from this fork's schema: if the collector maps the wrong
    // table name, its count is 0 while the real count is not.
    const real = {
      providers: adapter.get("SELECT COUNT(*) as c FROM providerConnections").c,
      proxyPools: adapter.get("SELECT COUNT(*) as c FROM proxyPools").c,
      keys: adapter.get("SELECT COUNT(*) as c FROM apiKeys").c,
      combos: adapter.get("SELECT COUNT(*) as c FROM combos").c,
    };

    expect(real.providers).toBeGreaterThan(0);
    expect(real.proxyPools).toBeGreaterThan(0);
    expect(real.keys).toBeGreaterThan(0);
    expect(real.combos).toBeGreaterThan(0);

    expect(t.storage.connected).toBe(true);
    expect(t.storage.counts).toEqual(real);
  });

  it("reports storage sizes matching file stats, with totals equal to their parts", async () => {
    const t = await getSystemTelemetry();

    expect(t.storage.dbPath).toBe(DATA_FILE);
    expect(t.storage.dbSizeBytes).toBe(fs.statSync(DATA_FILE).size);
    expect(t.storage.dbSizeBytes).toBeGreaterThan(0);

    const wal = `${DATA_FILE}-wal`;
    const shm = `${DATA_FILE}-shm`;
    expect(t.storage.walSizeBytes).toBe(fs.existsSync(wal) ? fs.statSync(wal).size : 0);
    expect(t.storage.shmSizeBytes).toBe(fs.existsSync(shm) ? fs.statSync(shm).size : 0);
    expect(t.storage.totalStorageBytes).toBe(
      t.storage.dbSizeBytes + t.storage.walSizeBytes + t.storage.shmSizeBytes
    );
    expect(Array.isArray(t.storage.disks)).toBe(true);
    expect(t.storage.disks.length).toBeGreaterThan(0);
  });

  it("links the sidebar entry to a page that really exists", async () => {
    const sidebar = fs.readFileSync(path.join(REPO, "src/shared/components/Sidebar.js"), "utf8");
    expect(sidebar).toContain('href: "/dashboard/system-status"');
    const page = path.join(REPO, "src/app/(dashboard)/dashboard/system-status/page.js");
    expect(fs.existsSync(page)).toBe(true);
  });
});

describe("route /api/system/status", () => {
  afterEach(() => {
    delete global.gc;
  });

  it("GET returns the same telemetry the collector produces", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.storage.counts).toEqual((await getSystemTelemetry()).storage.counts);
    expect(body.data.application.pid).toBe(process.pid);
  });

  it("reports whether the runtime exposes garbage collection", async () => {
    delete global.gc;
    expect((await getSystemTelemetry()).application.gcAvailable).toBe(false);

    global.gc = () => {};
    expect((await getSystemTelemetry()).application.gcAvailable).toBe(true);
    delete global.gc;
  });

  it("exposes the GC capability on the route payload the UI reads", async () => {
    delete global.gc;
    const res = await GET();
    const body = await res.json();
    expect(body.data.application.gcAvailable).toBe(false);
  });

  it("POST gc runs collection when available and reports the heap delta", async () => {
    let called = 0;
    global.gc = () => {
      called += 1;
    };

    const res = await POST(jsonRequest({ action: "gc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(called).toBe(1);
    expect(body.ok).toBe(true);
    expect(body.message).toBe("Garbage collection executed");
    expect(typeof body.freedBytes).toBe("number");
    expect(body.freedBytes).toBeGreaterThanOrEqual(0);
  });

  it("POST gc explains itself when the runtime does not expose GC", async () => {
    delete global.gc;

    const res = await POST(jsonRequest({ action: "gc" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.message).toContain("--expose-gc");
  });

  it("rejects an unknown action with 400", async () => {
    const res = await POST(jsonRequest({ action: "drop-everything" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});