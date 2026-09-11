// Guards the bulk "Apply Proxy" planning + write path.
//
// Before this, the dashboard applied a proxy pool by looping PUT /api/providers/[id]
// once per connection in the browser. 500 accounts = 500 round trips, 500
// transactions, tens of seconds of dead UI, and a failure part-way left the
// batch half-applied with no way to know which half.
//
// Two things must hold: the plan must skip connections that already have the
// requested pool (a repeat apply should cost zero writes), and the write must
// be one transaction that reports rows that vanished instead of silently
// dropping them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BULK_PROXY_MODES, planProxyAssignments } from "../../src/shared/utils/bulkProxyAssign";

const conn = (id, poolId) => ({
  id,
  providerSpecificData: poolId === undefined ? {} : { proxyPoolId: poolId },
});

describe("planProxyAssignments — single pool", () => {
  it("targets every connection when none has a pool yet", () => {
    const plan = planProxyAssignments([conn("a"), conn("b"), conn("c")], {
      mode: BULK_PROXY_MODES.SINGLE,
      proxyPoolId: "pool-1",
    });
    expect(plan.targets).toEqual([
      { id: "a", proxyPoolId: "pool-1" },
      { id: "b", proxyPoolId: "pool-1" },
      { id: "c", proxyPoolId: "pool-1" },
    ]);
    expect(plan.unchanged).toBe(0);
    expect(plan.total).toBe(3);
    expect(plan.error).toBeNull();
  });

  it("skips connections that already hold the requested pool", () => {
    // The point of `unchanged`: re-applying the same pool must not rewrite rows.
    const plan = planProxyAssignments(
      [conn("a", "pool-1"), conn("b", "pool-2"), conn("c", "pool-1")],
      { mode: BULK_PROXY_MODES.SINGLE, proxyPoolId: "pool-1" },
    );
    expect(plan.targets).toEqual([{ id: "b", proxyPoolId: "pool-1" }]);
    expect(plan.unchanged).toBe(2);
  });

  it("reports zero writes when everything already matches", () => {
    const plan = planProxyAssignments([conn("a", "pool-1"), conn("b", "pool-1")], {
      mode: BULK_PROXY_MODES.SINGLE,
      proxyPoolId: "pool-1",
    });
    expect(plan.targets).toEqual([]);
    expect(plan.unchanged).toBe(2);
  });

  it("treats null / '' / '__none__' as unbind, matching the per-row PUT", () => {
    for (const value of [null, "", "__none__", undefined]) {
      const plan = planProxyAssignments([conn("a", "pool-1"), conn("b")], {
        mode: BULK_PROXY_MODES.SINGLE,
        proxyPoolId: value,
      });
      expect(plan.targets).toEqual([{ id: "a", proxyPoolId: null }]);
      // "b" has no pool and stays untouched.
      expect(plan.unchanged).toBe(1);
    }
  });

  it("ignores connections with no id", () => {
    const plan = planProxyAssignments([{ id: "" }, null, conn("b")], {
      mode: BULK_PROXY_MODES.SINGLE,
      proxyPoolId: "pool-1",
    });
    expect(plan.targets).toEqual([{ id: "b", proxyPoolId: "pool-1" }]);
    expect(plan.total).toBe(1);
  });

  it("returns an empty plan for an empty or non-array input", () => {
    for (const input of [[], null, undefined, "nope"]) {
      const plan = planProxyAssignments(input, { mode: BULK_PROXY_MODES.SINGLE, proxyPoolId: "p" });
      expect(plan.targets).toEqual([]);
      expect(plan.total).toBe(0);
      expect(plan.error).toBeNull();
    }
  });
});

describe("planProxyAssignments — one-to-one rotation", () => {
  it("spreads active pools across connections round-robin", () => {
    const plan = planProxyAssignments([conn("a"), conn("b"), conn("c"), conn("d")], {
      mode: BULK_PROXY_MODES.ONE_TO_ONE,
      activePoolIds: ["p1", "p2"],
    });
    expect(plan.targets.map((t) => t.proxyPoolId)).toEqual(["p1", "p2", "p1", "p2"]);
  });

  it("gives every connection the same pool when only one is active", () => {
    const plan = planProxyAssignments([conn("a"), conn("b")], {
      mode: BULK_PROXY_MODES.ONE_TO_ONE,
      activePoolIds: ["only"],
    });
    expect(plan.targets.map((t) => t.proxyPoolId)).toEqual(["only", "only"]);
  });

  it("refuses the batch when no pool is active", () => {
    // A silent no-op would look like success in the UI.
    const plan = planProxyAssignments([conn("a")], {
      mode: BULK_PROXY_MODES.ONE_TO_ONE,
      activePoolIds: [],
    });
    expect(plan.error).toBe("No active proxy pools available.");
    expect(plan.targets).toEqual([]);
  });
});

describe("bulkSetConnectionProxyPool — one transaction", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bulkproxy-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    delete global._dbAdapter;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("binds one pool across many connections and preserves other fields", async () => {
    const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    await repo.createProviderConnection({
      provider: "tokenharbor",
      authType: "apikey",
      name: "acct-1",
      apiKey: "k1",
      providerSpecificData: { keepMe: "yes" },
    });
    await repo.createProviderConnection({
      provider: "tokenharbor",
      authType: "apikey",
      name: "acct-2",
      apiKey: "k2",
    });

    const all = await repo.getProviderConnections({ provider: "tokenharbor" });
    expect(all).toHaveLength(2);

    const res = await repo.bulkSetConnectionProxyPool(
      all.map((c) => ({ id: c.id, proxyPoolId: "pool-x" })),
    );
    expect(res).toEqual({ updated: 2, missing: [] });

    const after = await repo.getProviderConnections({ provider: "tokenharbor" });
    for (const c of after) {
      expect(c.providerSpecificData.proxyPoolId).toBe("pool-x");
    }
    // The merge must not clobber unrelated providerSpecificData.
    const withExtra = after.find((c) => c.name === "acct-1");
    expect(withExtra.providerSpecificData.keepMe).toBe("yes");
    // Credentials survive the bulk write.
    expect(after.find((c) => c.name === "acct-1").apiKey).toBe("k1");
  });

  it("unbinds by deleting the key rather than storing null", async () => {
    const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    const created = await repo.createProviderConnection({
      provider: "tokenharbor",
      authType: "apikey",
      name: "acct-unbind",
      apiKey: "k",
      providerSpecificData: { proxyPoolId: "pool-x" },
    });

    await repo.bulkSetConnectionProxyPool([{ id: created.id, proxyPoolId: null }]);

    const after = await repo.getProviderConnectionById(created.id);
    // Key gone entirely — a lingering null could be re-adopted by a later resolve.
    expect("proxyPoolId" in after.providerSpecificData).toBe(false);
  });

  it("reports unknown ids as missing instead of silently skipping them", async () => {
    const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    const created = await repo.createProviderConnection({
      provider: "tokenharbor",
      authType: "apikey",
      name: "acct-real",
      apiKey: "k",
    });

    const res = await repo.bulkSetConnectionProxyPool([
      { id: created.id, proxyPoolId: "pool-y" },
      { id: "does-not-exist", proxyPoolId: "pool-y" },
    ]);

    expect(res.updated).toBe(1);
    expect(res.missing).toEqual(["does-not-exist"]);
  });

  it("is a no-op for an empty list", async () => {
    const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    expect(await repo.bulkSetConnectionProxyPool([])).toEqual({ updated: 0, missing: [] });
    expect(await repo.bulkSetConnectionProxyPool(null)).toEqual({ updated: 0, missing: [] });
  });
});
