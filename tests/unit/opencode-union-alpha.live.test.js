/**
 * Live check for the OpenCode Zen free tier, driven through the real executor
 * URL/headers: if the routing in open-sse/executors/opencode.js regresses,
 * union-alpha is posted to /chat/completions and the upstream answers HTTP 500
 * ("Internal server error"), which reads like a dead model.
 *
 * Measured 2026-09-17, anonymous tier, no API key:
 *   POST /zen/v1/messages          "union-alpha"    -> 200, model echo, cost "0"
 *   POST /zen/v1/chat/completions  "union-alpha"    -> 500 (sent there directly)
 *   POST /zen/v1/messages          "claude-fable-5" -> 401 AuthError (paid id)
 *   POST /zen/v1/chat/completions  "big-pickle"     -> 200
 *
 * union-alpha answers SLOWLY on the free tier rather than not at all: the gateway's
 * own requestDetails rows for opencode/union-alpha (2026-09-16T20:17Z and 20:19Z,
 * status "success", connectionId null = this same anonymous tier) record
 * time-to-first-token of 58.5s and 239.9s. A short budget therefore aborts with
 * "The operation was aborted due to timeout" and reads as a dead model, so the
 * success check carries a 5 minute budget and SKIPS (never fails) when the upstream
 * returns nothing at all — silence is not routing evidence. A wrong endpoint answers
 * 500 quickly and still fails the suite. Routing and format are pinned offline by
 * tests/unit/opencode-union-alpha-messages.test.js.
 *
 * LIVE/NETWORK test: skipped unless OPENCODE_LIVE=1 (same convention as
 * other *.live.test.js files) so the offline suite never hits the network.
 *
 *   OPENCODE_LIVE=1 npx vitest run tests/unit/opencode-union-alpha.live.test.js
 */
import { describe, expect, it } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../translator/registerAll.js";

const OPENCODE_LIVE = process.env.OPENCODE_LIVE === "1";
const MODEL = "union-alpha";
// The free tier answers slowly (see the header): the gateway's own requestDetails
// rows for this id record 58.5s and 239.9s time-to-first-token, so a short budget
// aborts and reads as a dead model.
const BUDGET_MS = 15000;
// A wrong endpoint answers 500 in well under a second when the tier is healthy.
const CHAT_FAIL_BUDGET_MS = 60000;
const SLOW_BUDGET_MS = 300000;

const openaiBody = {
  model: `oc/${MODEL}`,
  messages: [{ role: "user", content: "Reply with exactly: PROBE_OK" }],
  max_tokens: 64,
  stream: false,
};

const CHAT_URL = "https://opencode.ai/zen/v1/chat/completions";

async function call(model, body, targetFormat, timeoutMs, urlOverride) {
  const executor = new OpenCodeExecutor();
  const url = urlOverride || executor.buildUrl(model);
  const headers = executor.buildHeaders({}, false);
  // The runtime hands upstream a bare id (chatCore strips the provider prefix);
  // sending "oc/union-alpha" upstream is refused with a ModelError.
  const bare = String(model).replace(/\([^()]+\)\s*$/, "").split("/").pop();
  const upstreamBody = { ...body, model: bare };
  const payload = targetFormat
    ? translateRequest(FORMATS.OPENAI, targetFormat, bare, upstreamBody, false, {}, "opencode")
    : upstreamBody;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* keep raw text for the assertion message */
    }
    return { url, status: res.status, json, text, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!OPENCODE_LIVE)("OpenCode Zen Union Alpha (live)", () => {
  it("refuses the paid ids on the anonymous tier", async () => {
    const paid = await call(
      "claude-fable-5",
      { ...openaiBody, model: "oc/claude-fable-5" },
      FORMATS.CLAUDE,
      BUDGET_MS,
    );
    expect(paid.status).toBe(401);
    expect(paid.json?.error?.type).toBe("AuthError");
  }, 60000);

  it("documents the Chat Completions failure the routing avoids", async (ctx) => {
    let r;
    try {
      // Sent to that URL directly: the executor no longer routes this id there,
      // which is the point — the route is what turns this 500 into an answer.
      r = await call(MODEL, openaiBody, FORMATS.OPENAI, CHAT_FAIL_BUDGET_MS, CHAT_URL);
    } catch (e) {
      // A wrong endpoint answers 500 fast; only real silence lands here.
      ctx.skip(`upstream silent for ${CHAT_FAIL_BUDGET_MS}ms (${e.name}) — cannot judge routing`);
      return;
    }
    expect(r.url).toBe(CHAT_URL);
    expect(r.status, r.text.slice(0, 200)).toBe(500);
  }, 60000);

  it("answers on the endpoint the executor picks, at zero cost", async (ctx) => {
    let r;
    try {
      r = await call(MODEL, openaiBody, FORMATS.CLAUDE, SLOW_BUDGET_MS);
    } catch (e) {
      // Time-to-first-token on this tier has been measured at 58.5s and 239.9s, so
      // an aborted run here is the model being slow, not the route being wrong.
      ctx.skip(`upstream silent for ${SLOW_BUDGET_MS}ms (${e.name}) — free tier is not answering`);
      return;
    }
    expect(r.url).toBe("https://opencode.ai/zen/v1/messages");
    expect(r.status, r.text.slice(0, 200)).toBe(200);
    expect(r.json?.model).toBe(MODEL);
    expect(r.json?.cost).toBe("0");
    expect(r.json?.content?.[0]?.text).toContain("PROBE_OK");
  }, 360000);
});
