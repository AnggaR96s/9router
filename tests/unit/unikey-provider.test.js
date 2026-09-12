// UniKey (getunikey.ai) provider — registry metadata + live model resolver.
//
// Verified live before writing these: /v1/models returns 401 without a key and 44
// models with one, and /v1/chat/completions answers 200 (model gpt-5.6-luna), so this
// is an apikey provider with a per-connection catalog — NOT a public/no-auth one.
// The relay is New-API based, which is why billing lives under
// /v1/dashboard/billing/* and reports usage in the OpenAI-compatible shape.

import { describe, expect, it, vi } from "vitest";

describe("UniKey provider registry", () => {
  it("is registered with a unique id and alias", async () => {
    const { default: registry } = await import("../../open-sse/providers/registry/index.js");
    const matches = registry.filter((p) => p.id === "unikey");
    expect(matches).toHaveLength(1);

    // Scope this to the provider we are adding. The registry has a pre-existing
    // duplicate id elsewhere (ollama-search is listed twice: p123 was inserted next to
    // the other search providers and never removed from its original slot), so a global
    // uniqueness assertion would fail for a reason unrelated to this provider. That
    // pre-existing duplicate is reported separately rather than masked here.
    const aliases = registry.filter((p) => p.alias === "unikey");
    expect(aliases).toHaveLength(1);
  });

  it("is an apikey provider pointing at the verified endpoints", async () => {
    const { default: unikey } = await import("../../open-sse/providers/registry/unikey.js");
    expect(unikey.category).toBe("apikey");
    expect(unikey.authModes).toEqual(["apikey"]);
    expect(unikey.transport.modelsUrl).toBe("https://www.getunikey.ai/v1/models");
    expect(unikey.transport.baseUrl).toBe("https://www.getunikey.ai/v1/chat/completions");
    expect(unikey.passthroughModels).toBe(true);
  });

  it("exposes a usage tracker (wallet spend + account limit)", async () => {
    const { default: unikey } = await import("../../open-sse/providers/registry/unikey.js");
    expect(unikey.features?.usage).toBe(true);
    expect(unikey.features?.usageApikey).toBe(true);
  });

  it("has an apiKeyUrl in its notice and a website", async () => {
    const { default: unikey } = await import("../../open-sse/providers/registry/unikey.js");
    expect(unikey.display.notice?.apiKeyUrl).toMatch(/^https:\/\//);
    expect(unikey.display.website).toMatch(/^https:\/\//);
  });
});

describe("UniKey model resolver", () => {
  it("parses the OpenAI-style { data: [...] } shape the relay returns", async () => {
    const { parseUnikeyModels } = await import("../../src/app/api/providers/[id]/models/unikey.js");
    const models = parseUnikeyModels({
      data: [
        { id: "gpt-5.6-luna", object: "model" },
        { id: "google/gemini-3.5-flash", object: "model" },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["gpt-5.6-luna", "google/gemini-3.5-flash"]);
  });

  it("tolerates a bare array, name-only entries and blank ids", async () => {
    const { parseUnikeyModels } = await import("../../src/app/api/providers/[id]/models/unikey.js");
    expect(parseUnikeyModels([{ name: "x-ai/grok-4.3" }])[0].id).toBe("x-ai/grok-4.3");
    expect(parseUnikeyModels({ data: [{ id: "  " }, null, { id: "ok" }] })).toHaveLength(1);
    expect(parseUnikeyModels(null)).toEqual([]);
  });

  it("carries context_length through when the relay sends it", async () => {
    const { parseUnikeyModels } = await import("../../src/app/api/providers/[id]/models/unikey.js");
    expect(parseUnikeyModels({ data: [{ id: "m", context_length: 128000 }] })[0].contextLength).toBe(128000);
  });

  it("refuses to call the API without a key", async () => {
    const { fetchUnikeyModels } = await import("../../src/app/api/providers/[id]/models/unikey.js");
    const spy = vi.fn();
    const result = await fetchUnikeyModels(null, spy);
    expect(result).toEqual({ error: "No valid API key found", status: 401 });
    expect(spy, "must not hit the network without a key").not.toHaveBeenCalled();
  });

  it("sends the key as a Bearer token and returns parsed models", async () => {
    const { fetchUnikeyModels } = await import("../../src/app/api/providers/[id]/models/unikey.js");
    const spy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-5.6-luna" }] }),
    }));
    const result = await fetchUnikeyModels("sk-test", spy);
    expect(spy.mock.calls[0][0]).toBe("https://www.getunikey.ai/v1/models");
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-test");
    expect(result.models).toHaveLength(1);
  });

  it("reports a non-ok response instead of pretending to have models", async () => {
    const { fetchUnikeyModels } = await import("../../src/app/api/providers/[id]/models/unikey.js");
    const spy = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const result = await fetchUnikeyModels("sk-bad", spy);
    expect(result.error).toContain("401");
    expect(result.models).toBeUndefined();
  });
});

describe("UniKey usage handler", () => {
  it("returns a message (not a throw) when no key is configured", async () => {
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage(null);
    expect(out.message).toMatch(/API key not available/i);
  });

  it("surfaces spend as an unlimited credit pot, not a 0% progress bar", async () => {
    // The relay's soft limit is effectively uncapped (1e8 USD on the verified account),
    // so a percentage bar would always read 0%. Spend is what the user wants to see.
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 0.3504 }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ object: "billing_subscription", has_payment_method: true, hard_limit_usd: 100000000 }),
      };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test");

    expect(out.quotas["Spent (USD)"]).toBeDefined();
    expect(out.quotas["Spent (USD)"].used).toBeCloseTo(0.3504, 6);
    expect(out.quotas["Spent (USD)"].unlimited).toBe(true);
    expect(out.quotas["Account limit (USD)"].total).toBe(100000000);
    vi.unstubAllGlobals();
  });

  it("reports auth failure on 401 instead of returning empty quotas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-bad");
    expect(out.message).toMatch(/authentication failed/i);
    vi.unstubAllGlobals();
  });
});
