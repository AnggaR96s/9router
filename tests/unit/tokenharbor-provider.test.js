import { describe, expect, it } from "vitest";
import tokenharbor from "../../open-sse/providers/registry/tokenharbor.js";
import { parseTokenharborModels } from "../../src/app/api/providers/[id]/models/tokenharbor.js";

describe("Token Harbor provider", () => {
  it("exposes the OpenAI-compatible API and complete provider metadata", () => {
    expect(tokenharbor).toMatchObject({
      id: "tokenharbor",
      alias: "tokenharbor",
      uiAlias: "tokenharbor",
      category: "apikey",
      authType: "apikey",
      authModes: ["apikey"],
      display: {
        name: "Token Harbor",
        icon: "ship",
        textIcon: "TH",
        website: "https://tokenharbor.ai",
      },
      transport: {
        baseUrl: "https://tokenharbor.ai/v1/chat/completions",
        modelsUrl: "https://tokenharbor.ai/v1/models",
        validateUrl: "https://tokenharbor.ai/v1/models",
        thinkingFormat: "openai",
      },
      passthroughModels: true,
    });
  });

  it("normalizes OpenAI-style model responses with prefixed ids", () => {
    expect(parseTokenharborModels({
      data: [{ id: "tokenharbor/qwen3-max", name: "Qwen3 Max" }, { id: "tokenharbor/gpt-luna" }],
    })).toEqual([
      { id: "tokenharbor/qwen3-max", name: "Qwen3 Max" },
      { id: "tokenharbor/gpt-luna", name: "tokenharbor/gpt-luna" },
    ]);
  });
});