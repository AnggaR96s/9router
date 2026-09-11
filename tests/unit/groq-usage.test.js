import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { __clearGroqUsageCache } from "../../open-sse/services/usage/groq.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const MODELS_URL = "https://api.groq.com/openai/v1/models";
const COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const MODELS = { data: [{ id: "whisper-large-v3" }, { id: "openai/gpt-oss-120b" }] };

const RATE_LIMIT_HEADERS = {
  "x-ratelimit-limit-requests": "14400",
  "x-ratelimit-remaining-requests": "14370",
  "x-ratelimit-reset-requests": "2m59.56s",
  "x-ratelimit-limit-tokens": "18000",
  "x-ratelimit-remaining-tokens": "17997",
  "x-ratelimit-reset-tokens": "7.66s",
};

/** Models list, then the minimal completion carrying the rate-limit headers. */
function mockProbe(headers = RATE_LIMIT_HEADERS, completionInit = {}) {
  proxyAwareFetch
    .mockResolvedValueOnce(response(MODELS))
    .mockResolvedValueOnce(response({ choices: [] }, { headers, ...completionInit }));
}

describe("groq registry usage flags", () => {
  it("is listed for apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("groq");
    expect(USAGE_APIKEY_PROVIDERS).toContain("groq");
  });
});

describe("getUsageForProvider(groq)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearGroqUsageCache();
  });

  it("probes chat/completions (not /models) and picks a chat-capable model", async () => {
    mockProbe();

    const usage = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Groq");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);

    // 1st call: model list to choose the probe target.
    const [modelsUrl, modelsOpts] = proxyAwareFetch.mock.calls[0];
    expect(modelsUrl).toBe(MODELS_URL);
    expect(modelsOpts.method).toBe("GET");
    expect(modelsOpts.headers.Authorization).toBe("Bearer gsk_test");

    // 2nd call: minimal completion — the ONLY place x-ratelimit-* is returned.
    const [url, opts] = proxyAwareFetch.mock.calls[1];
    expect(url).toBe(COMPLETIONS_URL);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer gsk_test");
    const body = JSON.parse(opts.body);
    // Never probe with a whisper/tts model — those reject chat completions.
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.max_tokens).toBe(1);
    expect(body.stream).toBe(false);
  });

  it("parses request + token rate-limit headers into quotas", async () => {
    mockProbe();

    const usage = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });

    expect(usage.quotas["Requests"]).toMatchObject({
      used: 30,
      total: 14400,
      unlimited: false,
    });
    expect(usage.quotas["Tokens"]).toMatchObject({
      used: 3,
      total: 18000,
      unlimited: false,
    });
    // Duration-string reset headers resolve to a real future ISO timestamp.
    expect(new Date(usage.quotas["Requests"].resetAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(usage.quotas["Tokens"].resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("caches the reading so the 60s dashboard poll doesn't burn the RPD budget", async () => {
    mockProbe();

    const first = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);

    const second = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });
    // No further upstream calls — served from cache.
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(second.quotas).toEqual(first.quotas);
  });

  it("returns a soft message (not an error) when no rate-limit headers are present", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(response(MODELS))
      .mockResolvedValueOnce(response({ choices: [] }));

    const usage = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });

    expect(usage.error).toBeUndefined();
    expect(usage.message).toMatch(/no rate-limit data/i);
    expect(usage.quotas).toEqual({});
  });

  it("keeps the last good reading when a later probe fails", async () => {
    vi.useFakeTimers();
    try {
      mockProbe();
      const good = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });
      expect(good.quotas["Requests"]).toMatchObject({ total: 14400 });

      // Let the cached reading expire, then make upstream fail. A stale quota
      // beats flickering the card to an error.
      vi.advanceTimersByTime(16 * 60 * 1000);
      proxyAwareFetch
        .mockResolvedValueOnce(response(MODELS))
        .mockResolvedValueOnce(response({ error: "boom" }, { status: 500 }));

      const after = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });
      expect(after.message).toBeUndefined();
      expect(after.quotas["Requests"]).toMatchObject({ total: 14400 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns message on missing key / 401", async () => {
    const missing = await getUsageForProvider({ provider: "groq" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch
      .mockResolvedValueOnce(response(MODELS))
      .mockResolvedValueOnce(response({ error: "invalid_api_key" }, { status: 401 }));
    const auth = await getUsageForProvider({ provider: "groq", apiKey: "gsk_test" });
    expect(auth.message).toMatch(/auth|key/i);
  });
});

describe("parseQuotaData(groq)", () => {
  it("forwards used/total/resetAt for the dashboard table", () => {
    const rows = parseQuotaData("groq", {
      plan: "Groq",
      quotas: {
        Requests: { used: 30, total: 14400, resetAt: "2026-01-01T00:03:00.000Z" },
        Tokens: { used: 3, total: 18000, resetAt: "2026-01-01T00:00:08.000Z" },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Requests", used: 30, total: 14400 });
    expect(rows[1]).toMatchObject({ name: "Tokens", used: 3, total: 18000 });
  });
});
