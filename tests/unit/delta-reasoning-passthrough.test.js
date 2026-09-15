// Reasoning that arrives as bare `delta.reasoning` must reach the client.
//
// A Cline client routing DeepSeek v4.1 through the gateway never received the
// model's reasoning tokens, while GLM on the same setup worked. Cline's chunks
// carry the text under `delta.reasoning` (the bare key), not
// `delta.reasoning_content`. hasValuableContent() only recognised
// `reasoning_content`, so every reasoning-only chunk was rejected and dropped by
// the passthrough filter in stream.js — the client saw role + content + finish,
// nothing else.
//
// Why only that combination broke: extractReasoningText()
// (open-sse/translator/concerns/reasoning.js) DOES read bare `reasoning`, but it
// only runs on the translate path, i.e. when the client format differs from the
// provider format. A Cline client speaks `openai` and the upstream speaks
// `openai`, so it takes the passthrough branch and never reaches the translator.
//
// The fix widens both ends: the predicate that decides whether a chunk is worth
// forwarding, and the accumulation that feeds usage/onStreamComplete (the
// reasoning-only chunks contribute prompt/completion tokens, so dropping them
// also under-counted usage). `reasoning_details[]` (MiniMax) was dropped by the
// same predicate and is covered too.

import { describe, expect, it, vi, beforeEach } from "vitest";

const appendRequestLog = vi.fn(async () => {});
const trackPendingRequest = vi.fn();

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: (...args) => appendRequestLog(...args),
  trackPendingRequest: (...args) => trackPendingRequest(...args),
}));

let createPassthroughStreamWithLogger;
let FORMATS;

beforeEach(async () => {
  vi.resetModules();
  appendRequestLog.mockClear();
  trackPendingRequest.mockClear();
  ({ createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  ({ FORMATS } = await import("../../open-sse/translator/formats.js"));
});

const chunk = (delta) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-cline",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta }],
  })}\n\n`;

// Cline's real shape, as already encoded in
// tests/unit/cline-free-models-envelope.test.js:70 — `reasoning`, not
// `reasoning_content`. Role arrives in its own chunk, then reasoning-only
// chunks, then content, then finish.
const CLINE_REASONING_INPUT =
  chunk({ role: "assistant" }) +
  chunk({ reasoning: "step one " }) +
  chunk({ reasoning: "step two" }) +
  chunk({ content: "answer" }) +
  `data: ${JSON.stringify({
    id: "chatcmpl-cline",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
  })}\n\n` +
  "data: [DONE]\n\n";

async function collect(input, makeStream) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const reader = source.pipeThrough(makeStream()).getReader();
  let seen = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  return seen;
}

describe("bare `delta.reasoning` survives the passthrough stream", () => {
  it("forwards reasoning-only chunks instead of dropping them", async () => {
    const seen = await collect(CLINE_REASONING_INPUT, () =>
      createPassthroughStreamWithLogger("cline", null, "deepseek-v4.1", "conn-1", null, null, "sk-test"),
    );

    // Both reasoning chunks must be present downstream. Before the fix the
    // output contained only the role, content and finish chunks.
    expect(seen, "reasoning chunk 1 was swallowed").toContain("step one");
    expect(seen, "reasoning chunk 2 was swallowed").toContain("step two");
    expect(seen).toContain("answer");
  });

  it("keeps `reasoning_content` working (no regression on GLM/Qwen)", async () => {
    const input =
      chunk({ role: "assistant" }) +
      chunk({ reasoning_content: "glm thinking" }) +
      chunk({ content: "ok" }) +
      "data: [DONE]\n\n";

    const seen = await collect(input, () =>
      createPassthroughStreamWithLogger("cline", null, "glm-5.3", "conn-1", null, null, "sk-test"),
    );

    expect(seen).toContain("glm thinking");
  });

  it("forwards `reasoning_details[]` too, not just the bare key", async () => {
    const input =
      chunk({ role: "assistant" }) +
      chunk({ reasoning_details: [{ text: "minimax thinking" }] }) +
      chunk({ content: "ok" }) +
      "data: [DONE]\n\n";

    const seen = await collect(input, () =>
      createPassthroughStreamWithLogger("cline", null, "minimax-m2", "conn-1", null, null, "sk-test"),
    );

    expect(seen).toContain("minimax thinking");
  });

  it("counts reasoning-only chunks toward the usage totals", async () => {
    // The reasoning chunks are real tokens. When they were dropped before the
    // accumulator ran, a stream whose only output was reasoning reported zero
    // completion tokens.
    const input =
      chunk({ role: "assistant" }) +
      chunk({ reasoning: "a".repeat(400) }) +
      chunk({ content: "hi" }) +
      `data: ${JSON.stringify({
        id: "chatcmpl-cline",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n` +
      "data: [DONE]\n\n";

    let completed = null;
    const seen = await collect(input, () =>
      createPassthroughStreamWithLogger(
        "cline", null, "deepseek-v4.1", "conn-1", null,
        (_content, usage) => { completed = usage; }, "sk-test",
      ),
    );

    expect(seen).toContain("a".repeat(400));
    // Usage is estimated from accumulated text length when upstream sends none,
    // so 400 reasoning chars + 2 content chars must be visible in the totals.
    expect(completed, "onStreamComplete never fired").not.toBeNull();
    expect(completed.completion_tokens, "reasoning tokens were not counted")
      .toBeGreaterThanOrEqual(90);
  });
});