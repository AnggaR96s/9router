import { describe, it, expect, vi, beforeEach } from "vitest";

// The relay URL transport field is named `vercelRelayUrl` for all three relay
// kinds (vercel / cloudflare / deno) because they share one header contract.
// That name leaked into the PROXY log line, so a Cloudflare Worker on
// *.workers.dev was reported as "vercel-relay=<url>" and looked like a pool
// whose `type` had been mis-set. `relayType` carries the real kind for labels;
// routing must keep reading `vercelRelayUrl`.
vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

import { getProxyPoolById } from "@/models";
import { resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";

const POOL = {
  id: "pool-1",
  name: "dthsrelay",
  proxyUrl: "https://dthsrelay.axxa.workers.dev",
  noProxy: "",
  isActive: true,
  strictProxy: false,
};

describe("resolveConnectionProxyConfig — relay typing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports relayType=cloudflare while still filling the shared vercelRelayUrl field", async () => {
    getProxyPoolById.mockResolvedValue({ ...POOL, type: "cloudflare" });

    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "pool-1" });

    expect(cfg.relayType).toBe("cloudflare");
    // Routing reads this field — renaming it would break the transport.
    expect(cfg.vercelRelayUrl).toBe(POOL.proxyUrl);
    expect(cfg.source).toBe("cloudflare");
    // A relay is NOT an HTTP proxy: no env-var proxying, no connectionProxyUrl.
    expect(cfg.connectionProxyEnabled).toBe(false);
    expect(cfg.connectionProxyUrl).toBe("");
  });

  it("reports the kind per relay type (vercel and deno are not cloudflare)", async () => {
    for (const type of ["vercel", "deno", "cloudflare"]) {
      getProxyPoolById.mockResolvedValue({ ...POOL, type });
      const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "pool-1" });
      expect(cfg.relayType).toBe(type);
      expect(cfg.vercelRelayUrl).toBe(POOL.proxyUrl);
    }
  });

  it("leaves relayType undefined for a standard HTTP proxy pool", async () => {
    getProxyPoolById.mockResolvedValue({ ...POOL, type: "http", proxyUrl: "http://127.0.0.1:7897" });

    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "pool-1" });

    expect(cfg.relayType).toBeUndefined();
    expect(cfg.vercelRelayUrl).toBeUndefined();
    expect(cfg.connectionProxyEnabled).toBe(true);
    expect(cfg.connectionProxyUrl).toBe("http://127.0.0.1:7897");
  });
});
