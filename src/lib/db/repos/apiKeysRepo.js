import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    tokenLimit: row.tokenLimit || 0,
    usedTokens: row.usedTokens || 0,
    resetInterval: row.resetInterval || "never",
    lastResetAt: row.lastResetAt || null,
    allowedModels: row.allowedModels || "*",
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const now = new Date().toISOString();
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: now,
    tokenLimit: Number(options.tokenLimit) || 0,
    usedTokens: Number(options.usedTokens) || 0,
    resetInterval: options.resetInterval || "never",
    lastResetAt: options.lastResetAt || now,
    allowedModels: options.allowedModels || "*",
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, tokenLimit, usedTokens, resetInterval, lastResetAt, allowedModels) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.createdAt,
      apiKey.tokenLimit,
      apiKey.usedTokens,
      apiKey.resetInterval,
      apiKey.lastResetAt,
      apiKey.allowedModels,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tokenLimit = ?, usedTokens = ?, resetInterval = ?, lastResetAt = ?, allowedModels = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        Number(merged.tokenLimit) || 0,
        Number(merged.usedTokens) || 0,
        merged.resetInterval || "never",
        merged.lastResetAt || null,
        merged.allowedModels || "*",
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key, requestedModel = null) {
  const db = await getAdapter();
  let result = false;

  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
    if (!row) {
      result = false;
      return;
    }
    if (row.isActive !== 1 && row.isActive !== true) {
      result = false;
      return;
    }

    const tokenLimit = Number(row.tokenLimit) || 0;
    let usedTokens = Number(row.usedTokens) || 0;
    const resetInterval = row.resetInterval || "never";
    const allowedModels = row.allowedModels || "*";
    const nowMs = Date.now();
    let lastResetMs = row.lastResetAt
      ? new Date(row.lastResetAt).getTime()
      : new Date(row.createdAt).getTime();

    if (isNaN(lastResetMs)) lastResetMs = nowMs;

    let shouldReset = false;
    if (resetInterval && resetInterval !== "never") {
      let intervalMs = 0;
      const num = parseInt(resetInterval, 10);
      if (resetInterval.endsWith("h")) {
        intervalMs = num * 60 * 60 * 1000;
      } else if (resetInterval.endsWith("d")) {
        intervalMs = num * 24 * 60 * 60 * 1000;
      }

      if (intervalMs > 0 && nowMs - lastResetMs >= intervalMs) {
        shouldReset = true;
        const periodsPassed = Math.floor((nowMs - lastResetMs) / intervalMs);
        lastResetMs = lastResetMs + periodsPassed * intervalMs;
      }
    }

    if (shouldReset) {
      usedTokens = 0;
      const newResetIso = new Date(lastResetMs).toISOString();
      db.run(`UPDATE apiKeys SET usedTokens = 0, lastResetAt = ? WHERE id = ?`, [
        newResetIso,
        row.id,
      ]);
    }

    if (tokenLimit > 0 && usedTokens >= tokenLimit) {
      result = "QUOTA_EXCEEDED";
      return;
    }

    // Check allowed models
    if (requestedModel && allowedModels && allowedModels.trim() !== "*" && allowedModels.trim() !== "") {
      const allowedList = allowedModels
        .split(",")
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean);

      const req = requestedModel.toLowerCase();
      const isAllowed = allowedList.some((allowed) => {
        if (allowed === "*" || allowed === req) return true;
        if (allowed.endsWith("*")) {
          const prefix = allowed.slice(0, -1);
          return req.startsWith(prefix);
        }
        if (allowed.startsWith("*")) {
          const suffix = allowed.slice(1);
          return req.endsWith(suffix);
        }
        return false;
      });

      if (!isAllowed) {
        result = "MODEL_NOT_ALLOWED";
        return;
      }
    }

    result = true;
  });

  return result;
}
