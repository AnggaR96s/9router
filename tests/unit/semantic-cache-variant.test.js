import { beforeEach, describe, expect, it, vi } from "vitest";

// The response cache key is built from the client body alone, yet several
// per-request inputs reshape the outbound body from OUTSIDE it: the x-skill
// header (resolved into activeSkillIds), the dashboard skill routing modes, and
// the x-9router-token-saver opt-out header. The lookup also runs before any of
// them are applied, so without a variant in the key a request that asks for a
// skill is served an answer produced without it — and the other way round.
//
// semantic-response-cache.test.js locks the key contents that live INSIDE the
// body (model, apiKey, request options). This file locks the inputs that live
// outside it.

const { executeMock, skillState } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  skillState: { prompt: "COMMIT_LINT_PROMPT", keywords: [] },
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/skillsRegistry.js", () => ({
  getInstalledSkills: async () => [
    { id: "commit-lint", prompt: skillState.prompt, keywords: [], routingMode: "always" },
  ],
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { checkSemanticCache, saveToSemanticCache } = await import(
  "../../open-sse/rtk/semanticCache.js"
);

function requestBody(content, overrides = {}) {
  return {
    model: "deepseek-chat",
    stream: false,
    messages: [{ role: "user", content }],
    ...overrides,
  };
}

function coreOptions(body, overrides = {}) {
  return {
    body,
    modelInfo: { provider: "deepseek", model: "deepseek-chat" },
    credentials: { apiKey: "upstream-key", providerSpecificData: {} },
    apiKey: "key-A",
    semanticCacheEnabled: true,
    connectionId: "connection",
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

function providerResult() {
  return {
    response: new Response(JSON.stringify({
      id: "response-1",
      choices: [{ message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } }),
    url: "https://example.test/v1/chat/completions",
    headers: {},
    transformedBody: null,
  };
}

describe("semantic cache variant", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockImplementation(async () => providerResult());
  });

  it("keeps a variant's entry separate from the unvaried entry", () => {
    const body = requestBody("variant-isolation");
    const response = { id: "variant-response" };

    saveToSemanticCache(body, "provider/model", response, "key-A", "skills=commit-lint");

    expect(checkSemanticCache(body, "provider/model", "key-A", "skills=commit-lint"))
      .toMatchObject({ id: "variant-response" });
    expect(checkSemanticCache(body, "provider/model", "key-A", null)).toBeNull();
    expect(checkSemanticCache(body, "provider/model", "key-A", "skills=")).toBeNull();
  });

  it("keeps unvaried callers working without a variant argument", () => {
    const body = requestBody("no-variant");

    saveToSemanticCache(body, "provider/model", { id: "plain" }, "key-A");

    expect(checkSemanticCache(body, "provider/model", "key-A")).toMatchObject({ id: "plain" });
  });

  it("keeps skill variants stable across API formats and injection order", async () => {
    const { buildSkillVariant } = await import("../../open-sse/rtk/injectSkill.js");
    const openaiBody = requestBody("copy this");
    const kiroBody = { conversationState: { currentMessage: { userInputMessage: { content: "copy this" } } } };

    const a = await buildSkillVariant(openaiBody, ["commit-lint"], { "commit-lint": "smart" });
    const b = await buildSkillVariant(kiroBody, ["commit-lint"], { "commit-lint": "smart" });
    const c = await buildSkillVariant(openaiBody, ["commit-lint", "commit-lint"], { "commit-lint": "smart" });

    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(a).toContain("commit-lint:smart:");
  });

  it("does not serve a skill request the answer cached without that skill", async () => {
    const body = () => requestBody("skill-variant-test");

    await handleChatCore(coreOptions(body(), { activeSkillIds: [] }));
    expect(executeMock).toHaveBeenCalledTimes(1);

    const withSkill = await handleChatCore(
      coreOptions(body(), { activeSkillIds: ["commit-lint"] })
    );
    expect(withSkill.response.headers.get("X-9Router-Cache")).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(2);

    const repeat = await handleChatCore(
      coreOptions(body(), { activeSkillIds: ["commit-lint"] })
    );
    expect(repeat.response.headers.get("X-9Router-Cache")).toBe("HIT");
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("does not serve an updated skill prompt from the entry cached before the update", async () => {
    const body = () => requestBody("skill-prompt-version-test");

    skillState.prompt = "COMMIT_LINT_PROMPT_V1";
    await handleChatCore(coreOptions(body(), { activeSkillIds: ["commit-lint"] }));

    skillState.prompt = "COMMIT_LINT_PROMPT_V2";
    const updated = await handleChatCore(coreOptions(body(), { activeSkillIds: ["commit-lint"] }));
    expect(updated.response.headers.get("X-9Router-Cache")).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("does not serve a routing-mode change the answer cached under the old mode", async () => {
    const body = () => requestBody("routing-mode-variant-test");

    await handleChatCore(coreOptions(body(), {
      activeSkillIds: ["commit-lint"],
      skillRoutingModes: { "commit-lint": "always" },
    }));

    const off = await handleChatCore(coreOptions(body(), {
      activeSkillIds: ["commit-lint"],
      skillRoutingModes: { "commit-lint": "off" },
    }));
    expect(off.response.headers.get("X-9Router-Cache")).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("shares the plain entry when a skill is switched off (no skill is injected)", async () => {
    const body = () => requestBody("skill-off-shares-plain");

    await handleChatCore(coreOptions(body(), { activeSkillIds: [] }));
    expect(executeMock).toHaveBeenCalledTimes(1);

    const off = await handleChatCore(
      coreOptions(body(), {
        activeSkillIds: ["commit-lint"],
        skillRoutingModes: { "commit-lint": "off" },
      })
    );
    expect(off.response.headers.get("X-9Router-Cache")).toBe("HIT");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("does not serve a provider thinking-mode change the old answer", async () => {
    const body = () => requestBody("thinking-mode-variant-test");

    await handleChatCore(coreOptions(body(), { providerThinking: { mode: "on" } }));

    const off = await handleChatCore(coreOptions(body(), { providerThinking: { mode: "off" } }));
    expect(off.response.headers.get("X-9Router-Cache")).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("does not share entries across the token-saver opt-out header", async () => {
    const body = () => requestBody("token-saver-variant-test");

    await handleChatCore(coreOptions(body()));

    const optedOut = await handleChatCore(coreOptions(body(), {
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        headers: { accept: "application/json", "x-9router-token-saver": "off" },
      },
    }));
    expect(optedOut.response.headers.get("X-9Router-Cache")).toBeNull();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});
