import { describe, it, expect, vi, afterEach } from "vitest";

// proxyFetch.js captures globalThis.fetch at module load time, so the mock
// must be installed BEFORE importing the usage handler (dynamic import +
// resetModules after stubbing).

function res(body) {
  return { ok: true, status: 200, json: async () => body };
}

function mockRoutes({ balance, subscription }) {
  return vi.fn(async (url) =>
    url.includes("/subscription") ? res(subscription) : res(balance)
  );
}

async function loadUsage(fetchImpl) {
  vi.stubGlobal("fetch", fetchImpl);
  vi.resetModules();
  const mod = await import("../../open-sse/services/usage/apinex.js");
  return mod.getApinexUsage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("apinex usage parser", () => {
  it("parses wallet + key limit + free tier daily tokens", async () => {
    const getApinexUsage = await loadUsage(
      mockRoutes({
        balance: {
          object: "balance",
          balance_usd: 52.1869,
          reserved_usd: 0.001024,
          api_key: {
            id: "key_x",
            spend_limit_usd: 0.25,
            spent_usd: 0.03125,
            reserved_usd: 0.001024,
            remaining_usd: 0.21875,
            limit_reached: false,
          },
        },
        subscription: {
          object: "subscription",
          mode: "free",
          plan: null,
          plan_label: "FREE",
          unlimited: false,
          token_limit: 1000000,
          tokens_used: 1240000,
          tokens_remaining: 48760000,
          resets_at_utc: "2026-09-09T00:00:00.000Z",
          allowed: true,
        },
      })
    );

    const usage = await getApinexUsage("sk-apx-test", {});
    expect(usage.plan).toBe("FREE");
    expect(usage.quotas["Wallet (USD)"].total).toBeCloseTo(52.19, 1);
    expect(usage.quotas["Key spend (USD)"].used).toBeCloseTo(0.031, 2);
    expect(usage.quotas["Daily tokens"].total).toBe(1000000);
    expect(usage.quotas["Daily tokens"].resetAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("returns auth message on 401", async () => {
    const getApinexUsage = await loadUsage(
      vi.fn(async () => ({ ok: false, status: 401 }))
    );
    const usage = await getApinexUsage("sk-apx-bad", {});
    expect(usage.message).toMatch(/authentication failed/i);
  });

  it("returns message when key missing", async () => {
    const getApinexUsage = await loadUsage(vi.fn(async () => res({})));
    const usage = await getApinexUsage(null, {});
    expect(usage.message).toMatch(/not available/i);
  });
});