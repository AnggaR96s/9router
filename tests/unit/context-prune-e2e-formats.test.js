import { describe, it, expect, vi, beforeEach } from "vitest";

// End-to-end through handleChatCore: proves the pruning defects are reachable on
// the real gateway path (translate → prune → executor), not just in isolation,
// and that the pruned payload is valid for the provider's wire format.

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const okUpstream = () => ({
  response: new Response(JSON.stringify({
    id: "e2e", object: "chat.completion",
    choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
  }), { status: 200, headers: { "content-type": "application/json" } }),
  url: "https://x.test/v1/chat/completions", headers: {}, transformedBody: null,
});

const callCore = async (messages, provider, model) => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn(), line: vi.fn() };
  await handleChatCore({
    body: { model: `${provider}/${model}`, messages, stream: false },
    modelInfo: { provider, model },
    credentials: { apiKey: "k", projectId: "e2e-project" },
    log,
    clientRawRequest: { headers: {} },
    connectionId: "e2e", userAgent: "e2e", apiKey: "k",
    ccFilterNaming: false, rtkEnabled: false,
    contextPruningEnabled: true, maxMessagesLimit: 20,
    semanticCacheEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
    activeSkillIds: [], skillRoutingModes: {}, providerThinking: null,
  });
  return executeMock.mock.calls.at(-1)?.[0]?.body ?? null;
};

// 14 turns of user ↔ assistant(tool_calls) ↔ tool, then a final user turn:
// long enough that pruning actually triggers for every format.
const toolTurns = () => {
  const out = [];
  for (let t = 0; t < 14; t++) {
    out.push(
      { role: "user", content: `u${t}` },
      { role: "assistant", content: null, tool_calls: [{ id: `c${t}`, type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: `c${t}`, content: `r${t}` },
    );
  }
  out.push({ role: "user", content: "final" });
  return out;
};

describe("E2E: pruned payload at the upstream boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () => { throw new Error("no network in test"); });
    executeMock.mockResolvedValue(okUpstream());
  });

  it("gemini-cli: contents are pruned and the window stays valid", async () => {
    const outbound = await callCore(toolTurns(), "gemini-cli", "gemini-3-pro");
    const contents = outbound?.request?.contents;
    expect(Array.isArray(contents)).toBe(true);
    expect(contents.length).toBeLessThanOrEqual(20);
    expect(contents[0].role).toBe("user");
    expect(contents[0].parts?.some((p) => p.functionResponse)).toBe(false);

    const seen = new Set();
    for (const c of contents) {
      for (const p of c.parts || []) {
        if (p.functionCall) seen.add(p.functionCall.id);
        if (p.functionResponse) expect(seen.has(p.functionResponse.id)).toBe(true);
      }
    }
  });

  it("codex (Responses): input is pruned and never opens on an orphan function_call_output", async () => {
    const outbound = await callCore(toolTurns(), "codex", "gpt-5-codex");
    const input = outbound?.input;
    expect(Array.isArray(input)).toBe(true);
    expect(input.length).toBeLessThanOrEqual(20);
    expect(input[0].type).not.toBe("function_call_output");
    expect(input[0].role).toBe("user");

    const seen = new Set();
    for (const item of input) {
      if (item.type === "function_call") seen.add(item.call_id);
      if (item.type === "function_call_output") expect(seen.has(item.call_id)).toBe(true);
    }
  });

  it("openai (messages): 21 non-system messages are trimmed to the limit", async () => {
    const messages = Array.from({ length: 21 }, (_, i) => ({ role: "user", content: `u${i}` }));
    const outbound = await callCore(messages, "openai", "gpt-4o-mini");
    expect(outbound.messages.length).toBe(20);
  });
});