// Guards the two providers the dashboard reported as "Provider test not supported":
// `ollama-search` (webSearch) and `jina-reader` (webFetch).
//
// Neither could be served by the generic validateUrl fallback, and for opposite reasons:
//
//  - `ollama-search` HAS a config the fallback could have used, but no `validateUrl`, and
//    the URL it would need is POST-only. The obvious candidate, `https://ollama.com/api/tags`,
//    is served publicly — a bogus key returns the full model list with HTTP 200 — so probing
//    it would report a dead key as healthy. The search endpoint is the only one that reads
//    the credential (verified live: 200 with a valid key, 401 without one).
//  - `jina-reader`'s fetch endpoint is the whole service (`https://r.jina.ai`), whose root
//    doubles as an auth check: a valid key and no key both answer 200 because anonymous
//    reads are allowed, but a bogus key answers 401 AuthenticationFailedError, so the key is
//    genuinely inspected.
//
// Both therefore need a bespoke case. These tests drive testSingleConnection (the export the
// API route uses) with fetch mocked, so they run without network access and without touching
// the operator's database.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
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
    authType: "apikey",
    apiKey: "test-key",
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

describe("provider test — ollama-search (webSearch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("no longer answers 'Provider test not supported'", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const out = await testConnection("ollama-search");
    expect(out.error).not.toBe("Provider test not supported");
    expect(out.valid).toBe(true);
  });

  it("probes the search endpoint, which is the only one that reads the key", async () => {
    // /api/tags is public, so a probe there passes on any key. Asserting the URL keeps
    // that shortcut from creeping back in.
    let called = null;
    global.fetch = vi.fn(async (url, opts) => {
      called = { url: String(url), opts };
      return { ok: true, status: 200 };
    });
    await testConnection("ollama-search");

    expect(called.url).toBe("https://ollama.com/api/web_search");
    expect(called.opts.method).toBe("POST");
    expect(called.opts.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(called.opts.body)).toMatchObject({ query: expect.any(String) });
  });

  it("rejects a key the search endpoint refuses", async () => {
    // The whole point: a bad key must fail. Against /api/tags this returned 200.
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    const out = await testConnection("ollama-search");
    expect(out.valid).toBe(false);
    expect(out.error).toBe("Invalid API key");
  });

  it("treats a rate-limit as reachable rather than as a bad key", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 429 }));
    const out = await testConnection("ollama-search");
    expect(out.valid).toBe(true);
    expect(out.error).toBeNull();
  });
});

describe("provider test — jina-reader (webFetch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("no longer answers 'Provider test not supported'", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const out = await testConnection("jina-reader");
    expect(out.error).not.toBe("Provider test not supported");
    expect(out.valid).toBe(true);
  });

  it("sends the key to the service root rather than fetching a real page", async () => {
    // Probing an actual URL would work but spends a fetch per test; the root is free.
    let called = null;
    global.fetch = vi.fn(async (url, opts) => {
      called = { url: String(url), opts };
      return { ok: true, status: 200 };
    });
    await testConnection("jina-reader");

    expect(called.url).toBe("https://r.jina.ai/");
    expect(called.opts.headers.Authorization).toBe("Bearer test-key");
  });

  it("rejects a key the service refuses", async () => {
    // Anonymous reads are allowed (200 without a key), so only a refused key proves the
    // check is real — that is the case this asserts.
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    const out = await testConnection("jina-reader");
    expect(out.valid).toBe(false);
    expect(out.error).toBe("Invalid API key");
  });

  it("stays valid when the service answers without a key, since anonymous reads are allowed", async () => {
    // Documents the deliberate asymmetry: a 200 here is not proof of the key, only that
    // the service is reachable and did not refuse it.
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const out = await testConnection("jina-reader", { apiKey: "" });
    expect(out.valid).toBe(true);
  });
});