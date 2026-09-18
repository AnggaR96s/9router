import { describe, it, expect, vi, beforeEach } from "vitest";
import { pruneContextMessages } from "../../open-sse/rtk/contextPruning.js";

// The pruned window must be valid for a Claude-format provider (anthropic,
// minimax, kimi, opencode-go). Cutting to the newest N entries can leave the
// window head on a `tool_result` whose `tool_use` was pruned, or on an assistant
// turn, and Anthropic rejects both.

const claudeTurn = (t) => [
  { role: "user", content: `u${t}` },
  { role: "assistant", content: [{ type: "tool_use", id: `tu${t}`, name: "f", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: `tu${t}`, content: `r${t}` }] },
];

const claudeBody = (turns, trailingUser = true) => {
  const messages = [];
  for (let t = 0; t < turns; t++) messages.push(...claudeTurn(t));
  if (trailingUser) messages.push({ role: "user", content: `final` });
  return { messages };
};

const headToolResults = (m) =>
  (Array.isArray(m?.content) ? m.content : []).filter((p) => p?.type === "tool_result");

const audit = (body) => {
  const messages = body.messages || [];
  const blocks = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  const uses = new Set(blocks.filter((b) => b?.type === "tool_use").map((b) => b.id));
  return {
    headRole: messages[0]?.role,
    headToolResults: headToolResults(messages[0]).map((b) => b.tool_use_id),
    orphanHead: headToolResults(messages[0]).some((b) => !uses.has(b.tool_use_id)),
    orphanAnywhere: blocks.filter((b) => b?.type === "tool_result" && !uses.has(b.tool_use_id)).length,
  };
};

describe("context pruning: claude-format window heads", () => {
  it("never opens on a tool_result whose tool_use was pruned", () => {
    const body = claudeBody(7, false);
    pruneContextMessages(body, 13);
    const a = audit(body);
    expect(a.headToolResults).toEqual([]);
    expect(a.orphanAnywhere).toBe(0);
  });

  it("never opens on an assistant turn", () => {
    const body = claudeBody(7, false);
    pruneContextMessages(body, 13);
    expect(audit(body).headRole).toBe("user");
  });

  it("keeps a leading user text block when only the tool_result part is orphaned", () => {
    // A head message carrying both a stale tool_result and real text must keep the text.
    // 21 entries with a limit of 20 -> the block-shaped entry lands exactly at the head.
    const blockHead = {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "gone", content: "r" }, { type: "text", text: "keep me" }],
    };
    const body = {
      messages: [{ role: "user", content: "pad" }, blockHead, ...claudeBody(6, true).messages.slice(0, 19)],
    };
    expect(body.messages.length).toBe(21);
    pruneContextMessages(body, 20);
    expect(body.messages[0].content).toEqual([{ type: "text", text: "keep me" }]);
    expect(audit(body).orphanAnywhere).toBe(0);
    expect(body.messages[0].role).toBe("user");
  });

  it("holds across the whole alignment sweep at every limit", () => {
    const bad = [];
    for (let turns = 4; turns <= 12; turns++) {
      for (const limit of [8, 10, 13, 20, 25]) {
        for (const trailing of [true, false]) {
          const body = claudeBody(turns, trailing);
          pruneContextMessages(body, limit);
          const a = audit(body);
          if (a.orphanAnywhere > 0 || a.headRole === "assistant") {
            bad.push({ turns, limit, trailing, in: turns * 3 + (trailing ? 1 : 0), ...a });
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("leaves an OpenAI-format window alone (string content, no claude blocks)", () => {
    const body = {
      messages: [
        ...Array.from({ length: 22 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })),
      ],
    };
    pruneContextMessages(body, 20);
    expect(body.messages.length).toBeLessThanOrEqual(20);
    expect(body.messages[0].role).toBe("user");
  });
});

// The same guarantee on the real path: client claude request -> translator ->
// prune -> executor body, which is what the provider actually receives.
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: executeMock }) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() }),
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveCost: vi.fn(async () => {}), updateRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const okUpstream = () => ({
  response: new Response(JSON.stringify({
    id: "e2e", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }],
    model: "claude-sonnet-4-20250514", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } }),
  url: "https://api.anthropic.com/v1/messages", headers: {}, transformedBody: null,
});

const callCore = async (messages, limit) => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn(), line: vi.fn() };
  await handleChatCore({
    body: { model: "anthropic/claude-sonnet-4-20250514", max_tokens: 64, messages, stream: false },
    modelInfo: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    credentials: { apiKey: "sk-ant-placeholder", projectId: "e2e" },
    log, clientRawRequest: { headers: {} }, connectionId: "e2e", userAgent: "e2e", apiKey: "master-test",
    ccFilterNaming: false, rtkEnabled: false,
    contextPruningEnabled: true, maxMessagesLimit: limit,
    semanticCacheEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
    activeSkillIds: [], skillRoutingModes: {}, providerThinking: null, sourceFormatOverride: "claude",
  });
  return executeMock.mock.calls.at(-1)?.[0]?.body ?? null;
};

describe("context pruning: claude-format payload at the provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () => { throw new Error("no network in test"); });
    executeMock.mockResolvedValue(okUpstream());
  });

  it("sends a window that opens on a user turn with no orphaned tool_result", async () => {
    const outbound = await callCore(claudeBody(9, true).messages, 20);
    const auditResult = audit(outbound);
    expect(auditResult.orphanAnywhere).toBe(0);
    expect(auditResult.headRole).toBe("user");
    expect(auditResult.headToolResults).toEqual([]);
  });
});
