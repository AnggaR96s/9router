import { describe, expect, it } from "vitest";
import nous from "../../open-sse/providers/registry/nous.js";
import { parseNousModels } from "../../src/app/api/providers/[id]/models/nous.js";

describe("Nous Research provider", () => {
  it("exposes the OpenAI-compatible API and complete provider metadata", () => {
    expect(nous).toMatchObject({
      id: "nous",
      alias: "nous",
      uiAlias: "nous",
      category: "oauth",
      authType: "apikey",
      hasOAuth: true,
      authModes: ["oauth", "apikey"],
      display: {
        name: "Nous Research",
        website: "https://nousresearch.com",
      },
      transport: {
        baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
        modelsUrl: "https://inference-api.nousresearch.com/v1/models",
        validateUrl: "https://inference-api.nousresearch.com/v1/models",
        thinkingFormat: "openai",
      },
      // Nous Portal OAuth device flow (Hermes CLI client) alongside the API key.
      oauth: {
        clientId: "hermes-cli",
        deviceCodeUrl: "https://portal.nousresearch.com/api/oauth/device/code",
        tokenUrl: "https://portal.nousresearch.com/api/oauth/token",
        refreshUrl: "https://portal.nousresearch.com/api/oauth/token",
        scope: "inference:invoke",
        userInfoUrl: "https://portal.nousresearch.com/api/oauth/account",
      },
      passthroughModels: true,
    });
  });

  it("normalizes OpenAI-style model responses", () => {
    expect(parseNousModels({
      data: [{ id: "qwen/qwen3.8-max-0902", name: "Qwen3.8 Max" }, { id: "inclusionai/ling-3.0-flash-sante:free" }],
    })).toEqual([
      { id: "qwen/qwen3.8-max-0902", name: "Qwen3.8 Max" },
      { id: "inclusionai/ling-3.0-flash-sante:free", name: "inclusionai/ling-3.0-flash-sante:free" },
    ]);
  });
});