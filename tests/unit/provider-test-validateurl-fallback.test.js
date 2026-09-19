import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PROVIDERS } from "open-sse/config/providers.js";

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

const MODELS_CATALOG = JSON.stringify({ data: [{ id: "probe-model-1" }] });
/** A keyed /models answer that carries a catalog, so the chat probe has a model to use. */
function modelsOk() {
  return { ok: true, status: 200, text: async () => MODELS_CATALOG, json: async () => ({ data: [{ id: "probe-model-1" }] }) };
}
function refuse(status, body) {
  return { ok: false, status, text: async () => body, json: async () => ({}) };
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
    // Reachable, but the 429 means the key was never examined: record the caveat rather
    // than reporting a verification the probe did not perform.
    expect(lastUpdate().lastError).toMatch(/429|could not be verified/i);
  });

  it("warns instead of passing cleanly when the provider serves models publicly", async () => {
    // venice, sambanova, kilo-gateway and api-airforce all answer 200 to a garbage key,
    // so a plain 200 proves nothing about the credential. The second (anonymous) probe
    // is what distinguishes an authenticated list from an open one.
    // The chat probe now follows, and here it cannot settle anything either (404 = our
    // model guess, not a refused key), so the caveat must survive.
    let calls = 0;
    global.fetch = vi.fn(async (url) => {
      calls++;
      if (String(url).includes("/models")) return modelsOk();
      return refuse(404, '{"error":"please check the model you provided"}');
    });

    const out = await testConnection("venice");
    expect(calls).toBe(3);
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

  it("sends a User-Agent that WAFs do not blanket-block", async () => {
    // Node's fetch (undici) sends `User-Agent: node`, and Cloudflare-fronted providers
    // answer it with 404 "Gone." BEFORE looking at the credential — measured on
    // featherless: UA=node/undici -> 404 (key or no key), any other UA -> 401/200.
    // A probe that inherits that default reports "Models endpoint not found" for a
    // perfectly good key, so every probe must carry an explicit UA.
    const seen = [];
    global.fetch = vi.fn(async (url, opts) => {
      seen.push(opts?.headers || {});
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
    });

    await testConnection("poolside");
    expect(seen.length).toBeGreaterThan(0);
    for (const headers of seen) {
      const ua = headers["User-Agent"] || headers["user-agent"];
      expect(ua, `probe headers were ${JSON.stringify(headers)}`).toBeTruthy();
      expect(String(ua)).not.toMatch(/^(node|undici)$/i);
    }
  });

  it("reuses the registry's declared fingerprint headers on the probe", async () => {
    // The registry is the single source of truth for how traffic must look, so the probe
    // has to carry the same product headers the inference path sends — otherwise a test
    // can fail where real traffic succeeds. api-airforce declares HTTP-Referer/X-Title
    // (the OpenRouter-style pair upstreams gate on) and has no bespoke case.
    const declared = PROVIDERS["api-airforce"].headers || {};
    expect(Object.keys(declared).length, "api-airforce must declare headers").toBeGreaterThan(0);

    const seen = [];
    global.fetch = vi.fn(async (url, opts) => {
      seen.push(opts?.headers || {});
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
    });

    await testConnection("api-airforce");
    for (const [name, value] of Object.entries(declared)) {
      expect(seen[0][name], `probe dropped the declared header ${name}`).toBe(value);
    }
  });

  it("uses a User-Agent the upstream will not blanket-block", async () => {
    // Same trap as above, from the other side: the registry fingerprint must never be
    // just `node`/`undici`, because that is exactly what gets refused before auth.
    const seen = [];
    global.fetch = vi.fn(async (url, opts) => {
      seen.push(opts?.headers || {});
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
    });

    await testConnection("featherless");
    expect(seen[0]["User-Agent"]).toBeTruthy();
    expect(String(seen[0]["User-Agent"])).not.toMatch(/^(node|undici)$/i);
  });

  it("does not pass cleanly when the endpoint accepts any bearer token", async () => {
    // morph answers 200 to a garbage bearer but 401 to no Authorization header at all,
    // so the anonymous probe cannot tell a valid key from an invented one. The third
    // probe (deliberately invalid token) is what exposes it.
    const seenTokens = [];
    global.fetch = vi.fn(async (url, opts) => {
      const auth = opts?.headers?.["Authorization"] || "";
      seenTokens.push(auth);
      // The chat probe cannot settle it either in this scenario, so the caveat must stay.
      if (!String(url).includes("/models")) return refuse(429, "slow down");
      if (!auth) return refuse(401, "no auth");
      return modelsOk();
    });

    const out = await testConnection("morph");
    expect(out.valid).toBe(true);
    // The invented token must be obviously not-the-key, or the verdict is meaningless.
    const bogus = seenTokens.find((t) => t && !t.includes("sk-test-key"));
    expect(bogus).toBeTruthy();
    // ...and it has to be KEY-SHAPED. morph checks the `sk-…` prefix and refuses a bare
    // word with 401 whatever it says, so a shapeless sentinel would exercise the format
    // check instead of the value check and hand back a false clean pass (measured).
    expect(bogus).toMatch(/^Bearer sk-/);
    expect(lastUpdate().testStatus).toBe("active");
    expect(lastUpdate().lastError).toMatch(/could not be verified|not verified|unverified/i);
  });

  it("records a rate-limited probe as unverified instead of a clean pass", async () => {
    // baidu answers 403 to a garbage key, but 429 "Over rate limit" when the endpoint has
    // been hit a few times — and a 429 used to fall straight through to `{valid:true,
    // error:null}`. That is a clean pass for a key the endpoint never looked at, i.e. the
    // same false green the other branches guard against. Reachable is still true; the
    // verdict has to say what it could not establish.
    global.fetch = vi.fn(async () => ({
      ok: false, status: 429, text: async () => "{\"code\":\"OverRateLimit\"}", json: async () => ({}),
    }));

    const out = await testConnection("baidu");
    expect(out.valid).toBe(true);
    expect(lastUpdate().testStatus).toBe("active");
    expect(lastUpdate().lastError).toMatch(/429|rate|unverified|could not be verified/i);
  });

  it("does not call it verified when the anonymous probe is inconclusive", async () => {
    // Keyed 200 followed by an anonymous 429 proves nothing about the value: the endpoint
    // never got far enough to answer. Reporting a clean pass here would be a guess.
    global.fetch = vi.fn(async (url, opts) => {
      const auth = opts?.headers?.["Authorization"] || "";
      if (auth.includes("sk-test-key")) {
        return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
      }
      return { ok: false, status: 429, text: async () => "slow down", json: async () => ({}) };
    });

    const out = await testConnection("sambanova");
    expect(out.valid).toBe(true);
    expect(lastUpdate().lastError).toMatch(/429|rate|unverified|could not be verified/i);
  });

  it("does not call it verified when the invalid-key probe is inconclusive", async () => {
    // Keyed 200 + anonymously refused gets us close, but the third probe has to actually
    // answer 401/403 for the value to count as checked. A 429 there means the endpoint got
    // as far as the header and no further, so the pass stays qualified.
    global.fetch = vi.fn(async (url, opts) => {
      const auth = opts?.headers?.["Authorization"] || "";
      if (!String(url).includes("/models")) return refuse(429, "slow down");
      if (auth.includes("sk-test-key")) return { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) };
      return auth ? refuse(429, "slow down") : refuse(401, "no auth");
    });

    const out = await testConnection("poolside");
    expect(out.valid).toBe(true);
    expect(lastUpdate().lastError).toMatch(/429|could not be verified/i);
  });

  it("refuses a key the models list could not check, using the chat endpoint", async () => {
    // venice, api-airforce, sambanova and kilo-gateway serve /v1/models publicly, so the
    // models probe cannot answer for the credential — and an invalid key showed up as a
    // green "reachable" instead of a failure. Their chat endpoint does authenticate
    // (measured: garbage key -> 401 on all of them), so that is where the verdict comes from.
    const urls = [];
    global.fetch = vi.fn(async (url, opts) => {
      urls.push(String(url));
      if (String(url).includes("/models")) return modelsOk();
      return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "Authentication failed" } }), json: async () => ({}) };
    });

    const out = await testConnection("venice");
    expect(urls.some((u) => u.includes("chat/completions"))).toBe(true);
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/invalid api key/i);
    expect(lastUpdate().testStatus).toBe("error");
  });

  it("passes a key the chat endpoint accepted", async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes("/models")) return modelsOk();
      // A completion only completes with a working credential.
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [] }), json: async () => ({ choices: [] }) };
    });

    const out = await testConnection("sambanova");
    expect(out.valid).toBe(true);
    expect(lastUpdate().lastError).toBeNull();
  });

  it("refuses a key that only morphed into looking like one", async () => {
    // morph accepts any key-shaped bearer on /models, so the third probe exposes it as
    // unverifiable — then the chat endpoint settles it.
    const seen = [];
    global.fetch = vi.fn(async (url, opts) => {
      const auth = opts?.headers?.["Authorization"] || "";
      seen.push({ url: String(url), auth });
      if (String(url).includes("/models")) {
        return auth
          ? { ok: true, status: 200, text: async () => "{}", json: async () => ({ data: [] }) }
          : { ok: false, status: 401, text: async () => "no auth", json: async () => ({}) };
      }
      // The connection holds an invented key: /models takes it, chat refuses it.
      return refuse(401, JSON.stringify({ detail: "Invalid or disabled API key" }));
    });

    const out = await testConnection("morph");
    expect(seen.some((s) => s.url.includes("chat/completions") && s.auth.includes("sk-test-key"))).toBe(true);
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/invalid api key/i);
  });

  it("keeps a valid key usable when the plan, not the key, is the problem", async () => {
    // kilo-gateway answers 402 "Paid Model - Credits Required" to a REAL key (measured), and
    // a plan refusal is not a credential failure — report the limit, not a bad key.
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes("/models")) return modelsOk();
      return { ok: false, status: 402, text: async () => JSON.stringify({ error: { title: "Paid Model - Credits Required" } }), json: async () => ({}) };
    });

    const out = await testConnection("kilo-gateway");
    expect(out.valid).toBe(true);
    expect(lastUpdate().testStatus).toBe("active");
    expect(lastUpdate().lastError).toMatch(/credit|quota|plan|402/i);
  });

  it("does not read a plan refusal on 403 as a bad key", async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes("/models")) return modelsOk();
      return { ok: false, status: 403, text: async () => JSON.stringify({ error: { message: "This model is not included in your current subscription plan" } }), json: async () => ({}) };
    });

    const out = await testConnection("api-airforce");
    expect(out.valid).toBe(true);
    expect(lastUpdate().lastError).toMatch(/plan|subscription|limit/i);
  });

  it("still refuses a 403 that blames the credential", async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes("/models")) return modelsOk();
      return { ok: false, status: 403, text: async () => JSON.stringify({ error: "please check the api-key you provided" }), json: async () => ({}) };
    });

    const out = await testConnection("api-airforce");
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/invalid api key/i);
  });

  it("does not fail a key over a chat probe that never got an answer", async () => {
    // A 404 there means our model guess was wrong, not that the key is bad.
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes("/models")) return modelsOk();
      return { ok: false, status: 404, text: async () => JSON.stringify({ error: "please check the model you provided" }), json: async () => ({}) };
    });

    const out = await testConnection("poolside");
    expect(out.valid).toBe(true);
    expect(lastUpdate().lastError).toMatch(/could not be verified|unverified/i);
  });

  it("upgrades a rate-limited models probe when the chat probe passes", async () => {
    // baidu answers 429 to /v1/models when hammered; the chat endpoint still answers.
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes("/models")) {
        return { ok: false, status: 429, text: async () => "slow down", json: async () => ({}) };
      }
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
    });

    // venice: the models probe is hammered, the chat endpoint is not.
    const out = await testConnection("venice");
    expect(out.valid).toBe(true);
    expect(lastUpdate().lastError).toBeNull();
  });

  it("does not spend a chat probe when the models endpoint already ruled", async () => {
    const urls = [];
    global.fetch = vi.fn(async (url) => {
      urls.push(String(url));
      return { ok: false, status: 401, text: async () => "nope", json: async () => ({}) };
    });

    const out = await testConnection("bluesminds");
    expect(out.valid).toBe(false);
    expect(urls.filter((u) => u.includes("chat/completions"))).toHaveLength(0);
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
