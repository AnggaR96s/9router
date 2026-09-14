// Guards the streaming path against a provider that answers a streaming request with a
// buffered JSON body instead of SSE.
//
// Cline does exactly this. Its API emits a clean `data: {...}` stream when the upstream
// body carries `stream: true`, but for a buffered answer it replies with a single JSON
// document — verified live with curl for `stream:false` and for a request omitting
// `stream` entirely. That body is `{"data":{"choices":[...]}}` and carries NO `success`
// field, which mattered twice:
//
//  1. `unwrapClineEnvelope` required `success === true`, so it never matched the body the
//     API actually returns and callers forwarding through it kept the envelope.
//  2. `handleStreamingResponse` guards the SSE pipe against non-SSE content types but
//     explicitly allows `application/json` through (a JSON error body should reach the
//     client, not be swallowed). A JSON *success* body therefore reached the SSE transform
//     and was emitted verbatim — no `data:` framing, no `[DONE]` — which no
//     OpenAI-compatible client can parse.
//
// These cases pin both halves plus the envelope recogniser's boundaries.
import { describe, it, expect } from "vitest";
import { unwrapClineEnvelope } from "../../open-sse/shared/clineEnvelope.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const COMPLETION = {
  data: {
    id: "gen_test",
    model: "deepseek/deepseek-v4.1-flash",
    choices: [{ index: 0, message: { role: "assistant", content: "1, 2, 3" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 4 },
  },
};

describe("cline envelope recogniser", () => {
  it("is opted into by the cline provider", () => {
    // Nothing else here runs unless the registry still declares the quirk.
    expect(PROVIDERS["cline"]?.quirks?.clineEnvelope).toBe(true);
  });

  it("unwraps the body shape the API actually returns, which has no success field", () => {
    // This is the exact regression: the old predicate demanded `success === true` and so
    // returned the envelope untouched, leaking it to the client.
    expect(COMPLETION).not.toHaveProperty("success");
    expect(unwrapClineEnvelope(COMPLETION, "cline")).toBe(COMPLETION.data);
  });

  it("still unwraps the success-flagged variant", () => {
    const withFlag = { success: true, ...COMPLETION };
    expect(unwrapClineEnvelope(withFlag, "cline")).toBe(COMPLETION.data);
  });

  it("leaves an error envelope alone so the normal error path reports it", () => {
    const err = { success: false, error: "boom" };
    expect(unwrapClineEnvelope(err, "cline")).toBe(err);
    const dataErr = { data: { error: { message: "bad key" } } };
    expect(unwrapClineEnvelope(dataErr, "cline")).toBe(dataErr);
  });

  it("never rewrites another provider's body", () => {
    // The quirk is opt-in; a provider that did not ask for it must be untouched even when
    // its payload happens to look identical.
    expect(unwrapClineEnvelope(COMPLETION, "openai")).toBe(COMPLETION);
    expect(unwrapClineEnvelope(COMPLETION, undefined)).toBe(COMPLETION);
  });

  it("ignores non-object and array data", () => {
    for (const body of [
      null,
      undefined,
      {},
      { data: null },
      { data: "text" },
      { data: [1, 2, 3] },
    ]) {
      expect(unwrapClineEnvelope(body, "cline")).toBe(body);
    }
  });
});