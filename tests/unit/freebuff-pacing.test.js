import { describe, expect, it, beforeEach } from "vitest";
import {
  acquireFreebuffRequestSlot,
  freebuffPacingRemainingMs,
  hashFreebuffToken,
  computeFreebuffWaitMs,
  getFreebuffPacingGapMs,
} from "../../open-sse/shared/freebuffPacing.js";

describe("freebuff pacing", () => {
  beforeEach(() => {
    // Fresh registry per test (module-level globalThis state).
    delete globalThis.__9routerFreebuffPacing__;
  });

  it("defaults to 20s gap", () => {
    expect(getFreebuffPacingGapMs()).toBe(20_000);
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
    // Default gap is 20s; jump past it.
    expect(acquireFreebuffRequestSlot("token-a", 1_000 + 25_000)).toBe(true);
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

describe("computeFreebuffWaitMs", () => {
  it("returns 0 when no retryAfter", () => {
    expect(computeFreebuffWaitMs(null, 5_000)).toBe(0);
  });

  it("returns 0 when the lock is already expired", () => {
    expect(computeFreebuffWaitMs(1_000, 5_000)).toBe(0);
  });

  it("returns the remaining wait when within the max", () => {
    expect(computeFreebuffWaitMs(15_000, 5_000)).toBe(10_000);
  });

  it("accepts an ISO string (auth.js retryAfter format)", () => {
    // auth.js returns getEarliestModelLockUntil() → ISO string of a future lock
    const iso = new Date(15_000).toISOString();
    expect(computeFreebuffWaitMs(iso, 5_000)).toBe(10_000);
  });

  it("accepts a Date object", () => {
    expect(computeFreebuffWaitMs(new Date(15_000), 5_000)).toBe(10_000);
  });

  it("returns 0 for an already-expired ISO string", () => {
    expect(computeFreebuffWaitMs(new Date(1_000).toISOString(), 5_000)).toBe(0);
  });

  it("returns 0 when the wait would exceed the max (fail fast)", () => {
    // retryAfter 45s − now 5s = 40s wait, above the 30s max → fail fast.
    expect(computeFreebuffWaitMs(45_000, 5_000)).toBe(0);
  });
});