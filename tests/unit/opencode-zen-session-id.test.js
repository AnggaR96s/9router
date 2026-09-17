/**
 * The gateway mints session ids in the client's own format, so the free tier accepts
 * them without any captured value.
 *
 * Format (sst/opencode packages/opencode/src/id/id.ts):
 *   "ses_" + 6 hex bytes + 14 base62 chars
 *   bytes = (timestamp_ms * 0x1000 + counter) truncated to 48 bits, inverted for
 *   descending ids. The 48-bit window means the encoded time is modulo 2**36 ms,
 *   which is the property asserted below.
 */
import { describe, expect, it } from "vitest";
import {
  createZenSessionId,
  isClientZenSession,
  zenSessionTimestamp,
} from "../../open-sse/utils/zenSession.js";
import { OPENCODE_USER_AGENT } from "../../open-sse/config/runtimeConfig.js";

const ZEN_ID = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const WINDOW_MS = 2 ** 36;

describe("OpenCode Zen session id generator", () => {
  it("ships a versioned client User-Agent", () => {
    expect(OPENCODE_USER_AGENT).toMatch(/^opencode\/\d+\.\d+\.\d+$/);
  });

  it("builds ids in the client's format", () => {
    const id = createZenSessionId();
    expect(id).toMatch(ZEN_ID);
    expect(id).toHaveLength(30);
    expect(id.startsWith("ses_")).toBe(true);
    for (const char of id.slice(16)) expect(B62).toContain(char);
  });

  it("encodes the timestamp the same way the client does", () => {
    for (const ts of [1789609016274, 1789609016274 + 3_600_000, 0]) {
      expect(zenSessionTimestamp(createZenSessionId(null, ts))).toBe(ts % WINDOW_MS);
    }
  });

  it("counts ids created in the same millisecond", () => {
    const ts = 1789609016274;
    const first = createZenSessionId(null, ts);
    const second = createZenSessionId(null, ts);
    expect(second).not.toBe(first);
    expect(zenSessionTimestamp(second)).toBe(zenSessionTimestamp(first));
    const counter = (id) => (~parseInt(id.slice(4, 16), 16)) & 0xfff;
    expect(counter(second) - counter(first)).toBe(1);
  });

  it("is stable per conversation so upstream caching survives", () => {
    const id = createZenSessionId("ses_9f1c4d2ae5b74618a3c0ff21de5b7a44");
    expect(createZenSessionId("ses_9f1c4d2ae5b74618a3c0ff21de5b7a44")).toBe(id);
    expect(createZenSessionId("ses_4d0a71c9ffbe41d6b28e5c7a9013fd2b")).not.toBe(id);
  });

  it("never repeats an id", () => {
    const seen = new Set(Array.from({ length: 300 }, () => createZenSessionId()));
    expect(seen.size).toBe(300);
  });

  it("recognises client-format ids only", () => {
    expect(isClientZenSession("ses_f533881baffelq5BDFCY3Pqsag")).toBe(true);
    expect(isClientZenSession(" ses_f533881baffelq5BDFCY3Pqsag ")).toBe(true);
    expect(isClientZenSession(createZenSessionId())).toBe(true);
    expect(isClientZenSession("ses_" + "0".repeat(32))).toBe(false);
    expect(isClientZenSession("ses_f533881baffelq5BDFCY3Pqsa")).toBe(false);
    expect(isClientZenSession("ses_F533881BAFFElq5BDFCY3Pqsag")).toBe(false);
    expect(isClientZenSession("")).toBe(false);
  });
});
