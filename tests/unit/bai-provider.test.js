import { describe, expect, it } from "vitest";
import bai from "../../open-sse/providers/registry/bai.js";
import { parseBaiModels } from "../../src/app/api/providers/[id]/models/bai.js";

describe("B.AI provider", () => {
  it("exposes the OpenAI-compatible API and complete provider metadata", () => {
    expect(bai).toMatchObject({
      id: "bai",
      alias: "bai",
      uiAlias: "bai",
      category: "apikey",
      authType: "apikey",
      authModes: ["apikey"],
      display: {
        name: "B.AI",
        icon: "router",
        textIcon: "BAI",
        website: "https://b.ai",
      },
      transport: {
        baseUrl: "https://api.b.ai/v1/chat/completions",
        modelsUrl: "https://api.b.ai/v1/models",
        thinkingFormat: "openai",
      },
      passthroughModels: true,
    });
  });

  it("normalizes OpenAI-style model responses", () => {
    expect(parseBaiModels({
      data: [{ id: "bai-model", name: "B.AI Model" }, { id: "second" }],
    })).toEqual([
      { id: "bai-model", name: "B.AI Model" },
      { id: "second", name: "second" },
    ]);
  });
});
