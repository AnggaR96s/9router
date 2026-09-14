import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

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

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { handleForcedSSEToJson } = await import(
  "../../open-sse/handlers/chatCore/sseToJsonHandler.js"
);
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

function coreOptions(body, apiKey, semanticCacheEnabled = true) {
  return {
    body,
    modelInfo: { provider: "deepseek", model: "deepseek-chat" },
    credentials: { apiKey: "provider-key", providerSpecificData: {} },
    apiKey,
    semanticCacheEnabled,
    connectionId: "connection",
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

function forcedSseContext(content) {
  const raw = [
    'data: {"id":"chatcmpl-sse","model":"model","choices":[{"delta":{"content":"pong"},"finish_reason":null}]}',
    'data: {"id":"chatcmpl-sse","model":"model","choices":[{"delta":{},"finish_reason":"stop"}]}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const body = requestBody(content);
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat: "openai",
    targetFormat: "openai",
    provider: "provider",
    model: "model",
    body,
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection",
    apiKey: "key-A",
    semanticCacheEnabled: true,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: () => {},
    trackDone: () => {},
    appendLog: () => {},
    reqTag: "request",
    log: null,
  };
}

describe("semantic response cache", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockImplementation(async () => providerResult());
  });

  it("reuses an identical response only for the same API key", async () => {
    const firstBody = requestBody("cache-hit-test");
    const first = await handleChatCore(coreOptions(firstBody, "key-A"));
    expect(first.success).toBe(true);
    expect(checkSemanticCache(firstBody, "deepseek/deepseek-chat", "key-A"))
      .toMatchObject({ id: "response-1" });

    const hit = await handleChatCore(coreOptions(requestBody("cache-hit-test"), "key-A"));
    expect(hit.response.headers.get("X-9Router-Cache")).toBe("HIT");
    expect(executeMock).toHaveBeenCalledTimes(1);

    await handleChatCore(coreOptions(requestBody("cache-hit-test"), "key-B"));
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("does not populate the cache while the feature is disabled", async () => {
    await handleChatCore(coreOptions(requestBody("disabled-cache-test"), "key-A", false));
    await handleChatCore(coreOptions(requestBody("disabled-cache-test"), "key-A", false));

    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("includes request options in the cache key", () => {
    const response = { id: "options-response" };
    saveToSemanticCache(requestBody("options-test", { temperature: 0.1 }), "provider/model", response, "key-A");

    expect(checkSemanticCache(
      requestBody("options-test", { temperature: 0.9 }),
      "provider/model",
      "key-A",
    )).toBeNull();
  });

  it("stores both forced SSE-to-JSON response shapes", async () => {
    const chatContext = forcedSseContext("forced-sse-chat-test");
    const chatResult = await handleForcedSSEToJson(chatContext);

    expect(chatResult.success).toBe(true);
    expect(checkSemanticCache(chatContext.body, "provider/model", "key-A"))
      .toMatchObject({ choices: [{ message: { content: "pong" } }] });

    const responsesContext = forcedSseContext("forced-sse-responses-test");
    responsesContext.sourceFormat = "openai-responses";
    const responsesResult = await handleForcedSSEToJson(responsesContext);

    expect(responsesResult.success).toBe(true);
    expect(checkSemanticCache(responsesContext.body, "provider/model", "key-A"))
      .toMatchObject({ object: "response" });
  });

  it("keeps hitting when the provider injects thinking options after the lookup", async () => {
    const options = () => ({
      ...coreOptions(requestBody("thinking-injection-test"), "key-A"),
      providerThinking: { mode: "on" },
    });

    await handleChatCore(options());
    const hit = await handleChatCore(options());

    expect(hit.response.headers.get("X-9Router-Cache")).toBe("HIT");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache errors, streaming requests, or forced tool choices", () => {
    const body = requestBody("cache-guard-test");
    const response = { id: "guard-response" };

    saveToSemanticCache(body, "provider/model", { error: { message: "boom" } }, "key-A");
    saveToSemanticCache({ ...body, stream: true }, "provider/model", response, "key-A");
    saveToSemanticCache({ ...body, tool_choice: "required" }, "provider/model", response, "key-A");

    expect(checkSemanticCache(body, "provider/model", "key-A")).toBeNull();
  });
});
