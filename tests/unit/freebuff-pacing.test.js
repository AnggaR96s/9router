import { describe, expect, it, beforeEach } from "vitest";
import {
  acquireFreebuffRequestSlot,
  freebuffPacingRemainingMs,
  hashFreebuffToken,
} from "../../open-sse/shared/freebuffPacing.js";

describe("freebuff pacing", () => {
  beforeEach(() => {
    // Fresh registry per test (module-level globalThis state).
    delete globalThis.__9routerFreebuffPacing__;
  });

  it("allows the first request immediately", () => {
    expect(acquireFreebuffRequestSlot("token-a", 1_000)).toBe(true);
  });

  it("blocks a second request within the gap", () => {
    acquireFreebuffRequestSlot("token-a", 1_000);
    expect(acquireFreebuffRequestSlot("token-a", 1_000 + 10_000)).toBe(false);
    expect(freebuffPacingRemainingMs("token-a", 1_000 + 10_000)).toBeGreaterThan(0);
  });

  it("allows again after the gap elapsed", () => {
    acquireFreebuffRequestSlot("token-a", 1_000);
    // Default gap ~35s; jump past it.
    expect(acquireFreebuffRequestSlot("token-a", 1_000 + 40_000)).toBe(true);
  });

  it("tracks accounts independently", () => {
    acquireFreebuffRequestSlot("token-a", 1_000);
    expect(acquireFreebuffRequestSlot("token-b", 1_000)).toBe(true);
  });

  it("hashes tokens stably and never returns the raw token", () => {
    const h1 = hashFreebuffToken("secret-token-xyz");
    const h2 = hashFreebuffToken("secret-token-xyz");
    expect(h1).toBe(h2);
    expect(h1).not.toContain("secret");
    expect(hashFreebuffToken("")).toBe("");
  });
});