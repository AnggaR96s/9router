import { describe, expect, it } from "vitest";
import orcarouter from "../../open-sse/providers/registry/orcarouter.js";
import { parseOrcarouterModels } from "../../src/app/api/providers/[id]/models/orcarouter.js";

describe("OrcaRouter provider", () => {
  it("exposes the OpenAI-compatible API and complete provider metadata", () => {
    expect(orcarouter).toMatchObject({
      id: "orcarouter",
      alias: "orcarouter",
      uiAlias: "orcarouter",
      category: "apikey",
      authType: "apikey",
      authModes: ["apikey"],
      display: {
        name: "OrcaRouter",
        website: "https://www.orcarouter.ai",
      },
      transport: {
        baseUrl: "https://www.orcarouter.ai/v1/chat/completions",
        modelsUrl: "https://www.orcarouter.ai/v1/models",
        validateUrl: "https://www.orcarouter.ai/v1/models",
        thinkingFormat: "openai",
      },
      passthroughModels: true,
    });
  });

  it("normalizes OpenAI-style model responses", () => {
    expect(parseOrcarouterModels({
      data: [{ id: "orcarouter/free" }, { id: "anthropic/claude-fable-5", name: "Claude Fable 5" }],
    })).toEqual([
      { id: "orcarouter/free", name: "orcarouter/free" },
      { id: "anthropic/claude-fable-5", name: "Claude Fable 5" },
    ]);
  });
});