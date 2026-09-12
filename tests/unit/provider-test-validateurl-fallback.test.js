import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// testApiKeyConnection is not exported, so drive it through testSingleConnection and
// mock the DB + proxy layers it reaches for. The point of these cases is the generic
// validateUrl fallback: providers that had no bespoke `case` in the switch used to be
// answered with "Provider test not supported" even though the registry already knew
// their models endpoint.
//
// Note the shape of the returned object: testSingleConnection passes through only
// { valid, error, refreshed, latencyMs, testedAt }. A soft `warning` from the probe is
// not forwarded here — it lands in the DB as `lastError` while the connection stays
// "active", so warning assertions read updateProviderConnection's payload.
const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  // Must be an object, not null — the caller reads .connectionProxyEnabled off it.
  resolveConnectionProxyConfig: vi.fn(() => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
  })),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(async () => ({ ok: true })),
}));

const originalFetch = global.fetch;

function conn(provider, extra = {}) {
  return {
    id: "c1",
    provider,
    // testSingleConnection branches on authType: anything other than "apikey"/"cookie"
    // goes down the OAuth path, which is a different error entirely.
    authType: "apikey",
    apiKey: "sk-test-key",
    providerSpecificData: {},
    ...extra,
  };
}

async function testConnection(provider, extra) {
  mocks.getProviderConnectionById.mockResolvedValue(conn(provider, extra));
  vi.resetModules();
  const mod = await import("../../src/app/api/providers/[id]/test/testUtils.js");
  return mod.testSingleConnection("c1");
}

/** The payload written to the DB for the most recent call. */
function lastUpdate() {
  return mocks.updateProviderConnection.mock.calls.at(-1)?.[1] || {};
}

describe("provider test — generic validateUrl fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("tests a provider that has no bespoke case, using the registry validateUrl", async () => {
    // poolside is the reported case: valid key, working API, but no `case` in the
    // switch, so the dashboard showed "Provider test not supported".
    const urls = [];
    global.fetch = vi.fn(async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
    });

    const out = await testConnection("poolside");
    expect(urls[0]).toBe("https://inference.poolside.ai/v1/models");
    expect(out.valid).toBe(true);
    // The bespoke switch cases declined poolside; this proves the fallback ran.
    expect(out.error).not.toBe("Provider test not supported");
  });

  it("reports an invalid API key when the models endpoint refuses it", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 403, text: async () => "please check the api-key you provided", json: async () => ({}),
    }));

    const out = await testConnection("poolside");
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/invalid api key/i);
    expect(lastUpdate().testStatus).toBe("error");
  });

  it("flags a misconfigured validateUrl rather than passing it", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 404, text: async () => "not found", json: async () => ({}),
    }));

    const out = await testConnection("poolside");
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/not found/i);
  });

  it("still passes when the endpoint rate-limits us (key was not refused)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 429, text: async () => "slow down", json: async () => ({}),
    }));

    const out = await testConnection("bluesminds");
    expect(out.valid).toBe(true);
  });

  it("warns instead of passing cleanly when the provider serves models publicly", async () => {
    // venice, sambanova, kilo-gateway and api-airforce all answer 200 to a garbage key,
    // so a plain 200 proves nothing about the credential. The second (anonymous) probe
    // is what distinguishes an authenticated list from an open one.
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
    });

    const out = await testConnection("venice");
    expect(calls).toBe(2);
    expect(out.valid).toBe(true);
    // Stays active (reachable), but the caveat is recorded for the dashboard.
    expect(lastUpdate().testStatus).toBe("active");
    expect(lastUpdate().lastError).toMatch(/publicly/i);
  });

  it("does not warn when the list actually requires the key", async () => {
    // Authenticated probe passes, anonymous probe is refused -> the 200 did reflect the
    // key, so this is a clean pass with no caveat.
    global.fetch = vi.fn(async (url, opts) => {
      const hasAuth = JSON.stringify(opts?.headers || {}).includes("sk-test-key");
      if (hasAuth) return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
      return { ok: false, status: 401, text: async () => "no auth", json: async () => ({}) };
    });

    const out = await testConnection("morph");
    expect(out.valid).toBe(true);
    expect(lastUpdate().lastError).toBeNull();
  });

  it("sends the key as a bearer token on the authenticated probe", async () => {
    const seen = [];
    global.fetch = vi.fn(async (url, opts) => {
      seen.push(opts?.headers || {});
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
    });

    await testConnection("sambanova");
    expect(JSON.stringify(seen[0])).toContain("sk-test-key");
    // The anonymous probe must NOT carry it, or the public/private check is meaningless.
    expect(JSON.stringify(seen[1] || {})).not.toContain("sk-test-key");
  });

  it("still reports unsupported for a provider with no validateUrl", async () => {
    // Audio/image/search vendors expose no GET /models endpoint; guessing a probe
    // would report a good key as broken, so the explicit error is correct here.
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => "{}", json: async () => ({}),
    }));

    const out = await testConnection("elevenlabs");
    expect(out.valid).toBe(false);
    expect(out.error).toBe("Provider test not supported");
  });

  it("keeps the bespoke case for providers that have one", async () => {
    // openai has its own case; the fallback must not hijack it. Its case probes
    // api.openai.com rather than the registry validateUrl.
    const urls = [];
    global.fetch = vi.fn(async (url) => {
      urls.push(String(url));
      if (String(url).includes("api.openai.com")) {
        return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
      }
      return { ok: false, status: 500, text: async () => "unexpected probe", json: async () => ({}) };
    });

    const out = await testConnection("openai");
    expect(urls[0]).toContain("api.openai.com");
    expect(out.valid).toBe(true);
  });
});
