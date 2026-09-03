import { describe, expect, it, vi, beforeEach } from "vitest";

const { proxyAwareFetch } = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Antigravity Usage: Weekly Quota Integration & Fail-Open", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  it("merges existing per-model quotas with weekly family quotas when summary RPC succeeds", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-123",
            currentTier: { name: "Pro" },
          }),
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
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
              "claude-opus-4-6-thinking": {
                displayName: "Claude Opus 4.6 (Thinking)",
                quotaInfo: { remainingFraction: 0.5, resetTime: "2026-09-04T00:00:00Z" },
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
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    bucketId: "gemini-weekly",
                    displayName: "Weekly Limit Remaining",
                    window: "weekly",
                    remainingFraction: 0.98583066,
                    resetTime: "2026-09-10T15:50:40Z",
                  },
                ],
              },
              {
                displayName: "Claude and GPT models",
                buckets: [
                  {
                    bucketId: "3p-weekly",
                    displayName: "Weekly Limit Remaining",
                    window: "weekly",
                    remainingFraction: 0,
                    resetTime: "2026-09-06T17:02:34Z",
                  },
                ],
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const usage = await getAntigravityUsage("test-access-token", {});

    expect(usage.plan).toBe("Pro");

    // Existing per-model quotas are preserved
    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
      displayName: "Gemini 3.8 Flash (High)",
    });
    expect(usage.quotas["claude-opus-4-6-thinking"]).toMatchObject({
      used: 500,
      total: 1000,
      remainingPercentage: 50,
      displayName: "Claude Opus 4.6 (Thinking)",
    });

    // Weekly quotas are merged
    expect(usage.quotas["gemini_weekly"]).toMatchObject({
      used: 14,
      total: 1000,
      displayName: "Gemini Weekly",
      unlimited: false,
    });
    expect(usage.quotas["gemini_weekly"].remainingPercentage).toBeCloseTo(98.583066, 4);

    expect(usage.quotas["claude_gpt_weekly"]).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
      displayName: "Claude & GPT Weekly",
      unlimited: false,
    });
  });

  it("fails open when retrieveUserQuotaSummary returns 404", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-404",
            currentTier: { name: "Pro" },
          }),
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
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: false,
          status: 404,
          text: async () => "Not Found",
        };
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-404", {});

    // Existing model quota preserved
    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });

    // Weekly quotas absent, no crash
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });

  it("fails open when retrieveUserQuotaSummary returns 429", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-429",
            currentTier: { name: "Pro" },
          }),
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
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        return {
          ok: false,
          status: 429,
          text: async () => "Too Many Requests",
        };
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-429", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toMatchObject({
      used: 150,
      total: 1000,
      remainingPercentage: 85,
    });
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });

  it("fails open when retrieveUserQuotaSummary throws network exception", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cloudaicompanionProject: "test-project-net-err",
            currentTier: { name: "Pro" },
          }),
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
                quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-04T00:00:00Z" },
              },
            },
          }),
        };
      }
      if (url.includes(":retrieveUserQuotaSummary")) {
        throw new Error("DNS resolution failed");
      }
      return { ok: false, status: 500 };
    });

    const usage = await getAntigravityUsage("test-access-token-net-err", {});

    expect(usage.quotas["gemini-3.8-flash-high"]).toBeDefined();
    expect(usage.quotas).not.toHaveProperty("gemini_weekly");
    expect(usage.quotas).not.toHaveProperty("claude_gpt_weekly");
  });
});
