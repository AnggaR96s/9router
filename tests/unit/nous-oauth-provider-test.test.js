// Guards the Nous Research OAuth connection test, which answered
// "Provider test not supported" because `nous` was missing from OAUTH_TEST_CONFIG.
//
// Two properties make this provider unlike the other entries there:
//
//  - /v1/models is PUBLIC. A garbage key returns 200 with the full catalog (verified live),
//    so probing it would report a dead token as healthy — the same trap as ollama-search.
//    /api/oauth/account is what actually reads the credential: 200 for a real token,
//    401 invalid_token for a bogus one.
//  - The refresh token travels in the X-Nous-Refresh-Token header rather than the body, so
//    the shared refreshOAuthToken path cannot serve it; the dedicated
//    refreshNousPortalToken handler (reached via getAccessToken) owns it.
//
// fetch is mocked so these run without network access and without touching the DB.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getAccessToken: vi.fn(),
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

vi.mock("open-sse/services/oauthCredentialManager.js", async (importOriginal) => ({
  ...(await importOriginal()),
  // Keep the real shouldRefreshCredentials logic; only the network refresh is stubbed.
  refreshProviderCredentials: vi.fn(async () => null),
}));

// Partial: only getAccessToken is stubbed. The module is also read for helpers like
// getRefreshLeadMs via oauthCredentialManager, so replacing it wholesale breaks the
// expiry check.
vi.mock("open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getAccessToken: mocks.getAccessToken,
}));

const originalFetch = global.fetch;

function conn(extra = {}) {
  return {
    id: "c1",
    provider: "nous",
    authType: "oauth",
    accessToken: "token-abc",
    refreshToken: "refresh-abc",
    // Far future so the expiry path stays out of the way unless a case forces it.
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    providerSpecificData: {},
    ...extra,
  };
}

async function testConnection(extra) {
  mocks.getProviderConnectionById.mockResolvedValue(conn(extra));
  vi.resetModules();
  const mod = await import("../../src/app/api/providers/[id]/test/testUtils.js");
  return mod.testSingleConnection("c1");
}

describe("provider test — nous (OAuth)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("no longer answers 'Provider test not supported'", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const out = await testConnection();
    expect(out.error).not.toBe("Provider test not supported");
    expect(out.valid).toBe(true);
  });

  it("probes /api/oauth/account, not the public /v1/models", async () => {
    // /v1/models answers 200 for any key, so probing there would validate nothing.
    let called = null;
    global.fetch = vi.fn(async (url, opts) => {
      called = { url: String(url), opts };
      return { ok: true, status: 200 };
    });
    await testConnection();

    expect(called.url).toBe("https://portal.nousresearch.com/api/oauth/account");
    expect(called.url).not.toContain("/v1/models");
    expect(called.opts.headers.Authorization).toBe("Bearer token-abc");
  });

  it("rejects a token the portal refuses", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    const out = await testConnection();
    expect(out.valid).toBe(false);
    expect(out.error).toBeTruthy();
    expect(out.error).not.toBe("Provider test not supported");
  });

  it("refreshes an expired token through the dedicated Portal handler", async () => {
    // The refresh token rides in a header, so the shared path cannot do this — assert the
    // Portal-specific helper is what gets called.
    mocks.getAccessToken.mockResolvedValue({
      accessToken: "token-new",
      refreshToken: "refresh-new",
      expiresIn: 3600,
    });
    let seen = null;
    global.fetch = vi.fn(async (url, opts) => {
      seen = { url: String(url), opts };
      return { ok: true, status: 200 };
    });

    const out = await testConnection({ expiresAt: "2020-01-01T00:00:00.000Z" });

    expect(mocks.getAccessToken).toHaveBeenCalledWith(
      "nous",
      expect.objectContaining({ provider: "nous" }),
      expect.anything()
    );
    expect(out.valid).toBe(true);
    expect(out.refreshed).toBe(true);
    // The probe must use the freshly minted token.
    expect(seen.opts.headers.Authorization).toBe("Bearer token-new");
  });

  it("reports a failed refresh instead of passing on the stale token", async () => {
    mocks.getAccessToken.mockResolvedValue(null);
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const out = await testConnection({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(out.valid).toBe(false);
    expect(out.error).toMatch(/refresh failed/i);
  });

  it("does not attempt a refresh while the token is still valid", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    await testConnection();
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
  });
});