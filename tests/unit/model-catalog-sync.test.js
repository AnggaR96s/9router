import { describe, expect, it } from "vitest";
import { build, PROVIDER_ALIASES } from "../../src/lib/modelCatalog/sync.js";

const model = (limit) => ({
  modalities: { input: ["text"] },
  limit,
});

const entry = (provider, modelId, current = { contextWindow: 400000, maxOutput: 128000 }) => ({
  provider,
  model: modelId,
  current,
});

describe("model catalog sync", () => {
  it("maps an explicit provider alias to canonical catalog limits", () => {
    const originalAliases = PROVIDER_ALIASES;
    PROVIDER_ALIASES["codebuddy-intl"] = "openai";
    try {
      const result = build(
        {
          openai: {
            models: {
              "gpt-5.6-terra": model({ context: 1050000, output: 128000 }),
            },
          },
        },
        [entry("codebuddy-intl", "gpt-5.6-terra")],
      );

      expect(result.providers["codebuddy-intl"]["gpt-5.6-terra"]).toEqual({
        contextWindow: 1050000,
      });
    } finally {
      delete originalAliases["codebuddy-intl"];
    }
  });

  it("does not create an override when the provider-specific value already matches", () => {
    const result = build(
      {
        openai: {
          models: {
            "gpt-5.6-terra": model({ context: 1050000, output: 128000 }),
          },
        },
        "codebuddy-intl": {
          models: {
            "gpt-5.6-terra": model({ context: 400000, output: 128000 }),
          },
        },
      },
      [entry("codebuddy-intl", "gpt-5.6-terra")],
    );

    expect(result.providers["codebuddy-intl"]).toBeUndefined();
  });
});
