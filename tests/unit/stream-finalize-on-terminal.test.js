// Streaming usage must be recorded even when the client hangs up right after the
// terminal event.
//
// Root cause this pins: finalizeStream() (the only place that logs usage and calls
// onStreamComplete) lived exclusively in flush(). stream.js even documents the
// hazard: "a client that closes right after the terminal event cancels the reader,
// and flush() never runs." When that happens the request detail row keeps the
// placeholder written at stream start — tokens {0,0}, providerResponse
// "[Streaming - raw response not captured]" — and the tokens are never counted.
//
// Observed in production before this fix: 391 of 500 consecutive tokenharbor
// request-detail rows sat on that placeholder (78%), i.e. the dashboard totals for
// that provider were missing roughly three quarters of all tokens.
//
// The fix finalizes as soon as a terminal marker is seen (the [DONE] sentinel, or a
// finish chunk), not only on flush. finalizeStream() is already idempotent via its
// `finalized` guard, so finalizing early cannot double count.

import { describe, expect, it, vi, beforeEach } from "vitest";

const appendRequestLog = vi.fn(async () => {});
const trackPendingRequest = vi.fn();

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: (...args) => appendRequestLog(...args),
  trackPendingRequest: (...args) => trackPendingRequest(...args),
}));

let createSSETransformStreamWithLogger;
let createPassthroughStreamWithLogger;
let FORMATS;

beforeEach(async () => {
  vi.resetModules();
  appendRequestLog.mockClear();
  trackPendingRequest.mockClear();
  ({ createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } = await import(
    "../../open-sse/utils/stream.js"
  ));
  ({ FORMATS } = await import("../../open-sse/translator/formats.js"));
});

const OPENAI_FINISH_CHUNK = (usage) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage,
  })}\n\n`;

const OPENAI_TEXT_CHUNK = (text) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: text } }],
  })}\n\n`;

const USAGE = { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 };

/**
 * Feed `input` through the stream, then CANCEL the reader as soon as `stopMarker`
 * has been observed in the output — this is the client-disconnects-right-after-
 * the-terminal-event case that skips flush(). Resolves to the completed usage
 * handed to onStreamComplete, or null if it never fired.
 */
async function runUntilMarker(makeStream, input, stopMarker, body = null) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let completed = null;
  const onStreamComplete = (_content, usage) => {
    completed = usage || "CALLED_WITHOUT_USAGE";
  };

  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const transformed = source.pipeThrough(
    makeStream(onStreamComplete, body),
  );

  const reader = transformed.getReader();
  let seen = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      if (stopMarker && seen.includes(stopMarker)) {
        // Client got what it needed and went away: no flush() for this stream.
        await reader.cancel();
        break;
      }
    }
  } catch {
    // cancellation surfaces as a stream error in some runtimes — irrelevant here
  }
  await new Promise((r) => setTimeout(r, 20));
  return completed;
}

describe("streaming usage survives a client that disconnects right after [DONE]", () => {
  it("translate mode: records usage when the reader is cancelled at [DONE]", async () => {
    const input =
      OPENAI_TEXT_CHUNK("Hello") + OPENAI_FINISH_CHUNK(USAGE) + "data: [DONE]\n\n";

    const usage = await runUntilMarker(
      (cb, body) =>
        createSSETransformStreamWithLogger(
          FORMATS.OPENAI, FORMATS.OPENAI, "tokenharbor", null, null,
          "deepseek-v4.1-flash:free", "conn-1", body, cb, "sk-test",
        ),
      input,
      "data: [DONE]",
    );

    expect(usage, "onStreamComplete never fired — tokens would be lost").not.toBeNull();
    expect(usage).toMatchObject({ prompt_tokens: 1234, completion_tokens: 56 });
  });

  it("passthrough mode: records usage when the reader is cancelled at [DONE]", async () => {
    const input =
      OPENAI_TEXT_CHUNK("Hello") + OPENAI_FINISH_CHUNK(USAGE) + "data: [DONE]\n\n";

    const usage = await runUntilMarker(
      (cb) => createPassthroughStreamWithLogger("tokenharbor", null, "deepseek-v4.1-flash:free", "conn-1", null, cb, "sk-test"),
      input,
      "data: [DONE]",
    );

    expect(usage, "onStreamComplete never fired — tokens would be lost").not.toBeNull();
    expect(usage).toMatchObject({ prompt_tokens: 1234, completion_tokens: 56 });
  });

  it("translate mode: records usage when the reader stops at the finish chunk (no [DONE] seen)", async () => {
    const input = OPENAI_TEXT_CHUNK("Hello") + OPENAI_FINISH_CHUNK(USAGE);

    const usage = await runUntilMarker(
      (cb) =>
        createSSETransformStreamWithLogger(
          FORMATS.OPENAI, FORMATS.OPENAI, "tokenharbor", null, null,
          "deepseek-v4.1-flash:free", "conn-1", null, cb, "sk-test",
        ),
      input,
      '"finish_reason":"stop"',
    );

    expect(usage, "onStreamComplete never fired for a cleanly finished stream").not.toBeNull();
    expect(usage).toMatchObject({ prompt_tokens: 1234 });
  });

  it("still finalizes exactly once when the stream completes normally (no double count)", async () => {
    let calls = 0;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            OPENAI_TEXT_CHUNK("Hello") + OPENAI_FINISH_CHUNK(USAGE) + "data: [DONE]\n\n",
          ),
        );
        controller.close();
      },
    });

    const stream = source.pipeThrough(
      createSSETransformStreamWithLogger(
        FORMATS.OPENAI, FORMATS.OPENAI, "tokenharbor", null, null,
        "deepseek-v4.1-flash:free", "conn-1", null,
        () => { calls += 1; },
        "sk-test",
      ),
    );

    const reader = stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(calls, "usage must be recorded once, not once per finalize path").toBe(1);
  });

  it("records usage when the client aborts mid-stream (no terminal event at all)", async () => {
    // The reader is cancelled before the stream ever ends. Node calls the transformer's
    // cancel() and NOT flush() (verified), so without a cancel handler the accumulated
    // usage is dropped and the placeholder row stays at zero forever.
    const encoder = new TextEncoder();
    let completed = null;

    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(OPENAI_TEXT_CHUNK("Hello there")));
        // deliberately never closed: simulates a provider still streaming
      },
    });

    const stream = source.pipeThrough(
      createSSETransformStreamWithLogger(
        FORMATS.OPENAI, FORMATS.OPENAI, "tokenharbor", null, null,
        "deepseek-v4.1-flash:free", "conn-1",
        { messages: [{ role: "user", content: "hi" }] },
        (_c, usage) => { completed = usage || "CALLED_WITHOUT_USAGE"; },
        "sk-test",
      ),
    );

    const reader = stream.getReader();
    await reader.read();
    await reader.cancel("client went away");
    await new Promise((r) => setTimeout(r, 20));

    expect(completed, "aborted stream lost its usage entirely").not.toBeNull();
  });

  it("records an estimated usage tail when the provider sends no usage at all", async () => {
    const input =
      OPENAI_TEXT_CHUNK("a fairly long piece of content to estimate from") + "data: [DONE]\n\n";

    const usage = await runUntilMarker(
      (cb) =>
        createSSETransformStreamWithLogger(
          FORMATS.OPENAI, FORMATS.OPENAI, "tokenharbor", null, null,
          "deepseek-v4.1-flash:free", "conn-1",
          { messages: [{ role: "user", content: "hi" }] }, cb, "sk-test",
        ),
      input,
      "data: [DONE]",
    );

    expect(usage, "a stream with no provider usage still has to be recorded").not.toBeNull();
    expect(usage.estimated).toBe(true);
  });
});
