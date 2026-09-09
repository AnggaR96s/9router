import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock proxyAwareFetch before any imports that use it
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  parseWeeklyQuotaSummary,
  fetchAntigravityWeeklyQuota,
  _clearWeeklyCache,
} from "../../open-sse/services/usage/antigravity-weekly.js";

// — Fixtures ——————————————————————————————————————————————
const GEMINI_GROUP = {
  displayName: "Gemini Models",
  buckets: [
    {
      bucketId: "gemini-weekly-bucket",
      displayName: "Weekly Limit",
      remainingFraction: 0.75,
      resetTime: "2026-09-15T00:00:00Z",
    },
    {
      bucketId: "gemini-daily-bucket",
      displayName: "Daily Limit",
      remainingFraction: 0.9,
      resetTime: "2026-09-09T00:00:00Z",
    },
  ],
};

const CLAUDE_GPT_GROUP = {
  displayName: "Claude and GPT models",
  buckets: [
    {
      bucketId: "claude-gpt-weekly",
      displayName: "Weekly Quota",
      remainingFraction: 0.5,
      resetTime: "2026-09-14T00:00:00Z",
    },
  ],
};

const FULL_RESPONSE = { groups: [GEMINI_GROUP, CLAUDE_GPT_GROUP] };

const NESTED_RESPONSE = {
  quotaSummary: {
    groups: [GEMINI_GROUP, CLAUDE_GPT_GROUP],
  },
};

// — parseWeeklyQuotaSummary ———————————————————————————————
describe("parseWeeklyQuotaSummary", () => {
  it("extracts Gemini weekly quota from top-level groups", () => {
    const result = parseWeeklyQuotaSummary(FULL_RESPONSE);
    expect(result.gemini_weekly).toMatchObject({
      used: 250,
      total: 1000,
      remainingPercentage: 75,
      displayName: "Gemini (Weekly)",
      unlimited: false,
    });
    expect(result.gemini_weekly.resetAt).toBe("2026-09-15T00:00:00.000Z");
  });

  it("extracts Claude & GPT weekly quota", () => {
    const result = parseWeeklyQuotaSummary(FULL_RESPONSE);
    expect(result.claude_gpt_weekly).toMatchObject({
      used: 500,
      total: 1000,
      remainingPercentage: 50,
      displayName: "Claude & GPT (Weekly)",
      unlimited: false,
    });
    expect(result.claude_gpt_weekly.resetAt).toBe("2026-09-14T00:00:00.000Z");
  });

  it("handles alternate nested quotaSummary.groups shape", () => {
    const result = parseWeeklyQuotaSummary(NESTED_RESPONSE);
    expect(result.gemini_weekly).toBeDefined();
    expect(result.claude_gpt_weekly).toBeDefined();
    expect(result.gemini_weekly.remainingPercentage).toBe(75);
    expect(result.claude_gpt_weekly.remainingPercentage).toBe(50);
  });

  it("skips non-weekly buckets", () => {
    const data = {
      groups: [{
        displayName: "Gemini Models",
        buckets: [
          {
            bucketId: "gemini-daily-bucket",
            displayName: "Daily Limit",
            remainingFraction: 0.9,
            resetTime: "2026-09-09T00:00:00Z",
          },
        ],
      }],
    };
    const result = parseWeeklyQuotaSummary(data);
    expect(result).toEqual({});
  });

  it("skips disabled weekly buckets", () => {
    const data = {
      groups: [{
        displayName: "Gemini Models",
        buckets: [{
          bucketId: "gemini-weekly-bucket",
          displayName: "Weekly Limit",
          remainingFraction: 0.75,
          resetTime: "2026-09-15T00:00:00Z",
          disabled: true,
        }],
      }],
    };
    const result = parseWeeklyQuotaSummary(data);
    expect(result).toEqual({});
  });

  it("returns empty object for null/undefined input", () => {
    expect(parseWeeklyQuotaSummary(null)).toEqual({});
    expect(parseWeeklyQuotaSummary(undefined)).toEqual({});
    expect(parseWeeklyQuotaSummary("string")).toEqual({});
  });

  it("returns empty object for response with no groups", () => {
    expect(parseWeeklyQuotaSummary({})).toEqual({});
    expect(parseWeeklyQuotaSummary({ groups: "not-array" })).toEqual({});
    expect(parseWeeklyQuotaSummary({ quotaSummary: {} })).toEqual({});
  });

  it("handles groups with no buckets gracefully", () => {
    const data = {
      groups: [{ displayName: "Gemini Models" }],
    };
    expect(parseWeeklyQuotaSummary(data)).toEqual({});
  });

  it("handles bucket with non-finite remainingFraction", () => {
    const data = {
      groups: [{
        displayName: "Gemini Models",
        buckets: [{
          bucketId: "weekly-bucket",
          displayName: "Weekly",
          remainingFraction: "not-a-number",
        }],
      }],
    };
    expect(parseWeeklyQuotaSummary(data)).toEqual({});
  });

  it("ignores groups that don't match known families", () => {
    const data = {
      groups: [{
        displayName: "Unknown AI Provider",
        buckets: [{
          bucketId: "weekly-bucket",
          displayName: "Weekly",
          remainingFraction: 0.5,
        }],
      }],
    };
    expect(parseWeeklyQuotaSummary(data)).toEqual({});
  });
});

// — fetchAntigravityWeeklyQuota ———————————————————————————
describe("fetchAntigravityWeeklyQuota", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    _clearWeeklyCache();
  });

  it("fetches and returns parsed weekly quota on success", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => FULL_RESPONSE,
    });

    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result.gemini_weekly).toBeDefined();
    expect(result.claude_gpt_weekly).toBeDefined();
  });

  it("returns {} on HTTP 401", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 401 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on HTTP 403", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on HTTP 404", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on HTTP 429", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 429 });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on network error", async () => {
    proxyAwareFetch.mockRejectedValue(new Error("network timeout"));
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("returns {} on malformed JSON response", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");
    expect(result).toEqual({});
  });

  it("deduplicates concurrent requests for the same account", async () => {
    let resolveResponse;
    proxyAwareFetch.mockReturnValue(new Promise(resolve => {
      resolveResponse = resolve;
    }));

    const p1 = fetchAntigravityWeeklyQuota("token", "project-1");
    const p2 = fetchAntigravityWeeklyQuota("token", "project-1");

    resolveResponse({ ok: true, json: async () => FULL_RESPONSE });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("serves cached result within TTL", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => FULL_RESPONSE,
    });

    await fetchAntigravityWeeklyQuota("token", "project-1");
    const result = await fetchAntigravityWeeklyQuota("token", "project-1");

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(result.gemini_weekly).toBeDefined();
  });

  it("sends correct headers and body", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ groups: [] }),
    });

    await fetchAntigravityWeeklyQuota("token", "project-1");

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer token",
          "User-Agent": "antigravity/ide/2.11.0 darwin/arm64",
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
        }),
        body: JSON.stringify({ project: "project-1" }),
      }),
      expect.any(Object),
    );
  });
});

// — Integration: weekly failure does not affect existing quotas —————
describe("weekly quota isolation from existing quota", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    _clearWeeklyCache();
  });

  it("existing getAntigravityUsage succeeds even when weekly RPC fails", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "p1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-15T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        throw new Error("weekly endpoint unavailable");
      }
      return { ok: false, status: 404 };
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    expect(result.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });
    expect(result.quotas.gemini_weekly).toBeUndefined();
    expect(result.quotas.claude_gpt_weekly).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("free-tier accounts only show weekly quotas, not per-model short-window quotas", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "p1", currentTier: { name: "Starter" }, paidTier: { id: "free-tier", name: "Antigravity Starter Quota" } }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 1, resetTime: "2026-09-15T00:00:00Z" },
              },
              "claude-sonnet-4-6": {
                displayName: "Claude Sonnet 4.6",
                // Missing remainingFraction — free tier exhausted
                quotaInfo: { resetTime: "2026-09-13T12:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [{
              displayName: "Gemini Models",
              buckets: [{
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit Remaining",
                remainingFraction: 1,
                resetTime: "2026-09-15T00:00:00Z",
              }],
            }, {
              displayName: "Claude and GPT models",
              buckets: [{
                bucketId: "3p-weekly",
                displayName: "Weekly Limit Remaining",
                remainingFraction: 0,
                resetTime: "2026-09-13T12:00:00Z",
              }],
            }],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    // Per-model quotas should be absent (free-tier accounts skip model parsing)
    expect(result.quotas["gemini-3.8-flash-high"]).toBeUndefined();
    expect(result.quotas["claude-sonnet-4-6"]).toBeUndefined();

    // Only weekly quotas should appear
    expect(result.quotas.gemini_weekly).toMatchObject({
      used: 0,
      total: 1000,
      remainingPercentage: 100,
    });
    expect(result.quotas.claude_gpt_weekly).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
    });
  });

  it("reconciles weekly quota to 0% when all paid-tier family models are exhausted", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ cloudaicompanionProject: "p1", currentTier: { name: "Pro" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }),
        };
      }
      if (url.includes(":fetchAvailableModels")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                // Exhausted model: no remainingFraction, future resetTime
                quotaInfo: { resetTime: "2026-09-13T12:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            groups: [{
              displayName: "Gemini Models",
              buckets: [{
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit Remaining",
                remainingFraction: 1,
                resetTime: "2026-09-15T00:00:00Z",
              }],
            }],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const result = await getAntigravityUsage("token", {});

    // Per-model quota should show exhausted
    expect(result.quotas["gemini-3.8-flash-high"].remainingPercentage).toBe(0);
    // Weekly quota should be reconciled to 0% with the family reset time
    expect(result.quotas.gemini_weekly).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
      resetAt: "2026-09-13T12:00:00.000Z",
    });
  });
});


describe("Antigravity Weekly Quota Parser & Fetcher", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  describe("Parser: parseAntigravityWeeklyQuotas", () => {
    it("TEST A — parses real top-level groups envelope with Gemini and Claude/GPT weekly buckets", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const realFixture = {
        description: "Sanitized quota summary",
        groups: [
          {
            displayName: "Gemini Models",
            description: "Models within this group: Gemini Flash, Gemini Pro",
            buckets: [
              {
                bucketId: "gemini-weekly",
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                remainingFraction: 0.98583066,
                resetTime: "2026-09-10T15:50:40Z",
                disabled: false,
              },
              {
                bucketId: "gemini-5h",
                displayName: "Five Hour Limit Remaining",
                window: "5h",
                remainingFraction: 0.9149841,
                resetTime: "2026-09-03T21:10:50Z",
                disabled: false,
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
            buckets: [
              {
                bucketId: "3p-weekly",
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                remainingFraction: 0,
                resetTime: "2026-09-06T17:02:34Z",
                disabled: false,
              },
              {
                bucketId: "3p-5h",
                displayName: "Five Hour Limit Remaining",
                window: "5h",
                remainingFraction: 1,
                disabled: true,
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(realFixture);

      // Must produce gemini_weekly and claude_gpt_weekly
      expect(result).toHaveProperty("gemini_weekly");
      expect(result).toHaveProperty("claude_gpt_weekly");

      // Must NOT produce 5h buckets as new quota keys
      expect(result).not.toHaveProperty("gemini-5h");
      expect(result).not.toHaveProperty("3p-5h");
      expect(result).not.toHaveProperty("gemini_5h");
      expect(result).not.toHaveProperty("claude_gpt_5h");

      // Gemini Weekly checks
      expect(result.gemini_weekly).toMatchObject({
        displayName: "Gemini Weekly",
        total: 100,
        used: 1,
        unlimited: false,
      });
      expect(result.gemini_weekly.remainingPercentage).toBeCloseTo(98.583066, 4);
      expect(result.gemini_weekly.resetAt).toBe(parseResetTime("2026-09-10T15:50:40Z"));

      // Claude & GPT Weekly checks
      expect(result.claude_gpt_weekly).toMatchObject({
        displayName: "Claude & GPT Weekly",
        total: 100,
        used: 100,
        remainingPercentage: 0,
        unlimited: false,
      });
      expect(result.claude_gpt_weekly.resetAt).toBe(parseResetTime("2026-09-06T17:02:34Z"));
    });

    it("TEST B — explicit window discriminator wins even with unusual bucketId/displayName", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const fixture = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                bucketId: "bucket-tier-alpha",
                displayName: "Quota Pool Primary",
                window: "weekly",
                remainingFraction: 0.75,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixture);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result.gemini_weekly.displayName).toBe("Gemini Weekly");
      expect(result.gemini_weekly.remainingPercentage).toBe(75);
      expect(result.gemini_weekly.used).toBe(25);
      expect(result.gemini_weekly.total).toBe(100);
    });

    it("TEST C — compatibility fallback when window field is absent", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const fixtureWithoutWindow = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                bucketId: "gemini-weekly-bucket",
                displayName: "Remaining allowance",
                remainingFraction: 0.5,
                resetTime: "2026-09-10T00:00:00Z",
              },
              {
                bucketId: "gemini-session-bucket",
                displayName: "Session allowance",
                remainingFraction: 0.9,
                resetTime: "2026-09-03T20:00:00Z",
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                bucketId: "pool-3p",
                displayName: "Weekly Allocation",
                remainingFraction: 0.4,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixtureWithoutWindow);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result.gemini_weekly.remainingPercentage).toBe(50);
      expect(result.gemini_weekly.used).toBe(50);
      expect(result).toHaveProperty("claude_gpt_weekly");
      expect(result.claude_gpt_weekly.remainingPercentage).toBe(40);
      expect(result.claude_gpt_weekly.used).toBe(60);
    });

    it("TEST D — parses alternate envelope { quotaSummary: { groups: [...] } }", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const alternateEnvelope = {
        quotaSummary: {
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0.8,
                  resetTime: "2026-09-10T00:00:00Z",
                },
              ],
            },
          ],
        },
      };

      const result = parseAntigravityWeeklyQuotas(alternateEnvelope);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result.gemini_weekly.remainingPercentage).toBe(80);
    });

    it("TEST E — handles missing third-party group gracefully", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const onlyGemini = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.6,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(onlyGemini);
      expect(result).toHaveProperty("gemini_weekly");
      expect(result).not.toHaveProperty("claude_gpt_weekly");
    });

    it("TEST F — handles missing Gemini group gracefully", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const onlyClaude = {
        groups: [
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.2,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(onlyClaude);
      expect(result).toHaveProperty("claude_gpt_weekly");
      expect(result).not.toHaveProperty("gemini_weekly");
    });

    it("TEST G — skips disabled weekly bucket but preserves weekly when sibling 5h is disabled", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      // Case 1: weekly bucket itself is disabled
      const weeklyDisabled = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.5,
                disabled: true,
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };
      expect(parseAntigravityWeeklyQuotas(weeklyDisabled)).toEqual({});

      // Case 2: 5h sibling is disabled, weekly is NOT disabled (real live scenario)
      const siblingDisabled = {
        groups: [
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0,
                disabled: false,
                resetTime: "2026-09-06T17:02:34Z",
              },
              {
                window: "5h",
                remainingFraction: 1,
                disabled: true,
                resetTime: "2026-09-03T21:30:12Z",
              },
            ],
          },
        ],
      };
      const res = parseAntigravityWeeklyQuotas(siblingDisabled);
      expect(res).toHaveProperty("claude_gpt_weekly");
      expect(res.claude_gpt_weekly.used).toBe(100);
      expect(res.claude_gpt_weekly.remainingPercentage).toBe(0);
    });

    it("TEST H — handles malformed or unexpected input safely without throwing", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      expect(parseAntigravityWeeklyQuotas(null)).toEqual({});
      expect(parseAntigravityWeeklyQuotas(undefined)).toEqual({});
      expect(parseAntigravityWeeklyQuotas({})).toEqual({});
      expect(parseAntigravityWeeklyQuotas("string")).toEqual({});
      expect(parseAntigravityWeeklyQuotas({ groups: null })).toEqual({});
      expect(parseAntigravityWeeklyQuotas({ groups: [] })).toEqual({});
      expect(parseAntigravityWeeklyQuotas({ groups: [{}] })).toEqual({});
      expect(
        parseAntigravityWeeklyQuotas({
          groups: [
            {
              displayName: "Unknown Family Group",
              buckets: [{ window: "weekly", remainingFraction: 0.5 }],
            },
          ],
        })
      ).toEqual({});
      expect(
        parseAntigravityWeeklyQuotas({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [{ window: "weekly" }], // missing remainingFraction
            },
          ],
        })
      ).toEqual({});
    });

    it("TEST I — safely clamps fraction boundaries into 0..1", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const fixture = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 1.5, // > 1
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: -0.2, // < 0
                resetTime: "2026-09-10T00:00:00Z",
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixture);
      expect(result.gemini_weekly.remainingPercentage).toBe(100);
      expect(result.gemini_weekly.used).toBe(0);
      expect(result.gemini_weekly.total).toBe(100);

      expect(result.claude_gpt_weekly.remainingPercentage).toBe(0);
      expect(result.claude_gpt_weekly.used).toBe(100);
      expect(result.claude_gpt_weekly.total).toBe(100);
    });

    it("TEST J — uses parseResetTime semantics for reset timestamps", async () => {
      const { parseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const timestamp = "2026-09-10T15:50:40Z";
      const fixture = {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                window: "weekly",
                remainingFraction: 0.5,
                resetTime: timestamp,
              },
            ],
          },
        ],
      };

      const result = parseAntigravityWeeklyQuotas(fixture);
      expect(result.gemini_weekly.resetAt).toBe(parseResetTime(timestamp));
    });
  });

  describe("Fetcher: fetchAndParseAntigravityWeeklyQuotas", () => {
    it("TEST K1 — missing inputs return {} immediately", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      expect(await fetchAndParseAntigravityWeeklyQuotas(null, "p1")).toEqual({});
      expect(await fetchAndParseAntigravityWeeklyQuotas("tok", null)).toEqual({});
      expect(await fetchAndParseAntigravityWeeklyQuotas("", "")).toEqual({});
      expect(proxyAwareFetch).not.toHaveBeenCalled();
    });

    it("TEST K2 — upstream 404/429/500 fails open and returns {}", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      proxyAwareFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const res404 = await fetchAndParseAntigravityWeeklyQuotas("tok-404", "proj-404", null, { force: true });
      expect(res404).toEqual({});

      proxyAwareFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const res429 = await fetchAndParseAntigravityWeeklyQuotas("tok-429", "proj-429", null, { force: true });
      expect(res429).toEqual({});
    });

    it("TEST K3 — network exception / timeout fails open and returns {}", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      proxyAwareFetch.mockRejectedValueOnce(new Error("ETIMEDOUT"));

      const res = await fetchAndParseAntigravityWeeklyQuotas("tok-err", "proj-err", null, { force: true });
      expect(res).toEqual({});
    });

    it("TEST K4 — successful RPC response parses and caches correctly", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      proxyAwareFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0.95,
                  resetTime: "2026-09-10T12:00:00Z",
                },
              ],
            },
          ],
        }),
      });

      const res = await fetchAndParseAntigravityWeeklyQuotas("tok-cache-test", "proj-cache-test");
      expect(res).toHaveProperty("gemini_weekly");
      expect(res.gemini_weekly.remainingPercentage).toBe(95);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

      // Second call should return from cache without additional network request
      const cachedRes = await fetchAndParseAntigravityWeeklyQuotas("tok-cache-test", "proj-cache-test");
      expect(cachedRes).toHaveProperty("gemini_weekly");
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    });

    it("TEST K5 — cache key uses sha256 hash of token without raw token leakage or prefix collision", async () => {
      const { getWeeklyCacheKey } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );

      const tokenA = "dummy-token-sameprefix-AAAAA";
      const tokenB = "dummy-token-sameprefix-BBBBB";

      const keyA = getWeeklyCacheKey("proj-1", tokenA);
      const keyB = getWeeklyCacheKey("proj-1", tokenB);

      expect(keyA).not.toBe(keyB);
      expect(keyA.startsWith("proj-1:")).toBe(true);
      expect(keyA).not.toContain("ya29.");
      expect(keyA).not.toContain("sameprefix");
    });

    it("TEST K6 — options.force bypasses cached quotas and performs live fetch", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas, _resetWeeklyQuotaCacheForTesting } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );
      _resetWeeklyQuotaCacheForTesting();

      proxyAwareFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0.90,
                  resetTime: "2026-09-10T12:00:00Z",
                },
              ],
            },
          ],
        }),
      });

      // 1. Initial call populates cache
      const res1 = await fetchAndParseAntigravityWeeklyQuotas("tok-force", "proj-force");
      expect(res1.gemini_weekly.remainingPercentage).toBe(90);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

      // 2. Call with force: true bypasses cache
      const res2 = await fetchAndParseAntigravityWeeklyQuotas("tok-force", "proj-force", null, { force: true });
      expect(res2.gemini_weekly.remainingPercentage).toBe(90);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    });

    it("TEST K7 — exhausted weekly quotas (0% remaining) are evicted and not cached", async () => {
      const { fetchAndParseAntigravityWeeklyQuotas, _resetWeeklyQuotaCacheForTesting } = await import(
        "../../open-sse/services/usage/antigravityWeeklyQuota.js"
      );
      _resetWeeklyQuotaCacheForTesting();

      proxyAwareFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  window: "weekly",
                  remainingFraction: 0,
                  resetTime: "2026-09-10T12:00:00Z",
                },
              ],
            },
          ],
        }),
      });

      // 1. Call with exhausted quota
      const res1 = await fetchAndParseAntigravityWeeklyQuotas("tok-zero", "proj-zero");
      expect(res1.gemini_weekly.remainingPercentage).toBe(0);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

      // 2. Subsequent call must NOT be served from a stale 60s cache
      const res2 = await fetchAndParseAntigravityWeeklyQuotas("tok-zero", "proj-zero");
      expect(res2.gemini_weekly.remainingPercentage).toBe(0);
      expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    });
  });
});
