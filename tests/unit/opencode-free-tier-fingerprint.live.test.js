/**
 * Live check for the OpenCode Zen free-tier fingerprint, driven through the real
 * pipeline: translateRequest() then OpenCodeExecutor.transformRequest()/buildUrl()/
 * buildHeaders(). A hand-built body would only prove the gate's rules, not that the
 * shipped code produces an accepted request.
 *
 * Measured 2026-09-18, anonymous tier (Bearer public, no key), model big-pickle on
 * /chat/completions and muse-spark-1.3-contributor-free on /responses:
 *   - client headers + session + quartet + stream:true .......... 200
 *   - any of those four missing ................................. 403 FreeTierError
 *     ("OpenCode's free tier can only be used from within OpenCode")
 *   - quartet declared in the wrong shape on /responses .......... 400 invalid_request_error
 *
 * The suite therefore also keeps a control: with the quartet and streaming removed
 * from the same translated body, the upstream must refuse — if that control ever
 * answers 200, the gate changed and the fingerprinted fields may no longer be needed.
 *
 * LIVE/NETWORK test: skipped unless OPENCODE_LIVE=1, like the other *.live.test.js.
 *
 *   OPENCODE_LIVE=1 npx vitest run tests/unit/opencode-free-tier-fingerprint.live.test.js
 */
import { describe, expect, it } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../translator/registerAll.js";

const OPENCODE_LIVE = process.env.OPENCODE_LIVE === "1";
const BUDGET_MS = 60000;

// A browser-style caller: JSON, no tools of its own — what the gateway forwarded
// when it answered 403 before this fix.
const openaiBody = {
  model: "probe",
  messages: [{ role: "user", content: "Reply with exactly: PROBE_OK" }],
  max_tokens: 32,
  stream: false,
};

const TARGETS = [
  { model: "big-pickle", format: FORMATS.OPENAI, path: "/zen/v1/chat/completions" },
  { model: "muse-spark-1.3-contributor-free", format: FORMATS.OPENAI_RESPONSES, path: "/zen/v1/responses" },
];

async function post(executor, model, body, stream) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET_MS);
  const started = Date.now();
  try {
    const res = await proxyAwareFetch(executor.buildUrl(model), {
      method: "POST",
      headers: executor.buildHeaders({}, stream),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* keep raw text for the assertion message */
    }
    return { status: res.status, json, text, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Exactly what chatCore sends upstream: translate first, then the executor shapes it. */
function pipeline(model, format) {
  const executor = new OpenCodeExecutor();
  const translated = translateRequest(FORMATS.OPENAI, format, model, { ...openaiBody, model }, true, {}, "opencode");
  const body = executor.transformRequest(model, translated, true, { connectionId: "live-probe" });
  return { executor, body };
}

describe.skipIf(!OPENCODE_LIVE)("OpenCode Zen free tier (live)", () => {
  for (const target of TARGETS) {
    it(`answers 200 on ${target.path} for ${target.model}`, async (ctx) => {
      const { executor, body } = pipeline(target.model, target.format);
      let res;
      try {
        res = await post(executor, target.model, body, true);
      } catch (e) {
        ctx.skip(`upstream silent for ${BUDGET_MS}ms (${e.name}) — not a gate reading`);
        return;
      }

      expect(executor.buildUrl(target.model)).toContain(target.path);
      expect(body.stream).toBe(true);
      expect(res.status, res.text.slice(0, 300)).toBe(200);
    }, 90000);
  }

  it("still refuses the same request once the fingerprinted fields are removed", async (ctx) => {
    const target = TARGETS[0];
    const { executor, body } = pipeline(target.model, target.format);
    // The control: keep headers/session, drop the quartet and the forced stream.
    const stripped = { ...body, tools: undefined, stream: false };

    let res;
    try {
      res = await post(executor, target.model, stripped, false);
    } catch (e) {
      ctx.skip(`upstream silent for ${BUDGET_MS}ms (${e.name})`);
      return;
    }

    expect(res.status, res.text.slice(0, 300)).toBe(403);
    expect(res.json?.error?.type).toBe("FreeTierError");
  }, 90000);
});