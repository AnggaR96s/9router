import { describe, it, expect } from "vitest";
import apinexRegistry from "../../open-sse/providers/registry/apinex.js";

describe("apinex provider registry", () => {
  it("has correct id/alias/auth", () => {
    expect(apinexRegistry.id).toBe("apinex");
    expect(apinexRegistry.alias).toBe("apinex");
    expect(apinexRegistry.category).toBe("apikey");
    expect(apinexRegistry.authType).toBe("apikey");
    expect(apinexRegistry.authModes).toEqual(["apikey"]);
  });

  it("points at api.apinex.bond endpoints", () => {
    expect(apinexRegistry.transport.baseUrl).toBe("https://api.apinex.bond/v1/chat/completions");
    expect(apinexRegistry.transport.modelsUrl).toBe("https://api.apinex.bond/v1/models");
    expect(apinexRegistry.modelsFetcher.url).toBe("https://api.apinex.bond/v1/models");
  });

  it("enables usage tracking", () => {
    expect(apinexRegistry.features?.usage).toBe(true);
    expect(apinexRegistry.features?.usageApikey).toBe(true);
  });
});