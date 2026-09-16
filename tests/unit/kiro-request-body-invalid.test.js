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
 *    contract (see getOrderedBaseUrls) regionalises a *.amazonaws.com surface
 *    ONLY when the regionalised host actually exists in DNS, and puts the
 *    regional Amazon Q host `q.<region>.amazonaws.com` first where it does:
 *    the deprecated kiro.dev path gateway answers valid modern payloads with a
 *    terminal 400 REQUEST_BODY_INVALID, while a foreign region on an Amazon
 *    surface fails with 401/403, which DO fall through to the next surface.
 *    MEASURED 2026-09-16: only q.us-east-1, codewhisperer.us-east-1 and
 *    q.eu-central-1 exist; codewhisperer.eu-central-1 and both families in
 *    every other region tested are NXDOMAIN. The previous "regionalise
 *    everything" contract therefore emitted two unusable hosts first, and
 *    because BaseExecutor retries a DNS failure on the 502 config (3 x 3000ms)
 *    that cost a measured 21.4s per request for an eu-west-1 credential
 *    against 1.0s for us-east-1 — see the getOrderedBaseUrls block below.
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

// MEASURED 2026-09-16 (dig @8.8.8.8 / @1.1.1.1, dig +trace against the zone's
// own Route 53 nameservers, then an unauthenticated POST to
// /generateAssistantResponse against each surviving host):
//   q.us-east-1.amazonaws.com, codewhisperer.us-east-1.amazonaws.com -> NOERROR, 400 REQUEST_BODY_INVALID
//   q.eu-central-1.amazonaws.com                                    -> NOERROR, 400 REQUEST_BODY_INVALID
//   codewhisperer.eu-central-1.amazonaws.com                        -> NXDOMAIN (no host at all)
//   q.<region> and codewhisperer.<region> for eu-west-1, eu-west-2/3, eu-north-1,
//   eu-south-1, us-east-2, us-west-1/2, ca-central-1, ap-south-1,
//   ap-northeast-1/2/3, ap-southeast-1/2, ap-east-1, sa-east-1, me-*,
//   af-south-1, il-central-1                                        -> NXDOMAIN
// A host with no DNS record is worse than absent: BaseExecutor maps the DNS
// failure to the 502 retry config (3 attempts x 3000ms), measured 21.4s end to
// end for an eu-west-1 credential vs 1.0s for us-east-1, both ending on the
// same working surface. So the emitted fallback list must contain only hosts
// that can actually answer.
describe("KiroExecutor.getOrderedBaseUrls — keeps only amazonaws surfaces that exist", () => {
  const executor = new KiroExecutor();
  const RUNTIME = "https://runtime.us-east-1.kiro.dev/generateAssistantResponse";
  const qHost = (region) => `https://q.${region}.amazonaws.com/generateAssistantResponse`;
  const codeWhispererHost = (region) =>
    `https://codewhisperer.${region}.amazonaws.com/generateAssistantResponse`;

  it("routes an eu-central-1 IdC account to the regional Amazon Q host and a live codewhisperer peer", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "eu-central-1" },
    });

    // q.eu-central-1 exists; codewhisperer.eu-central-1 does not, so the
    // CodeWhisperer slot falls back to the us-east-1 host the registry ships.
    expect(urls).toEqual([qHost("eu-central-1"), codeWhispererHost("us-east-1"), RUNTIME]);
  });

  it("keeps q first and never emits a regionalised host that has no DNS record", () => {
    // Each of these answered NXDOMAIN from the zone's own nameservers, so a
    // request to them fails with "Could not resolve host" before any auth
    // check — they can never succeed and only cost the 502 retry delay.
    const deadHosts = new Set([
      "codewhisperer.eu-central-1.amazonaws.com",
      "q.eu-west-1.amazonaws.com",
      "codewhisperer.eu-west-1.amazonaws.com",
      "q.us-west-2.amazonaws.com",
      "codewhisperer.us-west-2.amazonaws.com",
      "q.ap-northeast-1.amazonaws.com",
      "codewhisperer.ap-northeast-1.amazonaws.com",
      "q.ap-southeast-1.amazonaws.com",
      "codewhisperer.ap-southeast-1.amazonaws.com",
    ]);
    for (const region of ["eu-central-1", "eu-west-1", "us-west-2", "ap-northeast-1"]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod: "idc", region },
      });
      for (const url of urls) expect(deadHosts.has(new URL(url).host)).toBe(false);
      // The live amazonaws surfaces still come first: the deprecated kiro.dev
      // path gateway must never be tried first, since it answers valid modern
      // payloads with a terminal 400 REQUEST_BODY_INVALID.
      expect(urls[0]).not.toContain("kiro.dev");
      expect(urls[0].startsWith("https://q.")).toBe(true);
      expect(urls[urls.length - 1]).toBe(RUNTIME);
    }
  });

  it("falls back to the us-east-1 amazonaws surfaces for a region with no Q endpoint", () => {
    for (const region of ["eu-west-1", "us-west-2", "ap-northeast-1", "ap-southeast-1"]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod: "idc", region },
      });
      expect(urls).toEqual([qHost("us-east-1"), codeWhispererHost("us-east-1"), RUNTIME]);
    }
  });

  it("applies regardless of auth method, since the region binds the endpoint", () => {
    for (const authMethod of ["idc", "api_key", "external_idp", "social", undefined]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod, region: "eu-central-1" },
      });
      expect(urls).toEqual([qHost("eu-central-1"), codeWhispererHost("us-east-1"), RUNTIME]);
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
    expect(urls).toEqual([qHost("eu-central-1"), codeWhispererHost("us-east-1"), RUNTIME]);
  });
});
