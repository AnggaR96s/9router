import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { v4 as uuidv4 } from "uuid";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;

/**
 * Expand a provider filter to every stored representation that could match:
 * canonical id, alias(es), uiAlias, display name, plus the raw input itself
 * (covers custom ids like openai-compatible-chat-<uuid>). Case-insensitive on
 * both sides, so "Freebuff", "fb" and "Token Harbor" all resolve correctly.
 */
export function expandProviderFilter(input) {
  const raw = String(input == null ? "" : input).trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const values = new Set([raw]);
  for (const p of Object.values(AI_PROVIDERS)) {
    const keys = [p.id, p.alias, p.uiAlias, p.name, ...(p.aliases || [])]
      .filter(Boolean)
      .map((s) => String(s));
    if (keys.some((k) => k.toLowerCase() === lower)) {
      if (p.id) values.add(p.id);
      if (p.alias) values.add(p.alias);
      for (const a of p.aliases || []) values.add(a);
    }
  }
  return [...values];
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function truncateField(value, maxBytes) {
  if (value === null || value === undefined) return null;
  const json = typeof value === "string" ? value : JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return json;
  const truncated = json.slice(0, maxBytes);
  return `${truncated}…`;
}

export async function saveErrorLog(entry) {
  const db = await getAdapter();
  const id = entry.id || uuidv4();
  const timestamp = entry.timestamp || new Date().toISOString();
  const maxJsonSize = DEFAULT_MAX_JSON_SIZE;

  const record = {
    id,
    timestamp,
    endpoint: entry.endpoint || null,
    provider: entry.provider ? resolveProviderId(entry.provider) : null,
    model: entry.model || null,
    connectionId: entry.connectionId || null,
    comboName: entry.comboName || null,
    statusCode: entry.statusCode != null ? String(entry.statusCode) : null,
    errorMessage: typeof entry.errorMessage === "string" ? entry.errorMessage : (entry.errorMessage ? JSON.stringify(entry.errorMessage) : null),
    request: truncateField(entry.request, maxJsonSize),
    providerRequest: truncateField(entry.providerRequest, maxJsonSize),
    providerResponse: truncateField(entry.providerResponse, maxJsonSize),
    meta: stringifyJson({
      latency: entry.latency || {},
      tokens: entry.tokens || {},
      retryAfter: entry.retryAfter || null,
      retryAfterHuman: entry.retryAfterHuman || null,
      fallback: !!entry.fallback,
      fallbackReason: entry.fallbackReason || null,
      extra: entry.meta || {},
    }),
  };

  db.run(
    `INSERT INTO errorLogs(
      id, timestamp, endpoint, provider, model, connectionId, comboName,
      statusCode, errorMessage, request, providerRequest, providerResponse, meta
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      timestamp = excluded.timestamp,
      endpoint = excluded.endpoint,
      provider = excluded.provider,
      model = excluded.model,
      connectionId = excluded.connectionId,
      comboName = excluded.comboName,
      statusCode = excluded.statusCode,
      errorMessage = excluded.errorMessage,
      request = excluded.request,
      providerRequest = excluded.providerRequest,
      providerResponse = excluded.providerResponse,
      meta = excluded.meta`,
    [
      record.id, record.timestamp, record.endpoint, record.provider, record.model,
      record.connectionId, record.comboName, record.statusCode, record.errorMessage,
      record.request, record.providerRequest, record.providerResponse, record.meta,
    ]
  );

  // Prune old records.
  const cntRow = db.get(`SELECT COUNT(*) c FROM errorLogs`);
  const cnt = cntRow?.c || 0;
  if (cnt > DEFAULT_MAX_RECORDS) {
    db.run(
      `DELETE FROM errorLogs WHERE id IN (SELECT id FROM errorLogs ORDER BY timestamp ASC LIMIT ?)`,
      [cnt - DEFAULT_MAX_RECORDS]
    );
  }

  return id;
}

export async function getErrorLogs(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) {
    const expanded = expandProviderFilter(filter.provider);
    if (expanded.length > 0) {
      conds.push(`provider IN (${expanded.map(() => "?").join(",")})`);
      params.push(...expanded);
    } else {
      // Non-provider-looking filter (exact raw value still applied)
      conds.push("provider = ?");
      params.push(filter.provider);
    }
  }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.comboName) { conds.push("comboName = ?"); params.push(filter.comboName); }
  if (filter.statusCode) { conds.push("statusCode = ?"); params.push(String(filter.statusCode)); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const page = filter.page && filter.page > 0 ? filter.page : 1;
  const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 20;

  const cntRow = db.get(`SELECT COUNT(*) c FROM errorLogs ${where}`, params);
  const totalItems = cntRow?.c || 0;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  const rows = db.all(
    `SELECT * FROM errorLogs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  // Resolve connection display names (displayName || name || email) — one
  // batch lookup so the UI can show the account name next to the raw id
  // without N queries.
  const nameMap = await resolveConnectionNames(rows.map((r) => r.connectionId).filter(Boolean));

  const details = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    endpoint: r.endpoint,
    provider: r.provider,
    model: r.model,
    connectionId: r.connectionId,
    connectionName: r.connectionId ? (nameMap.get(r.connectionId) || null) : null,
    comboName: r.comboName,
    statusCode: r.statusCode,
    errorMessage: r.errorMessage,
    request: parseJson(r.request, null),
    providerRequest: parseJson(r.providerRequest, null),
    providerResponse: parseJson(r.providerResponse, null),
    meta: parseJson(r.meta, {}),
  }));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getErrorLogById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM errorLogs WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.timestamp,
    endpoint: row.endpoint,
    provider: row.provider,
    model: row.model,
    connectionId: row.connectionId,
    comboName: row.comboName,
    statusCode: row.statusCode,
    errorMessage: row.errorMessage,
    request: parseJson(row.request, null),
    providerRequest: parseJson(row.providerRequest, null),
    providerResponse: parseJson(row.providerResponse, null),
    meta: parseJson(row.meta, {}),
  };
}

export async function getDistinctErrorProviders() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM errorLogs WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((r) => r.provider);
}

/**
 * Batch-resolve connection display names for a set of connection ids.
 * Returns a Map<id, name> using displayName || name || email || null.
 * Unresolvable ids (deleted connections, combo ids, etc.) are absent.
 */
export async function resolveConnectionNames(ids) {
  const map = new Map();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  const db = await getAdapter();
  // providerConnections stores displayName/email/etc inside the data JSON,
  // while name is a top-level column — read both and derive the display name.
  try {
    const placeholders = unique.map(() => "?").join(",");
    const rows = db.all(
      `SELECT id, name, email, data FROM providerConnections WHERE id IN (${placeholders})`,
      unique
    );
    for (const row of rows) {
      const extra = parseJson(row.data, {});
      const displayName =
        extra.displayName || row.name || row.email || extra.githubLogin || extra.githubEmail || null;
      if (displayName) map.set(row.id, displayName);
    }
  } catch {
    // Fallback: no names resolvable — callers degrade to raw connectionId.
  }
  return map;
}

export async function clearErrorLogs() {
  const db = await getAdapter();
  const before = db.get(`SELECT COUNT(*) c FROM errorLogs`)?.c || 0;
  db.run(`DELETE FROM errorLogs`);
  // Reset the auto-increment sequence if the table uses one.
  try { db.run(`DELETE FROM sqlite_sequence WHERE name = 'errorLogs'`); } catch { /* no sequence table */ }
  return { deleted: before };
}
