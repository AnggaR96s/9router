/**
 * Groq usage — no dedicated quota endpoint. Rate-limit info instead rides on
 * every API response as x-ratelimit-* headers (requests + tokens, always
 * included).
 *
 * IMPORTANT: those headers only appear on inference responses
 * (POST /chat/completions), NOT on GET /models — a models list returns zero
 * x-ratelimit-* headers, which is why this used to report "no rate-limit data
 * reported for this key yet" forever.
 *
 * Reading usage therefore costs one minimal completion (max_tokens: 1). The
 * quota dashboard auto-refreshes every 60s, so a probe per refresh would burn
 * a free-tier RPD budget (1000/day) in under a day. Results are cached per key
 * for CACHE_TTL_MS, bounding real usage to a handful of requests per hour, and
 * a stale cache is preferred over burning quota when a probe fails.
 *
 * Headers:
 *   x-ratelimit-limit-requests / x-ratelimit-remaining-requests
 *   x-ratelimit-limit-tokens   / x-ratelimit-remaining-tokens
 *   x-ratelimit-reset-requests / x-ratelimit-reset-tokens (duration strings, e.g. "2m59.56s")
 *
 * Docs: https://console.groq.com/docs/rate-limits
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

const GROQ_USAGE = U("groq");
const COMPLETIONS_URL = GROQ_USAGE.url;
const MODELS_URL = GROQ_USAGE.modelsUrl;

// Quota rows change slowly; the dashboard polls every 60s.
const CACHE_TTL_MS = 15 * 60 * 1000;

// apiKey -> { quotas, at, model }
const _cache = new Map();
// apiKey -> { models, at } — chat-capable model ids for the probe
const _modelCache = new Map();

// Identify the cheapest/fastest model that accepts chat completions. Non-chat
// models (whisper, TTS, guard/safeguard classifiers) reject the probe.
const NON_CHAT_RE = /whisper|tts|orpheus|prompt-guard|safeguard/i;

// Groq reset headers are Go-style duration strings ("2m59.56s", "7.66s"), not
// timestamps — parse the h/m/s/ms components and add them to now().
function parseGroqDurationMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let match;
  let totalMs = 0;
  let matched = false;
  while ((match = re.exec(value))) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2];
    const unitMs = unit === "h" ? 3600000 : unit === "m" ? 60000 : unit === "ms" ? 1 : 1000;
    totalMs += amount * unitMs;
  }
  return matched ? totalMs : null;
}

function resetAtFromDuration(value) {
  const ms = parseGroqDurationMs(value);
  return ms === null ? null : new Date(Date.now() + ms).toISOString();
}

function buildRateLimitQuota(headers, limitKey, remainingKey, resetKey) {
  // headers.get() returns null when absent, and Number(null) is 0 (a finite
  // number) — check presence explicitly so a missing header can't masquerade
  // as a real "0 remaining" quota.
  const limitRaw = headers.get(limitKey);
  const remainingRaw = headers.get(remainingKey);
  if (limitRaw === null || remainingRaw === null) return null;

  const limit = Number(limitRaw);
  const remaining = Number(remainingRaw);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;

  return {
    used: Math.max(0, limit - remaining),
    total: limit,
    resetAt: resetAtFromDuration(headers.get(resetKey)),
    unlimited: false,
  };
}

function quotasFromHeaders(headers) {
  const requests = buildRateLimitQuota(
    headers,
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
  );
  const tokens = buildRateLimitQuota(
    headers,
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens",
  );
  if (!requests && !tokens) return null;

  const quotas = {};
  if (requests) quotas["Requests"] = requests;
  if (tokens) quotas["Tokens"] = tokens;
  return quotas;
}

/** Pick a chat-capable model id, cached so listing models isn't refetched. */
async function pickProbeModel(apiKey, proxyOptions) {
  const cached = _modelCache.get(apiKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.model;

  const response = await proxyAwareFetch(
    MODELS_URL,
    { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
    proxyOptions,
  );
  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  const ids = Array.isArray(data?.data) ? data.data.map((m) => m?.id).filter(Boolean) : [];
  const model = ids.find((id) => !NON_CHAT_RE.test(id));
  if (!model) return null;

  _modelCache.set(apiKey, { model, at: Date.now() });
  return model;
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getGroqUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Groq API key not available. Add a key to view usage." };
  }

  const key = apiKey.trim();
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { plan: "Groq", quotas: cached.quotas };
  }

  try {
    const model = await pickProbeModel(key, proxyOptions);
    if (!model) {
      // Model discovery failed (network/upstream) — never drop a good reading.
      if (cached) return { plan: "Groq", quotas: cached.quotas };
      return { plan: "Groq", message: "Groq connected. No chat-capable model available to read rate limits." };
    }

    // Minimal completion — Groq reports the rate-limit bucket only on
    // inference responses. max_tokens: 1 keeps the token cost negligible.
    const response = await proxyAwareFetch(
      COMPLETIONS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          stream: false,
        }),
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { plan: "Groq", message: "Groq authentication failed. Check the API key." };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      // A probe failure must not hide the last known good reading.
      if (cached) return { plan: "Groq", quotas: cached.quotas };
      return {
        plan: "Groq",
        message: `Groq usage API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    // The quota data lives in headers, not the body — drain it so the
    // connection can be released without needing the payload.
    await response.text().catch(() => {});

    const quotas = quotasFromHeaders(response.headers);

    if (!quotas) {
      // Key is valid (request succeeded) but no rate-limit bucket reported —
      // distinguish "not tracked yet" from an auth/error state.
      if (cached) return { plan: "Groq", quotas: cached.quotas };
      return {
        plan: "Groq",
        message: "Groq connected. No rate-limit data reported for this key yet.",
        quotas: {},
      };
    }

    _cache.set(key, { quotas, at: Date.now(), model });
    return { plan: "Groq", quotas };
  } catch (error) {
    if (cached) return { plan: "Groq", quotas: cached.quotas };
    return { message: `Groq error: ${error.message}` };
  }
}

/** Test seam: drop memoised probe results. */
export function __clearGroqUsageCache() {
  _cache.clear();
  _modelCache.clear();
}
