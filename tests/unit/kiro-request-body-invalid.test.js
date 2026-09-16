import { describe, it, expect } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

/**
 * Two Kiro defects, both reproduced live against
 * runtime.us-east-1.kiro.dev/generateAssistantResponse.
 *
 * 1. Top-level `systemPrompt`. CodeWhisperer answers ANY payload carrying that
 *    field with 400 {"message":"Improperly formed request.",
 *    "reason":"REQUEST_BODY_INVALID"} — verified by sending the byte-identical
 *    payload with and without it (200 vs 400). The router sets it whenever the
 *    turn carries system text: a client `system` message, the `-thinking` budget
 *    prefix, or the `-agentic` prompt. So every real harness 400'd on its first
 *    turn while a bare "hello" still worked, and the per-account 429/error
 *    bookkeeping cooled the connection down after the retries.
 *
 *    Nothing is lost by dropping it: the same text already reaches the model
 *    through `contentPrefix`, which applyKiroSessionReplay folds into the
 *    session-start user message.
 *
 * 2. Region rewriting. The registry baseUrls are hardcoded us-east-1, so an
 *    account homed elsewhere must be pointed at the regional hosts. The current
 *    contract (see getOrderedBaseUrls) regionalizes every *.amazonaws.com
 *    surface and puts the regional Amazon Q host `q.<region>.amazonaws.com`
 *    first: the deprecated kiro.dev path gateway answers valid modern payloads
 *    with a terminal 400 REQUEST_BODY_INVALID, while a foreign region on an
 *    Amazon surface fails with 401/403, which DO fall through to the next
 *    surface.
 */
const CREDENTIALS = {
  providerSpecificData: {
    authMethod: "social",
    profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/TEST",
  },
};

function openaiBody(overrides = {}) {
  return {
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "hi" },
    ],
    ...overrides,
  };
}

describe("Kiro payload omits the top-level systemPrompt (REQUEST_BODY_INVALID)", () => {
  it("openai -> kiro drops it while keeping the system text in the message content", () => {
    const payload = openaiToKiroRequest(
      "claude-opus-5-thinking-agentic",
      openaiBody(),
      true,
      CREDENTIALS
    );

    expect(payload).not.toHaveProperty("systemPrompt");

    // The directive still has to reach the model, otherwise thinking silently
    // turns off — assert the delivery path rather than just the absence.
    const content = payload.conversationState.currentMessage.userInputMessage.content;
    expect(content).toContain("<thinking_mode>");
    expect(content).toContain("[Context: Current time is");
  });

  it("claude -> kiro drops it too", () => {
    const payload = claudeToKiroRequest(
      "claude-opus-5-thinking-agentic",
      {
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "hi" }],
      },
      true,
      CREDENTIALS
    );

    expect(payload).not.toHaveProperty("systemPrompt");
    expect(
      payload.conversationState.currentMessage.userInputMessage.content
    ).toContain("<thinking_mode>");
  });

  it("stays absent for a plain turn that carries no system text at all", () => {
    const payload = openaiToKiroRequest(
      "claude-sonnet-4.5",
      { messages: [{ role: "user", content: "hi" }] },
      true,
      CREDENTIALS
    );
    expect(payload).not.toHaveProperty("systemPrompt");
  });

  it("keeps the fields CodeWhisperer does accept", () => {
    const credentials = {
      ...CREDENTIALS,
      connectionId: "kiro-account-body-invalid",
      rawHeaders: { "x-session-id": "hermes-session-body-invalid" },
    };
    const payload = openaiToKiroRequest("claude-sonnet-4.5", openaiBody(), true, credentials);

    // conversationId is what lets Kiro reuse an agent session across turns
    // (the upstream agentContinuationId field is intentionally gone from the
    // wire shape — see kiro-minimal-wire-payload.test.js); dropping it makes
    // every turn look like a fresh conversation and re-bills the whole
    // history, so guard the session identity here, exactly as resolved.
    expect(payload.conversationState.conversationId).toBe("hermes-session-body-invalid");
    expect(payload.conversationState).not.toHaveProperty("agentContinuationId");
    expect(payload.conversationState.chatTriggerType).toBe("MANUAL");
    expect(payload.profileArn).toBe(CREDENTIALS.providerSpecificData.profileArn);
  });
});

describe("KiroExecutor.getOrderedBaseUrls — non-us-east-1 uses the regional Amazon Q host", () => {
  const executor = new KiroExecutor();
  const RUNTIME = "https://runtime.us-east-1.kiro.dev/generateAssistantResponse";
  const qHost = (region) => `https://q.${region}.amazonaws.com/generateAssistantResponse`;
  const codeWhispererHost = (region) =>
    `https://codewhisperer.${region}.amazonaws.com/generateAssistantResponse`;

  it("routes an eu-central-1 IdC account to q.<region> first", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "eu-central-1" },
    });

    expect(urls).toEqual([qHost("eu-central-1"), codeWhispererHost("eu-central-1"), RUNTIME]);
  });

  it("regionalizes every amazonaws surface and keeps q.<region> first", () => {
    for (const region of ["eu-central-1", "eu-west-1", "us-west-2", "ap-northeast-1"]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod: "idc", region },
      });
      expect(urls).toEqual([qHost(region), codeWhispererHost(region), RUNTIME]);
      // The deprecated kiro.dev path gateway must never be tried first: it
      // answers valid modern payloads with a terminal 400 REQUEST_BODY_INVALID.
      expect(urls[0]).not.toContain("kiro.dev");
    }
  });

  it("applies regardless of auth method, since the region binds the endpoint", () => {
    for (const authMethod of ["idc", "api_key", "external_idp", "social", undefined]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod, region: "eu-central-1" },
      });
      expect(urls).toEqual([qHost("eu-central-1"), codeWhispererHost("eu-central-1"), RUNTIME]);
    }
  });

  it("leaves us-east-1, an unset region and blank whitespace on the registry hosts", () => {
    const baseUrls = executor.getBaseUrls();
    for (const region of ["us-east-1", undefined, "   "]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod: "social", region },
      });
      // Same hosts as the registry — no region is interpolated — only the
      // ordering changes so the Amazon Q surface is tried first.
      expect([...urls].sort()).toEqual([...baseUrls].sort());
      expect(urls[0]).toBe(qHost("us-east-1"));
    }
  });

  it("still puts an amazonaws surface first for us-east-1 api-key auth", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "api_key" },
    });
    expect(urls[0]).toBe(qHost("us-east-1"));
  });

  it("trims a padded region before interpolating it into the host", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "  eu-central-1  " },
    });
    expect(urls).toEqual([qHost("eu-central-1"), codeWhispererHost("eu-central-1"), RUNTIME]);
  });
});
