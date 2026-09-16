import { describe, it, expect } from "vitest";
import clineRegistry from "../../open-sse/providers/registry/cline.js";

// A Cline API key minted at app.cline.bot/settings/api-keys authenticates against the
// same api.cline.bot/api/v1 endpoints as the OAuth token (measured: GET /users/me 200,
// POST /chat/completions 200), and the executor already prefers credential.apiKey over
// accessToken when it builds the Cline headers. The registry was OAuth-only, so the
// dashboard refused an API-key connection ("Invalid provider") even though everything
// downstream was ready for one. Same dual-auth shape as codebuddy-cn / kimi.

describe("cline accepts both auth modes", () => {
  it("lists oauth and apikey", () => {
    expect(clineRegistry.authModes).toContain("oauth");
    expect(clineRegistry.authModes).toContain("apikey");
  });

  it("keeps the OAuth flow it already had", () => {
    expect(clineRegistry.hasOAuth).toBe(true);
    expect(clineRegistry.oauth?.tokenExchangeUrl).toBeTruthy();
    expect(clineRegistry.transport?.tokenUrl).toBeTruthy();
  });

  it("exposes the apikey mode through AI_PROVIDERS, the gate the connection API checks", async () => {
    const { AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    expect(AI_PROVIDERS.cline?.authModes).toContain("apikey");
  });

  // Both the connection "Test" button and the add-a-key validation path probe
  // PROVIDERS[id].validateUrl with the key; without one, an apikey cline connection
  // reports "Provider test not supported" instead of a verdict. /users/me is the
  // endpoint that actually checks the credential (measured: key 200, no key and a bogus
  // key both 401), so it cannot pass a wrong key the way a public /models list would.
  // Asserted through the built table, not the registry entry: PROVIDERS is assembled
  // from entry.transport alone, so a top-level validateUrl never reaches the caller.
  it("declares the credential-checking URL the API-key test path probes", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    expect(PROVIDERS.cline?.validateUrl).toBe("https://api.cline.bot/api/v1/users/me");
  });
});