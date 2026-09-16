/**
 * Union Alpha Free is the only id on the OpenCode Zen catalog that is served by
 * /zen/v1/messages (Anthropic shape) instead of /chat/completions. Requests sent
 * to the Chat endpoint answer HTTP 500, which reads like a dead model, so the
 * endpoint choice has to be asserted here rather than inferred from the catalog.
 *
 * Measured live (2026-09-17): POST /zen/v1/messages with the anonymous tier
 * headers answers 200, "model":"union-alpha", "cost":"0"; a paid id on the same
 * endpoint answers 401 "Missing API key.", and big-pickle on /chat/completions
 * stays 200 — so the anonymous tier itself is healthy.
 */
import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { PROVIDER_MODELS, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const MODEL = "union-alpha";
const PROVIDER = "opencode";
const MESSAGES_URL = "https://opencode.ai/zen/v1/messages";
const CHAT_URL = "https://opencode.ai/zen/v1/chat/completions";
const RESPONSES_URL = "https://opencode.ai/zen/v1/responses";

describe("OpenCode Free Union Alpha (Anthropic Messages endpoint)", () => {
  it("is advertised with the Claude target format", () => {
    expect(PROVIDER_MODELS.oc?.some((m) => m.id === MODEL)).toBe(true);
    expect(getModelTargetFormat("oc", MODEL)).toBe(FORMATS.CLAUDE);
    // The model matrix is keyed by alias only — the provider id resolves to null
    // for every model, so assert the measured contract instead of assuming it.
    expect(PROVIDER_MODELS.opencode).toBeUndefined();
    expect(getModelTargetFormat("opencode", MODEL)).toBeNull();
    // No blanket format: the other free ids keep the Chat Completions default.
    expect(getModelTargetFormat("oc", "big-pickle")).toBeNull();
    expect(getModelTargetFormat("openrouter", MODEL)).toBeNull();
  });

  it("routes union-alpha to /zen/v1/messages and leaves the other ids alone", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl(MODEL)).toBe(MESSAGES_URL);
    expect(executor.buildUrl(`oc/${MODEL}`)).toBe(MESSAGES_URL);
    expect(executor.buildUrl(`${MODEL}(high)`)).toBe(MESSAGES_URL);

    expect(executor.buildUrl("big-pickle")).toBe(CHAT_URL);
    expect(executor.buildUrl("muse-spark-1.2-contributor-free")).toBe(RESPONSES_URL);
  });

  it("sends the anonymous tier headers on the Messages endpoint", () => {
    const headers = new OpenCodeExecutor().buildHeaders({}, true);
    expect(headers.Authorization).toBe("Bearer public");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(headers["x-opencode-session"]).toMatch(/^ses_/);
    expect(headers["x-opencode-request"]).toMatch(/^msg_/);
    expect(headers["x-opencode-project"]).toBe("global");
  });

  it("turns an OpenAI body into an Anthropic Messages body", () => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      MODEL,
      {
        model: `oc/${MODEL}`,
        messages: [{ role: "user", content: "Reply with PROBE_OK" }],
        max_tokens: 64,
        stream: false,
      },
      false,
      {},
      PROVIDER,
    );

    expect(Array.isArray(translated.messages)).toBe(true);
    expect(translated.messages[0].role).toBe("user");
    expect(translated.max_tokens).toBe(64);
    expect(translated.input).toBeUndefined();
    expect(translated.reasoning).toBeUndefined();
  });

  it("is offered by the opencode-free catalog filter", () => {
    const out = FILTERS["opencode-free"]([{ id: MODEL }, { id: "big-pickle" }, { id: "claude-fable-5" }]);
    const ids = out.map((m) => m.id);
    expect(ids).toContain(MODEL);
    expect(ids).toContain("big-pickle");
    expect(ids).not.toContain("claude-fable-5");
  });

  it("does not route the paid Anthropic ids through the free executor", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl("claude-fable-5")).toBe(CHAT_URL);
    expect(getModelTargetFormat("oc", "claude-fable-5")).toBeNull();
  });
});
