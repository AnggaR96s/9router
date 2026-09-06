// Shared Freebuff request pacing registry — used by BOTH the executor (request
// gate) and the keeper (so both agree on the same per-account clock).
//
// An account that serves 25 requests in 9 minutes with 15–60s gaps (what
// preceded a real ban) is an anti-abuse signature. Pacing enforces a minimum
// idle gap between requests on the same Freebuff token: when the gap hasn't
// elapsed, the executor fails fast with 429 + resetsAtMs so account fallback
// rotates to another account instead of hammering the same one.
//
// All state lives on globalThis so Next dev (Turbopack) bundles share ONE copy
// (same pattern as the executor's freebuff fbState). Tokens are only ever
// hashed here — never stored, never logged.

const FB_PACING_KEY = "__9routerFreebuffPacing__";
// 20s min idle gap per account — closer to a human's natural cadence than the
// 35s we used before (which was tuned for multi-account farms). With
// single-account use the bounded wait in chat.js absorbs the remainder.
const DEFAULT_PACING_GAP_MS = 20 * 1000;
const DEFAULT_MAX_WAIT_MS = 30 * 1000;

function pacingState() {
  return (globalThis[FB_PACING_KEY] ??= {
    lastRequestAt: new Map(), // hashToken -> ms of the last accepted request
  });
}

// Stable short hash for an opaque token — never store/log the token itself.
export function hashFreebuffToken(token) {
  if (typeof token !== "string" || token.length === 0) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function getFreebuffPacingGapMs() {
  const env = Number(process.env.FREEBUFF_PACING_GAP_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_PACING_GAP_MS;
}

// Upper bound for the single-account bounded wait (chat.js). When every
// Freebuff account is pacing/model-locked and the earliest lock resolves
// within this window, the handler waits it out instead of failing the
// request with 429 — there is nobody to fall back to with one account.
export function getFreebuffMaxWaitMs() {
  const env = Number(process.env.FREEBUFF_MAX_WAIT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_WAIT_MS;
}

/**
 * How long the handler should wait before retrying the same account.
 * Returns 0 when there is nothing to wait for, the lock is already expired,
 * or the wait would exceed the bounded max (fail fast instead).
 */
export function computeFreebuffWaitMs(retryAfterMs, nowMs = Date.now()) {
  if (!retryAfterMs) return 0;
  const waitMs = retryAfterMs - nowMs;
  if (waitMs <= 0) return 0;
  const max = getFreebuffMaxWaitMs();
  return waitMs <= max ? waitMs : 0;
}

/** Milliseconds until the next allowed request for this token (0 = allowed now). */
export function freebuffPacingRemainingMs(token, nowMs = Date.now()) {
  const key = hashFreebuffToken(token);
  if (!key) return 0;
  const last = pacingState().lastRequestAt.get(key) || 0;
  if (!last) return 0; // never called before — allowed immediately
  const gap = getFreebuffPacingGapMs();
  return Math.max(0, gap - (nowMs - last));
}

/**
 * Try to acquire the request slot for this token. Returns true (and records
 * the timestamp) when the pacing gap has elapsed; false when the caller
 * should back off until freebuffPacingRemainingMs().
 */
export function acquireFreebuffRequestSlot(token, nowMs = Date.now()) {
  const remaining = freebuffPacingRemainingMs(token, nowMs);
  if (remaining > 0) return false;
  pacingState().lastRequestAt.set(hashFreebuffToken(token), nowMs);
  return true;
}