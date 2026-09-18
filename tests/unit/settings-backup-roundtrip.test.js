// Guards that dashboard settings survive a backup restore.
//
// Per-provider tunables live at settings.providerStrategies.<provider>. exportSettings
// returns the raw settings row unfiltered, and importDb writes payload.settings
// wholesale, so the value is expected to round-trip. This test pins that
// expectation so a future field-picking refactor in the settings exporter cannot
// quietly drop provider tunables the way the apiKeys exporter dropped 8 columns.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("settings survive backup round-trip", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-settings-bk-"));
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

  async function seed() {
    const db = await import("../../src/lib/db/index.js");
    await db.updateSettings({
      providerStrategies: {
        tokenharbor: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 },
      },
      stickyRoundRobinLimit: 7,
      comboStrategy: "round-robin",
      quotaVisibility: { tokenharbor: { hidden: ["x"] } },
    });
    return db;
  }

  it("keeps per-provider strategy in the backup", async () => {
    const db = await seed();
    const backup = await db.exportDb();

    expect(backup.settings.providerStrategies.tokenharbor.stickyRoundRobinLimit).toBe(3);
    expect(backup.settings.providerStrategies.tokenharbor.fallbackStrategy).toBe("round-robin");
    // Sibling settings must not be collateral damage.
    expect(backup.settings.stickyRoundRobinLimit).toBe(7);
    expect(backup.settings.comboStrategy).toBe("round-robin");
    expect(backup.settings.quotaVisibility.tokenharbor.hidden).toEqual(["x"]);
  });

  it("restores provider strategies byte-for-byte through import → export", async () => {
    const db = await seed();
    const backup = await db.exportDb();

    // Clobber it to prove the restore is what brings it back.
    await db.updateSettings({
      providerStrategies: { tokenharbor: { fallbackStrategy: "sticky" } },
    });
    const clobbered = await db.getSettings();
    expect(clobbered.providerStrategies.tokenharbor.stickyRoundRobinLimit).toBeUndefined();

    await db.importDb(backup);

    const restored = await db.getSettings();
    expect(restored.providerStrategies.tokenharbor.stickyRoundRobinLimit).toBe(3);
    expect(restored.providerStrategies.tokenharbor.fallbackStrategy).toBe("round-robin");
    expect(restored.stickyRoundRobinLimit).toBe(7);
  });

  it("imports an old backup with no providerStrategies key at all", async () => {
    const db = await import("../../src/lib/db/index.js");

    await db.importDb({ settings: { stickyRoundRobinLimit: 2 } });

    const restored = await db.getSettings();
    expect(restored.stickyRoundRobinLimit).toBe(2);
    // mergeWithDefaults fills the missing bag rather than leaving it undefined.
    expect(restored.providerStrategies).toEqual({});
  });
});