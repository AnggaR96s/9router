// Covers the Atria provider addition: registry wiring, model resolver, and
// the auth-gated catalog (401 without a key → per-connection fetch, never public).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAtriaModels, parseAtriaModels } from "../../src/app/api/providers/[id]/models/atria.js";
import atriaRegistry from "../../open-sse/providers/registry/atria.js";

describe("atria registry entry", () => {
  it("is reachable through the built PROVIDERS table", async () => {
    const { PROVIDERS, PROVIDER_MODELS } = await import(
      "../../open-sse/providers/index.js"
    );
    expect(PROVIDERS.atria.baseUrl).toBe(
      "https://api.atria-asi.ai/v1/chat/completions"
    );
    expect(PROVIDER_MODELS.atria.map((m) => m.id)).toEqual([
      "Atria-Dawn-Preview",
    ]);
  });

  it("declares the endpoints the docs document", () => {
    const e = atriaRegistry;
    expect(e.id).toBe("atria");
    expect(e.category).toBe("apikey");
    expect(e.authType).toBe("apikey");
    expect(e.authModes).toEqual(["apikey"]);
    expect(e.transport.baseUrl).toBe(
      "https://api.atria-asi.ai/v1/chat/completions"
    );
    expect(e.transport.modelsUrl).toBe("https://api.atria-asi.ai/v1/models");
    // Test Connection probes this; without it the dashboard answers
    // "Provider test not supported".
    expect(e.transport.validateUrl).toBe("https://api.atria-asi.ai/v1/models");
    expect(e.modelsFetcher.url).toBe("https://api.atria-asi.ai/v1/models");
  });

  it("seeds the single documented model", () => {
    expect(atriaRegistry.models.map((m) => m.id)).toEqual(["Atria-Dawn-Preview"]);
  });

  it("points the key-creation notice at the console", () => {
    expect(atriaRegistry.display.notice.apiKeyUrl).toBe(
      "https://api.atria-asi.ai/console/keys"
    );
  });
});

describe("atria model resolver", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns models parsed from an OpenAI-style body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" },
          { id: "Atria-Dawn-Preview-2", name: "Atria Dawn Preview 2" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchAtriaModels({ apiKey: "atr_test" });
    expect(out.models).toEqual([
      { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" },
      { id: "Atria-Dawn-Preview-2", name: "Atria Dawn Preview 2" },
    ]);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe("https://api.atria-asi.ai/v1/models");
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe("Bearer atr_test");
  });

  it("refuses to fetch without a key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const out = await fetchAtriaModels({});
    expect(out.models).toBeUndefined();
    expect(out.error).toBeTruthy();
    expect(out.status).toBe(401);
  });

  it("surfaces a 401 instead of an empty catalog", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: { message: "Invalid API key.", code: "invalid_api_key" },
      }),
    }));
    const out = await fetchAtriaModels({ apiKey: "atr_wrong" });
    expect(out.models).toBeUndefined();
    expect(out.status).toBe(401);
    expect(out.error).toContain("Invalid API key");
  });

  it("rejects entries with an empty or non-string id", () => {
    const junk = parseAtriaModels({
      data: [
        { id: "", name: "empty" },
        { id: null, name: "null id" },
        { name: "no id field" },
        "not-an-object",
        { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" },
      ],
    });
    expect(junk.map((m) => m.id)).toEqual(["Atria-Dawn-Preview"]);
  });

  it("falls back to a generic message on a non-JSON error body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    }));
    const out = await fetchAtriaModels({ apiKey: "atr_test" });
    expect(out.error).toContain("502");
  });
});
