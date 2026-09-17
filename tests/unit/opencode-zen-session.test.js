/**
 * OpenCode Zen's anonymous tier gates on client identity: a session id whose shape
 * does not match the client's own generator is refused with
 * "OpenCode's free tier can only be used from within OpenCode" (HTTP 403).
 *
 * Measured live 2026-09-17 against /zen/v1/chat/completions (model big-pickle):
 *   - bare "User-Agent: opencode" .................. 403, even with a valid session
 *   - "opencode/1.18.31" ........................... 200
 *   - session "ses_" + 12 hex + 14 base62 .......... 200 (timestamp irrelevant:
 *                                                     random hex passed too)
 *   - session "ses_" + 32 hex (our own uuid form) .. 403
 *
 * So the gateway must speak the client's own id format. It does not need -- and must
 * not depend on -- any captured value.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const CLIENT_UA = "opencode/1.20.0";
const CLIENT_SESSION = "ses_f533881baffelq5BDFCY3Pqsag";
const ZEN_ID = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const LEGACY_ID = /^ses_[0-9a-f]{32}$/;

const CONVERSATION = "ses_9f1c4d2ae5b74618a3c0ff21de5b7a44";

function headersWith(rawHeaders = {}, conversationId = CONVERSATION) {
  const executor = new OpenCodeExecutor();
  executor._currentSessionId = conversationId;
  return executor.buildHeaders({ rawHeaders, connectionId: "opencode-free" }, false);
}

describe("OpenCode free-tier client identity", () => {
  const savedSeed = process.env.OPENCODE_ZEN_SESSION_SEED;

  beforeEach(() => {
    // A leftover seed must not influence anything: the gateway speaks the client format.
    process.env.OPENCODE_ZEN_SESSION_SEED = "ses_f532f0c01ffeePGWZyfXNG60tz";
  });

  afterEach(() => {
    if (savedSeed === undefined) delete process.env.OPENCODE_ZEN_SESSION_SEED;
    else process.env.OPENCODE_ZEN_SESSION_SEED = savedSeed;
  });

  it("sends a versioned client User-Agent", () => {
    expect(headersWith()["User-Agent"]).toMatch(/^opencode\/\d+\.\d+\.\d+$/);
  });

  it("does not forward a version-less opencode User-Agent", () => {
    expect(headersWith({ "user-agent": "opencode" })["User-Agent"]).toMatch(/^opencode\/\d+\.\d+\.\d+$/);
  });

  it("forwards the User-Agent of a real client", () => {
    expect(headersWith({ "user-agent": CLIENT_UA })["User-Agent"]).toBe(CLIENT_UA);
  });

  it("mints the session id in the client's own format", () => {
    const session = headersWith()["x-opencode-session"];
    expect(session).toMatch(ZEN_ID);
    expect(session).toHaveLength(30);
  });

  it("mints a fresh client-shaped id even if a caller hands over our legacy uuid id", () => {
    const session = headersWith({ "x-opencode-session": "ses_" + "0".repeat(32) })["x-opencode-session"];
    expect(session).toMatch(ZEN_ID);
    expect(session).not.toMatch(LEGACY_ID);
  });

  it("forwards a session id that is already in the client's format", () => {
    expect(headersWith({ "x-opencode-session": CLIENT_SESSION })["x-opencode-session"]).toBe(CLIENT_SESSION);
  });

  it("keeps one session per conversation and separates different conversations", () => {
    const first = headersWith()["x-opencode-session"];
    const again = headersWith()["x-opencode-session"];
    const other = headersWith({}, "ses_4d0a71c9ffbe41d6b28e5c7a9013fd2b")["x-opencode-session"];
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });
});
