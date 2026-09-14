/**
 * Exact response cache for non-streaming requests.
 */

import crypto from "crypto";

const responseCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

function cacheKey(body, model, apiKey, variant) {
  if (!apiKey) return null;
  try {
    return crypto.createHash("sha256")
      .update(JSON.stringify({ apiKey, model, variant: variant || "", body }))
      .digest("hex");
  } catch {
    return null;
  }
}

export function checkSemanticCache(body, model, apiKey, variant) {
  if (!body || body.stream) return null;
  if (body.tool_choice && body.tool_choice !== "auto") return null;

  const hashKey = cacheKey(body, model, apiKey, variant);
  if (!hashKey) return null;

  const cached = responseCache.get(hashKey);
  if (cached && Date.now() < cached.expiresAt) {
    // Hand out a copy, not the stored object. The other half of the same
    // problem: a caller that edits the value it received (adding usage fields,
    // decloaking tool names, reshaping for the client) would otherwise be
    // writing into the shared entry, so the next caller on the same key would
    // read the previous caller's edits rather than the provider's answer.
    try {
      return structuredClone(cached.response);
    } catch {
      // Unclonable means unusable — drop it and report a miss rather than
      // returning a reference that can leak between callers.
      responseCache.delete(hashKey);
      return null;
    }
  }

  if (cached) responseCache.delete(hashKey);
  return null;
}

export function saveToSemanticCache(body, model, responseBody, apiKey, variant) {
  if (!body || body.stream || !responseBody) return;
  if (body.tool_choice && body.tool_choice !== "auto") return;
  if (responseBody.error || responseBody.is_error) return;

  const hashKey = cacheKey(body, model, apiKey, variant);
  if (!hashKey) return;

  // Deep-copy on the way in. The caller keeps using its own reference right after
  // this returns (it serialises the same object into the client response), so
  // storing it directly would leave the cache holding a live object that any
  // later mutation writes through — and because one entry is handed to every
  // caller that matches the key, a single downstream edit would corrupt the
  // cached answer for every subsequent hit until the TTL expires.
  //
  // Fail-open on failure: a body that cannot be cloned is simply not cached,
  // which is the same outcome as the cache being disabled and never a crash.
  let snapshot;
  try {
    snapshot = structuredClone(responseBody);
  } catch {
    return;
  }

  responseCache.set(hashKey, {
    response: snapshot,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  if (responseCache.size > 1000) {
    responseCache.delete(responseCache.keys().next().value);
  }
}
