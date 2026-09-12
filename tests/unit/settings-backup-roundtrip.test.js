// Guards that dashboard settings survive a backup restore.
//
// Pacing gap lives at settings.providerStrategies.freebuff.pacingGapSeconds.
// _getFreebuffPacingGapMs reads it via the in-memory override, which is primed
// from getSettings() on startup and on every settings PATCH. So the question
// "does pacing survive a restore?" is really: does exportDb/importDb carry the
// providerStrategies blob faithfully, and is the override re-primed after?
//
// exportSettings returns the raw settings row unfiltered, and importDb writes
// payload.settings wholesale, so the value is expected to round-trip. This test
// pins that expectation so a future field-picking refactor in the settings
// exporter cannot quietly drop provider tunables the way the apiKeys exporter
// dropped 8 columns.
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
        freebuff: { strictModelAssignment: false, pacingGapSeconds: 10 },
      },
      stickyRoundRobinLimit: 7,
      comboStrategy: "round-robin",
      quotaVisibility: { freebuff: { hidden: ["x"] } },
    });
    return db;
  }

  it("keeps providerStrategies.freebuff.pacingGapSeconds in the backup", async () => {
    const db = await seed();
    const backup = await db.exportDb();

    expect(backup.settings.providerStrategies.freebuff.pacingGapSeconds).toBe(10);
    expect(backup.settings.providerStrategies.freebuff.strictModelAssignment).toBe(false);
    // Sibling settings must not be collateral damage.
    expect(backup.settings.stickyRoundRobinLimit).toBe(7);
    expect(backup.settings.comboStrategy).toBe("round-robin");
    expect(backup.settings.quotaVisibility.freebuff.hidden).toEqual(["x"]);
  });

  it("restores the pacing gap byte-for-byte through import → export", async () => {
    const db = await seed();
    const backup = await db.exportDb();

    // Clobber it to prove the restore is what brings it back.
    await db.updateSettings({
      providerStrategies: { freebuff: { strictModelAssignment: true } },
    });
    const clobbered = await db.getSettings();
    expect(clobbered.providerStrategies.freebuff.pacingGapSeconds).toBeUndefined();

    await db.importDb(backup);

    const restored = await db.getSettings();
    expect(restored.providerStrategies.freebuff.pacingGapSeconds).toBe(10);
    expect(restored.providerStrategies.freebuff.strictModelAssignment).toBe(false);
    expect(restored.stickyRoundRobinLimit).toBe(7);
  });

  it("re-primes the pacing override from restored settings", async () => {
    // The real-world sequence: restore, restart, gateway boots and primes from
    // settings. If that priming did not read providerStrategies the field would
    // show 10 in the dashboard while the executor paced at the default.
    const db = await seed();
    const backup = await db.exportDb();
    await db.importDb(backup);

    const pacing = await import("../../open-sse/shared/freebuffPacing.js");
    pacing.applyFreebuffPacingSettings(await db.getSettings());
    expect(pacing.getFreebuffPacingGapMs()).toBe(10_000);

    // And with no stored value, the default still applies after a restore.
    await db.updateSettings({ providerStrategies: { freebuff: {} } });
    pacing.applyFreebuffPacingSettings(await db.getSettings());
    expect(pacing.getFreebuffPacingGapMs()).toBe(20_000);
  });

  it("imports an old backup with no providerStrategies key at all", async () => {
    const db = await import("../../src/lib/db/index.js");
    const pacing = await import("../../open-sse/shared/freebuffPacing.js");

    await db.importDb({ settings: { stickyRoundRobinLimit: 2 } });

    const restored = await db.getSettings();
    expect(restored.stickyRoundRobinLimit).toBe(2);
    // mergeWithDefaults fills the missing bag rather than leaving it undefined.
    expect(restored.providerStrategies).toEqual({});

    pacing.applyFreebuffPacingSettings(restored);
    expect(pacing.getFreebuffPacingGapMs()).toBe(20_000);
  });
});
