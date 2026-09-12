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

  it("converts spend from USD to credits at 100x (verified against the dashboard)", async () => {
    // The dashboard showed 24h usage of 6.58 credits while the API reported
    // total_usage 0.0658, so the relay bills in USD and displays credits at x100.
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 0.0658 }) };
      }
      return { ok: true, status: 200, json: async () => ({ object: "billing_subscription", has_payment_method: true }) };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test");

    expect(out.quotas.Credits.used).toBeCloseTo(6.58, 6);
    vi.unstubAllGlobals();
  });

  it("computes Remaining as grant minus spend, defaulting the grant to 5000", async () => {
    // UniKey's standard free grant. Verified against the account: 5000 - 4843.64 spent
    // = 156.36, which is exactly the remaining balance the relay itself quoted.
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 48.4364 }) };
      }
      return { ok: true, status: 200, json: async () => ({ object: "billing_subscription", has_payment_method: true }) };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test");

    expect(out.quotas.Credits.total).toBe(5000);
    expect(out.quotas.Credits.used).toBeCloseTo(4843.64, 2);
    expect(out.quotas.Credits.remaining).toBeCloseTo(156.36, 2);
    expect(Object.keys(out.quotas)).toEqual(["Credits"]);
    vi.unstubAllGlobals();
  });

  it("returns no explanatory message on a normal computed response", async () => {
    // An earlier revision appended a "set unikeyTotalCredits / unikeyProbeBalance"
    // note to every computed response. The dashboard renders `message` as a standing
    // notice under the connection, so it appeared on every refresh reading like a
    // fault even when the numbers were right. Keep normal responses message-free.
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 0.368 }) };
      }
      return { ok: true, status: 200, json: async () => ({ object: "billing_subscription", has_payment_method: true }) };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test");

    expect(out.message).toBeUndefined();
    expect(out.quotas.Credits.remaining).toBeCloseTo(4963.2, 2);
    vi.unstubAllGlobals();
  });

  it("honours a configured grant override", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 10 }) };
      }
      return { ok: true, status: 200, json: async () => ({ object: "billing_subscription", has_payment_method: true }) };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test", { unikeyTotalCredits: 20000 });

    expect(out.quotas.Credits.total).toBe(20000);
    expect(out.quotas.Credits.remaining).toBeCloseTo(19000, 2);
    vi.unstubAllGlobals();
  });

  it("never reports a negative balance when spend exceeds the grant", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 9999 }) };
      }
      return { ok: true, status: 200, json: async () => ({ object: "billing_subscription", has_payment_method: true }) };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test");

    expect(out.quotas.Credits.remaining).toBe(0);
    expect(out.quotas.Credits.remainingPercentage).toBe(0);
    vi.unstubAllGlobals();
  });

  it("reads the exact balance out of a pre-charge rejection message", async () => {
    // The relay refuses the call and names the remaining amount. Matching both the
    // Chinese original and an English variant keeps a locale change from silently
    // breaking the read.
    const { parseRemainingFromError } = await import("../../open-sse/services/usage/unikey.js");
    expect(parseRemainingFromError(
      "预扣费额度失败, 用户剩余额度: Credits156.360000, 需要预扣费额度: Credits2500.000000",
    )).toBeCloseTo(156.36, 2);
    expect(parseRemainingFromError(
      "pre-charge failed, user remaining quota: Credits 42.5, required: Credits 2500",
    )).toBeCloseTo(42.5, 2);
    expect(parseRemainingFromError("model not found")).toBeNull();
    expect(parseRemainingFromError(null)).toBeNull();
    expect(parseRemainingFromError("")).toBeNull();
  });

  it("only probes the relay when the connection opts in", async () => {
    const { shouldProbeBalance } = await import("../../open-sse/services/usage/unikey.js");
    expect(shouldProbeBalance({})).toBe(false);
    expect(shouldProbeBalance(null)).toBe(false);
    expect(shouldProbeBalance({ unikeyProbeBalance: false })).toBe(false);
    expect(shouldProbeBalance({ unikeyProbeBalance: true })).toBe(true);
  });

  it("uses the probed balance when probing is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/chat/completions")) {
        // The deliberate rejection we read the balance from. Nothing is billed.
        return {
          ok: false, status: 403, text: async () => JSON.stringify({
            error: { message: "预扣费额度失败, 用户剩余额度: Credits777.250000, 需要预扣费额度: Credits2500.000000" },
          }),
        };
      }
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 48.4364 }) };
      }
      return { ok: true, status: 200, json: async () => ({ object: "billing_subscription", has_payment_method: true }) };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test", { unikeyProbeBalance: true });

    // Probed value wins over the arithmetic (which would have said 156.36).
    expect(out.quotas.Credits.remaining).toBeCloseTo(777.25, 2);
    vi.unstubAllGlobals();
  });

  it("falls back to the computed balance when the probe yields nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/chat/completions")) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "model not found" } }) };
      }
      if (String(url).endsWith("/usage")) {
        return { ok: true, status: 200, json: async () => ({ object: "list", total_usage: 48.4364 }) };
      }
      return { ok: true, status: 200, json: async () => ({ object: "billing_subscription", has_payment_method: true }) };
    }));
    vi.resetModules();
    const { getUnikeyUsage } = await import("../../open-sse/services/usage/unikey.js");
    const out = await getUnikeyUsage("sk-test", { unikeyProbeBalance: true });

    expect(out.quotas.Credits.remaining).toBeCloseTo(156.36, 2);
    vi.unstubAllGlobals();
  });

  it("accepts the configured total as a numeric string and rejects junk", async () => {
    const { parseConfiguredTotalCredits } = await import("../../open-sse/services/usage/unikey.js");
    expect(parseConfiguredTotalCredits({ unikeyTotalCredits: "10000" })).toBe(10000);
    expect(parseConfiguredTotalCredits({ unikeyTotalCredits: 10000 })).toBe(10000);
    // Anything unusable falls back to the standard grant rather than zero.
    expect(parseConfiguredTotalCredits({ unikeyTotalCredits: "" })).toBe(5000);
    expect(parseConfiguredTotalCredits({ unikeyTotalCredits: "abc" })).toBe(5000);
    expect(parseConfiguredTotalCredits({ unikeyTotalCredits: 0 })).toBe(5000);
    expect(parseConfiguredTotalCredits({})).toBe(5000);
    expect(parseConfiguredTotalCredits(null)).toBe(5000);
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

describe("UniKey static model catalog", () => {
  it("ships only chat-capable ids (the non-chat ones reject this endpoint)", async () => {
    // /v1/models advertises 44 ids, but 12 of them are image/video/embedding models
    // that answer POST /v1/chat/completions with 400 ("is a video generation model",
    // "does not support this endpoint"), so they are deliberately excluded.
    const { default: unikey } = await import("../../open-sse/providers/registry/unikey.js");
    expect(unikey.models.length).toBe(32);

    const ids = unikey.models.map((m) => m.id);
    expect(new Set(ids).size, "duplicate ids in the static list").toBe(ids.length);

    const nonChat = ids.filter((id) => /kling|seedance|seedream|gpt-image|bge-m3|hailuo|qwen-image|grok-imagine|gemini-3\.1-flash-image/.test(id));
    expect(nonChat, "image/video/embedding ids cannot serve chat").toEqual([]);

    expect(ids).toContain("gpt-5.6-luna");
    expect(ids).toContain("claude-opus-4-8");
    expect(ids).toContain("x-ai/grok-4.3");
    expect(ids).toContain("google/gemini-3.5-flash");
  });

  it("gives every model a display name", async () => {
    const { default: unikey } = await import("../../open-sse/providers/registry/unikey.js");
    const nameless = unikey.models.filter((m) => !m.name || !String(m.name).trim());
    expect(nameless.map((m) => m.id)).toEqual([]);
  });

  it("keeps the static list registered into PROVIDER_MODELS", async () => {
    const { PROVIDER_MODELS } = await import("../../open-sse/providers/index.js");
    expect(Array.isArray(PROVIDER_MODELS.unikey)).toBe(true);
    expect(PROVIDER_MODELS.unikey.length).toBe(32);
  });
});

describe("UniKey usage wiring", () => {
  it("passes providerSpecificData through so the optional total can be read", async () => {
    // Without this argument the configured total would be invisible to the handler
    // and Remaining could never be shown.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("/home/ubuntu/9router/open-sse/services/usage.js", "utf8");
    expect(src).toMatch(/unikey:\s*\(c\)\s*=>\s*getUnikeyUsage\(c\.apiKey,\s*c\.providerSpecificData/);
  });
});

