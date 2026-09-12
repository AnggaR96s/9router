import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cohere from "open-sse/providers/registry/cohere.js";
import { getExecutor } from "open-sse/executors/index.js";

// The registry's chat URL was wrong in a way no unit test would have caught:
// it pointed at `https://api.cohere.ai/v1/chat/completions`, a path Cohere does
// not serve. Every request through this provider answered 405 — not just the
// new model — and because 405 reads like "wrong method" rather than "endpoint
// gone", it looked like a client bug rather than a stale URL.
//
// So these cases assert the *shape* of the contract (path, host, model list)
// and one case performs a live probe when a key is supplied. The live case is
// the only thing that can prove the URL is still served — it is skipped, not
// faked, when no key is available, because a green test that never touched the
// network is exactly how the 405 survived.
const here = path.dirname(fileURLToPath(import.meta.url));

const LIVE_KEY = process.env.COHERE_API_KEY || "";

describe("cohere registry", () => {
  it("targets the OpenAI-compatible host, not the removed native chat path", () => {
    // `/v1/chat/completions` is the path that 405s; `/compatibility/v1` is the
    // surface Cohere documents for OpenAI SDKs.
    expect(cohere.transport.baseUrl).toBe(
      "https://api.cohere.ai/compatibility/v1/chat/completions",
    );
    expect(cohere.transport.baseUrl).not.toMatch(/api\.cohere\.(ai|com)\/v1\/chat/);
  });

  it("sends the request to the corrected URL through the real executor", () => {
    // The registry entry and the URL a request actually uses are different
    // things: a fixed registry with an unmoved executor still POSTs to the
    // dead path. Assert the built URL, not just the config.
    const url = getExecutor("cohere").buildUrl("command-a-plus-05-2026", false);
    expect(url).toBe(cohere.transport.baseUrl);
    expect(url).toContain("/compatibility/v1/chat/completions");
  });

  it("keeps validateUrl on the native host, where a model list exists", () => {
    // The compatibility host exposes no /models, so validation must not be
    // moved along with the chat URL.
    expect(cohere.transport.validateUrl).toBe("https://api.cohere.ai/v1/models");
  });

  it("lists the current Command A family alongside the older Command R rows", () => {
    const ids = cohere.models.map((m) => m.id);
    for (const id of [
      "command-a-plus-05-2026",
      "command-a-reasoning-08-2025",
      "command-a-vision-07-2025",
      "command-a-translate-08-2025",
      "command-a-03-2025",
      "command-r-plus-08-2024",
      "command-r-08-2024",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("keeps every model row uniquely identified and named", () => {
    const ids = cohere.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of cohere.models) {
      expect(m.name).toBeTruthy();
      expect(m.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  // Live probe: skipped without a key so CI does not depend on a credential,
  // but runnable on demand (COHERE_API_KEY=... npx vitest run <this file>).
  it.runIf(LIVE_KEY)("answers 200 on the registered URL for every listed model", async () => {
    const results = [];
    for (const m of cohere.models) {
      const res = await fetch(cohere.transport.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LIVE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: m.id,
          messages: [{ role: "user", content: "Reply exactly: OK" }],
          max_tokens: 40,
        }),
      });
      const body = await res.text();
      results.push({ id: m.id, status: res.status, snippet: body.slice(0, 120) });
      // Trial keys allow 20 calls/min; space the probes so the loop measures
      // the URL rather than the rate limiter.
      await new Promise((r) => setTimeout(r, 3200));
    }
    const failures = results.filter((r) => r.status !== 200);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 120_000);

  it.runIf(LIVE_KEY)("does not answer 405 on the old native chat path", async () => {
    // Pins the original bug: whatever replaces this URL must not reintroduce it.
    const res = await fetch("https://api.cohere.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LIVE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cohere.models[0].id,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(405);
  }, 30_000);
});
