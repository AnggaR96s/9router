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
    rpmLimit: row.rpmLimit || 0,
    tpmLimit: row.tpmLimit || 0,
    ipWhitelist: row.ipWhitelist || "",
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

/**
 * Canonical apiKeys column list, in table order — the single source that
 * builds both the INSERT column list AND its placeholder list.
 *
 * It exists because the two drifted: `exportDb` hand-picked 6 of the 14
 * columns, so a backup silently dropped tokenLimit / usedTokens /
 * resetInterval / lastResetAt / allowedModels / rpmLimit / tpmLimit /
 * ipWhitelist — every one of which the limiter reads. An export→import cycle
 * therefore reset a key's usage and erased its rate limits without any error.
 * Deriving the SQL from one array makes a column/placeholder mismatch
 * impossible to write rather than merely unlikely.
 *
 * Any column added to the apiKeys schema belongs here, and nowhere else.
 */
export const API_KEY_COLUMNS = Object.freeze([
  "id", "key", "name", "machineId", "isActive", "createdAt",
  "tokenLimit", "usedTokens", "resetInterval", "lastResetAt",
  "allowedModels", "rpmLimit", "tpmLimit", "ipWhitelist",
]);

/**
 * Full row → exportable object with EVERY column preserved.
 *
 * `isActive` is normalized to a boolean (matching the other exporters) and the
 * rest are passed through untouched, so a backup round-trips a key's limits
 * exactly. Deliberately has no field picking: a future column that gets added
 * to API_KEY_COLUMNS but forgotten here would be caught by the round-trip test,
 * whereas silent omission is what caused the original bug.
 */
export function apiKeyRowToExport(row) {
  if (!row) return null;
  const out = {};
  for (const col of API_KEY_COLUMNS) {
    out[col] = col === "isActive"
      ? (row.isActive === 1 || row.isActive === true)
      : row[col];
  }
  return out;
}

/**
 * Normalize one imported apiKey into column order, filling the same defaults
 * `createApiKey` uses so an imported key behaves identically to a created one.
 */
export function normalizeApiKeyForImport(source = {}) {
  const now = new Date().toISOString();
  return {
    id: source.id,
    key: source.key,
    name: source.name ?? null,
    machineId: source.machineId ?? null,
    isActive: source.isActive === false ? 0 : 1,
    createdAt: source.createdAt || now,
    tokenLimit: Number(source.tokenLimit) || 0,
    usedTokens: Number(source.usedTokens) || 0,
    resetInterval: source.resetInterval || "never",
    lastResetAt: source.lastResetAt || null,
    allowedModels: source.allowedModels || "*",
    rpmLimit: Number(source.rpmLimit) || 0,
    tpmLimit: Number(source.tpmLimit) || 0,
    ipWhitelist: typeof source.ipWhitelist === "string" ? source.ipWhitelist : "",
  };
}

/** INSERT built from API_KEY_COLUMNS — column list and placeholders cannot drift. */
export function buildApiKeyInsertSql() {
  const cols = API_KEY_COLUMNS.join(", ");
  const marks = API_KEY_COLUMNS.map(() => "?").join(", ");
  return `INSERT OR REPLACE INTO apiKeys(${cols}) VALUES(${marks})`;
}

/** Parameter list in the SAME order as the SQL above. */
export function apiKeyInsertValues(normalized) {
  return API_KEY_COLUMNS.map((col) => normalized[col]);
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
    rpmLimit: Number(options.rpmLimit) || 0,
    tpmLimit: Number(options.tpmLimit) || 0,
    ipWhitelist: options.ipWhitelist || "",
  };
  db.run(
    buildApiKeyInsertSql(),
    apiKeyInsertValues(normalizeApiKeyForImport(apiKey)),
  );
  return apiKey;
}

/** UPDATE built from API_KEY_COLUMNS (id is the WHERE key, not a SET column). */
export function buildApiKeyUpdateSql() {
  const sets = API_KEY_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = ?`).join(", ");
  return `UPDATE apiKeys SET ${sets} WHERE id = ?`;
}

/** Parameter list matching buildApiKeyUpdateSql(), id last for the WHERE. */
export function apiKeyUpdateValues(normalized) {
  return [
    ...API_KEY_COLUMNS.filter((c) => c !== "id").map((col) => normalized[col]),
    normalized.id,
  ];
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      buildApiKeyUpdateSql(),
      apiKeyUpdateValues(normalizeApiKeyForImport({ ...merged, id })),
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

// In-memory sliding window rate limiter state for RPM/TPM per API key
if (!global._apiKeyRateLimits) global._apiKeyRateLimits = {};
const rateLimits = global._apiKeyRateLimits;

function checkRateLimits(key, rpmLimit, tpmLimit) {
  if (rpmLimit <= 0 && tpmLimit <= 0) return true;
  const now = Date.now();
  if (!rateLimits[key]) {
    rateLimits[key] = [];
  }

  // Filter out events older than 60 seconds (1 minute window)
  rateLimits[key] = rateLimits[key].filter((req) => now - req.ts < 60000);
  const recent = rateLimits[key];

  if (rpmLimit > 0 && recent.length >= rpmLimit) {
    return "RPM_EXCEEDED";
  }

  if (tpmLimit > 0) {
    const totalTokensInWindow = recent.reduce((sum, r) => sum + (r.tokens || 0), 0);
    if (totalTokensInWindow >= tpmLimit) {
      return "TPM_EXCEEDED";
    }
  }

  return true;
}

export function recordApiKeyUsageInWindow(key, tokens = 0) {
  if (!key) return;
  const now = Date.now();
  if (!rateLimits[key]) rateLimits[key] = [];
  rateLimits[key].push({ ts: now, tokens: tokens || 0 });
}

export async function validateApiKey(key, requestedModel = null, clientIp = null) {
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

    // Check IP whitelist (empty = disabled/allow all)
    const ipWhitelist = (row.ipWhitelist || "").trim();
    if (ipWhitelist && clientIp) {
      const allowedIps = ipWhitelist.split(",").map((ip) => ip.trim()).filter(Boolean);
      if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
        result = "IP_NOT_ALLOWED";
        return;
      }
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

    // Check RPM & TPM rate limits
    const rpmLimit = Number(row.rpmLimit) || 0;
    const tpmLimit = Number(row.tpmLimit) || 0;
    const rateCheck = checkRateLimits(key, rpmLimit, tpmLimit);
    if (rateCheck !== true) {
      result = rateCheck;
      return;
    }

    result = true;
  });

  return result;
}
