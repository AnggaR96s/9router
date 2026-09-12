// Guards the apiKeys backup round-trip.
//
// The bug this locks down: exportDb hand-picked 6 of the 14 apiKeys columns, so
// a backup silently dropped tokenLimit, usedTokens, resetInterval, lastResetAt,
// allowedModels, rpmLimit, tpmLimit and ipWhitelist. Every one of those is read
// by the limiter (validateApiKey → checkRateLimits), so an export→import cycle
// reset a key's usage to 0 and erased its rate caps and model allowlist WITHOUT
// raising an error. Silent data loss in a backup path is worse than a loud
// failure, because the user only finds out when a limit stops being enforced.
//
// A sibling fork hit the opposite mistake in the same function — 16 columns and
// 15 placeholders — which is why the SQL is now derived from one column list
// instead of being written twice by hand.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("apiKeys backup round-trip", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-apikeys-"));
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

  const KEY_ID = "11111111-2222-3333-4444-555555555555";

  async function seedKey() {
    const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");
    return repo.createApiKey("prod-key", "machine-1", {
      tokenLimit: 5_000_000,
      usedTokens: 1_234_567,
      resetInterval: "daily",
      lastResetAt: "2026-09-01T00:00:00.000Z",
      allowedModels: "cbai/*,freebuff/*",
      rpmLimit: 60,
      tpmLimit: 90_000,
      ipWhitelist: "10.0.0.1,10.0.0.2",
    });
  }

  it("exports EVERY apiKeys column, not a hand-picked subset", async () => {
    const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");
    const created = await seedKey();

    const row = {
      id: created.id, key: created.key, name: created.name,
      machineId: created.machineId, isActive: 1, createdAt: created.createdAt,
      tokenLimit: 5_000_000, usedTokens: 1_234_567, resetInterval: "daily",
      lastResetAt: "2026-09-01T00:00:00.000Z", allowedModels: "cbai/*,freebuff/*",
      rpmLimit: 60, tpmLimit: 90_000, ipWhitelist: "10.0.0.1,10.0.0.2",
    };
    const exported = repo.apiKeyRowToExport(row);

    // Every declared column must be present — this is the assertion that would
    // have failed before the fix.
    for (const col of repo.API_KEY_COLUMNS) {
      expect(exported).toHaveProperty(col);
    }
    expect(Object.keys(exported).sort()).toEqual([...repo.API_KEY_COLUMNS].sort());

    // The 8 columns that used to vanish, by name.
    expect(exported.tokenLimit).toBe(5_000_000);
    expect(exported.usedTokens).toBe(1_234_567);
    expect(exported.resetInterval).toBe("daily");
    expect(exported.lastResetAt).toBe("2026-09-01T00:00:00.000Z");
    expect(exported.allowedModels).toBe("cbai/*,freebuff/*");
    expect(exported.rpmLimit).toBe(60);
    expect(exported.tpmLimit).toBe(90_000);
    expect(exported.ipWhitelist).toBe("10.0.0.1,10.0.0.2");
    // isActive stays a boolean for consumers, like the other exporters.
    expect(exported.isActive).toBe(true);
  });

  it("column list and placeholders always match (derived from one source)", async () => {
    const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");
    const sql = repo.buildApiKeyInsertSql();
    const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").length;
    const marks = sql.slice(sql.indexOf("VALUES(") + 7, sql.lastIndexOf(")")).split(",").length;
    expect(cols).toBe(repo.API_KEY_COLUMNS.length);
    expect(marks).toBe(repo.API_KEY_COLUMNS.length);

    const values = repo.apiKeyInsertValues(repo.normalizeApiKeyForImport({ id: "x" }));
    expect(values).toHaveLength(repo.API_KEY_COLUMNS.length);

    // Same guarantee for the UPDATE builder (id supplies the WHERE).
    const upd = repo.buildApiKeyUpdateSql();
    expect(upd.split("= ?").length - 1).toBe(repo.API_KEY_COLUMNS.length - 1 + 1);
    expect(repo.apiKeyUpdateValues(repo.normalizeApiKeyForImport({ id: "x" })))
      .toHaveLength(repo.API_KEY_COLUMNS.length);
  });

  it("round-trips limits and usage through export → import", async () => {
    const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");
    const db = await import("../../src/lib/db/index.js");

    const created = await seedKey();

    const backup = await db.exportDb();
    const exported = backup.apiKeys.find((k) => k.key === created.key);
    expect(exported).toBeTruthy();
    expect(exported.usedTokens).toBe(1_234_567);

    // Wipe through the real import path, then read back.
    await db.importDb(backup);

    const key = (await repo.getApiKeys()).find((k) => k.key === created.key);
    expect(key).toBeTruthy();
    expect(key.tokenLimit).toBe(5_000_000);
    expect(key.usedTokens).toBe(1_234_567);
    expect(key.resetInterval).toBe("daily");
    expect(key.lastResetAt).toBe("2026-09-01T00:00:00.000Z");
    expect(key.allowedModels).toBe("cbai/*,freebuff/*");
    expect(key.rpmLimit).toBe(60);
    expect(key.tpmLimit).toBe(90_000);
    expect(key.ipWhitelist).toBe("10.0.0.1,10.0.0.2");
    expect(key.isActive).toBe(true);
    expect(key.machineId).toBe("machine-1");
  });

  it("imports a legacy backup that lacks the newer columns, using defaults", async () => {
    // An old export has only the 6 fields; importing it must not throw and must
    // land on the same defaults createApiKey would produce.
    const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");
    const db = await import("../../src/lib/db/index.js");

    await db.importDb({
      apiKeys: [{
        id: KEY_ID, key: "sk_legacy", name: "legacy",
        machineId: "m-1", isActive: true, createdAt: "2026-01-01T00:00:00.000Z",
      }],
    });

    const key = await repo.getApiKeyById(KEY_ID);
    expect(key.key).toBe("sk_legacy");
    expect(key.tokenLimit).toBe(0);
    expect(key.usedTokens).toBe(0);
    expect(key.resetInterval).toBe("never");
    expect(key.allowedModels).toBe("*");
    expect(key.rpmLimit).toBe(0);
    expect(key.ipWhitelist).toBe("");
    expect(key.lastResetAt).toBeNull();
  });

  it("keeps updateApiKey round-tripping every column", async () => {
    const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");
    const created = await seedKey();

    await repo.updateApiKey(created.id, { rpmLimit: 5, allowedModels: "only/this" });
    const after = await repo.getApiKeyById(created.id);

    expect(after.rpmLimit).toBe(5);
    expect(after.allowedModels).toBe("only/this");
    // Untouched fields must survive the UPDATE.
    expect(after.tokenLimit).toBe(5_000_000);
    expect(after.usedTokens).toBe(1_234_567);
    expect(after.tpmLimit).toBe(90_000);
    expect(after.ipWhitelist).toBe("10.0.0.1,10.0.0.2");
    expect(after.resetInterval).toBe("daily");
  });
});
