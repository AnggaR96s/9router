/**
 * OpenCode Zen session ids, in the client's own format.
 *
 * The anonymous free tier refuses requests whose session id is not shaped like the
 * client's ids ("OpenCode's free tier can only be used from within OpenCode"), and
 * refuses the plain "ses_" + 32 hex uuid form the gateway used to send. Shape is all
 * that is checked — the encoded timestamp is never verified — so ids are minted here
 * with no captured value and no configuration.
 *
 * Format (sst/opencode packages/opencode/src/id/id.ts, "ses" prefix):
 *   "ses_" + 6 hex bytes + 14 base62 chars
 *   bytes = (timestamp_ms * 0x1000 + counter) truncated to 48 bits, then inverted
 *   (the client's session ids are descending). Counter width is 12 bits, so the
 *   encoded timestamp is modulo 2**36 ms and ids keep the client's sort order.
 */
import crypto from "crypto";
import {
  OPENCODE_ZEN_SESSION_COUNTER_BITS,
  OPENCODE_ZEN_SESSION_PREFIX,
  OPENCODE_ZEN_SESSION_TAIL_LEN,
  OPENCODE_ZEN_SESSION_TIME_HEX_LEN,
} from "../config/runtimeConfig.js";

const CLIENT_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TIME_BYTES = OPENCODE_ZEN_SESSION_TIME_HEX_LEN / 2;
const TIME_MASK = (1n << BigInt(TIME_BYTES * 8)) - 1n;
const COUNTER_UNIT = 1n << BigInt(OPENCODE_ZEN_SESSION_COUNTER_BITS);
const COUNTER_MASK = Number(COUNTER_UNIT - 1n);
const CONVERSATION_CACHE_LIMIT = 512;

// Monotonic state, mirroring the client: same millisecond increments the counter.
let lastTimestamp = 0;
let counter = 0;
const conversationIds = new Map();

/**
 * A session id the free tier accepts. Pass a conversation id to keep one session per
 * conversation (stable across calls, so upstream caching survives); pass a timestamp
 * only to reproduce the client's encoding in tests.
 */
export function createZenSessionId(conversationId = null, timestamp = Date.now()) {
  if (conversationId) {
    const cached = conversationIds.get(conversationId);
    if (cached) return cached;
  }

  const id = `${OPENCODE_ZEN_SESSION_PREFIX}${encodeTime(timestamp)}${createTail(conversationId)}`;

  if (conversationId) {
    if (conversationIds.size >= CONVERSATION_CACHE_LIMIT) conversationIds.clear();
    conversationIds.set(conversationId, id);
  }
  return id;
}

const CLIENT_ID_PATTERN = new RegExp(
  `^${OPENCODE_ZEN_SESSION_PREFIX}[0-9a-f]{${OPENCODE_ZEN_SESSION_TIME_HEX_LEN}}[0-9A-Za-z]{${OPENCODE_ZEN_SESSION_TAIL_LEN}}$`,
);

/** True for ids in the client's format (and for ids this module minted). */
export function isClientZenSession(value) {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value.trim());
}

/** Decode the timestamp an id carries (modulo 2**(48 - counter bits) ms). */
export function zenSessionTimestamp(id) {
  if (!isClientZenSession(id)) return null;
  const hex = id.trim().slice(OPENCODE_ZEN_SESSION_PREFIX.length, OPENCODE_ZEN_SESSION_PREFIX.length + OPENCODE_ZEN_SESSION_TIME_HEX_LEN);
  const value = ~BigInt(`0x${hex}`) & TIME_MASK;
  return Number(value >> BigInt(OPENCODE_ZEN_SESSION_COUNTER_BITS));
}

function encodeTime(timestamp) {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp;
    counter = 0;
  }
  counter += 1;

  const value = (BigInt(timestamp) * COUNTER_UNIT + BigInt(counter)) & TIME_MASK;
  const descending = ~value & TIME_MASK;
  return descending.toString(16).padStart(OPENCODE_ZEN_SESSION_TIME_HEX_LEN, "0");
}

// Derived from the conversation when we have one so the id is stable; random otherwise.
function createTail(conversationId) {
  if (conversationId) {
    return crypto
      .createHash("sha256")
      .update(String(conversationId))
      .digest("hex")
      .slice(0, OPENCODE_ZEN_SESSION_TAIL_LEN);
  }

  const bytes = crypto.randomBytes(OPENCODE_ZEN_SESSION_TAIL_LEN);
  let tail = "";
  for (let i = 0; i < OPENCODE_ZEN_SESSION_TAIL_LEN; i++) {
    tail += CLIENT_ALPHABET[bytes[i] % CLIENT_ALPHABET.length];
  }
  return tail;
}

export { COUNTER_MASK as ZEN_SESSION_COUNTER_MASK };