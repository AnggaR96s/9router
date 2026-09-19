// Guards the Zed connection test, which answered "Provider test not supported" because `zed`
// was missing from OAUTH_TEST_CONFIG — the dashboard showed that error on every working Zed
// connection.
//
// Two properties make this provider unlike the other entries there:
//
//  - The Authorization header is NON-STANDARD: "<userId> <accessToken>" with no scheme (plus a
//    duplicate x-zed-cloud-token). A Bearer-shaped probe would look right in the code and be
//    rejected by cloud.zed.dev, so the assertion pins the exact header.
//  - The model catalog is NOT a health signal. A live account with no subscription answers
//    200 on /models with {"models":[]} (measured: a valid Zed account, can_start_trial=false,
//    empty catalog), so judging the connection by its model list would report a working login
//    as broken. /client/users/me is what actually reads the credential.
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
  refreshProviderCredentials: vi.fn(async () => null),
}));

vi.mock("open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getAccessToken: mocks.getAccessToken,
}));

const originalFetch = global.fetch;

function conn(extra = {}) {
  return {
    id: "c1",
    provider: "zed",
    authType: "oauth",
    accessToken: "zed-token-abc",
    refreshToken: null,
    expiresAt: null,
    providerSpecificData: { authMethod: "oauth", userId: "1076031", systemId: "sys-1" },
    ...extra,
  };
}

async function testConnection(extra) {
  mocks.getProviderConnectionById.mockResolvedValue(conn(extra));
  vi.resetModules();
  const mod = await import("../../src/app/api/providers/[id]/test/testUtils.js");
  return mod.testSingleConnection("c1");
}

describe("provider test — zed (OAuth)", () => {
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

  it("probes /client/users/me with Zed's non-standard auth header", async () => {
    let called = null;
    global.fetch = vi.fn(async (url, opts) => {
      called = { url: String(url), opts };
      return { ok: true, status: 200 };
    });
    const out = await testConnection();

    expect(called.url).toBe("https://cloud.zed.dev/client/users/me");
    // No scheme, no Bearer: "<userId> <accessToken>".
    expect(called.opts.headers.Authorization).toBe("1076031 zed-token-abc");
    expect(called.opts.headers.Authorization).not.toMatch(/^Bearer /);
    expect(out.valid).toBe(true);
  });

  it("accepts an account whose live model catalog is empty", async () => {
    // The measured real case: 200 with {"models":[]} because the account has no subscription.
    // A valid credential must not be reported as broken for lacking entitlements.
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [], default_model: "" }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ user: { id: 1076031 } }) };
    });
    const out = await testConnection();
    expect(out.valid).toBe(true);
    expect(out.error).toBeNull();
  });

  it("rejects a token cloud.zed.dev refuses", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    const out = await testConnection();
    expect(out.valid).toBe(false);
    expect(out.error).toBe("Token invalid or revoked");
  });

  it("reports 'No access token' rather than a blanket unsupported message", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const out = await testConnection({ accessToken: "" });
    expect(out.valid).toBe(false);
    expect(out.error).toBe("No access token");
  });
});