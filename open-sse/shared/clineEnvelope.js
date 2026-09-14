import { PROVIDERS } from "../providers/index.js";

/**
 * Unwrap Cline's non-stream envelope: {"data":{...choices...}}.
 *
 * Scoped to providers opting in via `transport.quirks.clineEnvelope` so no other
 * provider's body is ever rewritten.
 *
 * The envelope is recognised by SHAPE, not by a `success` flag. Requiring
 * `success === true` was wrong: the body Cline actually returns for a buffered
 * (non-SSE) answer carries no `success` field at all — measured against the live
 * API, both `stream:false` and a request omitting `stream` answer
 * `{"data":{"choices":[...]}}` — so the old predicate never matched and callers
 * that relied on it forwarded the envelope verbatim. The error envelope
 * ({"success":false,"error":...}) has no `data.choices`, so it still passes
 * through untouched; requiring `choices` is what keeps the two apart.
 *
 * @param {object} body - Parsed upstream response body
 * @param {string} provider - Provider id or alias
 * @returns {object} The inner `data` object, or `body` unchanged
 */
export function unwrapClineEnvelope(body, provider) {
  if (!provider || !PROVIDERS[provider]?.quirks?.clineEnvelope) return body;
  const { data } = body || {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return body;
  // A success envelope always carries the completion under data.choices. Anything
  // else (notably data.error) is left alone for the normal error path to report.
  if (!Array.isArray(data.choices) && !data.usage) return body;
  return data;
}
