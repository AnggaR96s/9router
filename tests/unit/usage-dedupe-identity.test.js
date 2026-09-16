// The usage dedupe must be gated on a REQUEST IDENTITY, not only on content.
//
// saveRequestUsage() collapses a write when an existing usageHistory row already has
// the same timestamp|provider|model|connectionId|apiKey|promptTokens|completionTokens
// (usageRepo.js). That key cannot tell "the same request saved twice" apart from "two
// distinct requests that happen to share a millisecond and identical token counts" —
// the second request's usage is silently dropped. These tests pin the identity gate:
// distinct identities always count, a repeated identity still collapses, and callers
// that pass no identity keep the historical content-only behaviour.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-identity-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// One frozen millisecond on purpose: the dedupe key includes the exact timestamp.
const AT = "2026-09-16T12:00:00.000Z";

function usageEntry(overrides = {}) {
  return {
    provider: "openai",
    model: "gpt-4",
    connectionId: "c1",
    apiKey: "k1",
    tokens: { prompt_tokens: 10, completion_tokens: 5 },
    endpoint: "/v1/chat/completions",
    status: "ok",
    timestamp: AT,
    ...overrides,
  };
}

describe("usage dedupe is gated on the request identity", () => {
  it("keeps two distinct requests that share one millisecond", async () => {
    await db.saveRequestUsage(usageEntry({ requestId: "req-a" }));
    await db.saveRequestUsage(usageEntry({ requestId: "req-b" }));

    const hist = await db.getUsageHistory({ provider: "openai" });
    expect(hist.length).toBe(2);
  });

  it("still collapses the same request written twice", async () => {
    const entry = { requestId: "req-c", provider: "anthropic", model: "claude-sonnet-4" };
    await db.saveRequestUsage(usageEntry(entry));
    await db.saveRequestUsage(usageEntry(entry));

    const hist = await db.getUsageHistory({ provider: "anthropic" });
    expect(hist.length).toBe(1);
  });

  it("keeps content-only dedupe for callers that send no identity", async () => {
    await db.saveRequestUsage(usageEntry({ provider: "google", model: "gemini-2.5-pro" }));
    await db.saveRequestUsage(usageEntry({ provider: "google", model: "gemini-2.5-pro" }));

    const hist = await db.getUsageHistory({ provider: "google" });
    expect(hist.length).toBe(1);
  });
});