/**
 * Live repro for issue #1933: MiMo Code Free returns HTTP 502 "MiMo bootstrap failed: 403".
 * Root cause: upstream gates on Chrome-like User-Agent. Without UA → 403 "Illegal access".
 * Hits real endpoints — no mocks. Free provider, safe to call.
 *
 * LIVE/NETWORK test: skipped by default so the offline suite never touches the network.
 * Same convention as tests/translator/real/*.real.test.js (RUN_REAL) — an explicit env flag
 * gates the whole file:
 *
 *   MIMO_LIVE=1 npx vitest run tests/unit/mimo-free.live.test.js
 *
 * Status (re-measured 2026-09-16): the free channel is RETIRED, not renamed. bootstrap still
 * answers 200 with a ~1h JWT, but every chat request is refused upstream with
 * 400 {"message":"Unsupported model <id>"}. 28 candidate ids probed this session, all refused
 * (mimo-auto, auto, mimo-auto-free, mimo-code, mimo-v2, mimoclaw, mimo-v2.5, mimo-v2.5-pro,
 * mimo-v2-flash, mimo-v2-pro, mimo-v2-omni, mimo-v2.5-pro-ultraspeed, MiMo-V2-Flash,
 * mimo-auto-v2, mimocode, MiMoCode, mimo-auto-pro, mimo-2.5, mimo-code-agent, mimoagent,
 * mimo-free, mimo-v2.5-free, mimo-v2.5-pro-free, mimo-v2-pro-free, mimo-v2-omni-free,
 * mimo-v2-flash-free, xiaomi-mimo-v2.5-free, and a request with no model field → the literal
 * id "unknown-model"); model-list paths answer 403 "Illegal access" or 400 param
 * "404 NOT_FOUND". So the anti-abuse chat assertion is red even when the flag is on.
 *
 * Authoritative source for the id — there is NO id drift: the official Xiaomi CLI ships
 * packages/opencode/src/util/free-api-sunset.ts (github.com/XiaomiMiMo/MiMo-Code):
 *   FREE_API_SUNSET_AT = Date.parse("2026-07-26T10:00:00.000Z")
 *   isFreeApiModel = (m) => m?.providerID === "mimo" && m.modelID === "mimo-auto"
 * and @mimo-ai/cli 0.1.14 (published 2026-09-02) hard-fails that model with
 * "MiMo free API service has ended. Sign in or configure a third-party API."
 * i.e. "mimo-auto" is still the channel's only id; the upstream 400 IS the sunset.
 * Registry therefore stays hidden:true — do not "fix" this by renaming the model.
 */
import { describe, it, expect } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { __test__ } from "../../open-sse/executors/mimo-free.js";

const MIMO_LIVE = process.env.MIMO_LIVE === "1";

const { BOOTSTRAP_URL, CHAT_URL, generateFingerprint, MIMO_SYSTEM_MARKER } = __test__;

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bootstrapWith(ua) {
  const headers = { "Content-Type": "application/json" };
  if (ua) headers["User-Agent"] = ua;
  const r = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ client: generateFingerprint() }),
  });
  const data = await r.json();
  return { status: r.status, jwt: data.jwt };
}

async function chatWith(jwt, ua) {
  const headers = {
    "Content-Type": "application/json",
    "X-Mimo-Source": "mimocode-cli-free",
    Authorization: `Bearer ${jwt}`,
    Accept: "application/json",
  };
  if (ua) headers["User-Agent"] = ua;
  const body = {
    model: "mimo-auto",
    messages: [
      { role: "system", content: MIMO_SYSTEM_MARKER },
      { role: "user", content: "hi" },
    ],
    stream: false,
  };
  return proxyAwareFetch(CHAT_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

describe.skipIf(!MIMO_LIVE)("MiMo Free bootstrap (live)", () => {
  it("bootstrap returns 200 with JWT", async () => {
    const { status, jwt } = await bootstrapWith(CHROME_UA);
    expect(status).toBe(200);
    expect(jwt).toBeTruthy();
  });
});

describe.skipIf(!MIMO_LIVE)("MiMo Free anti-abuse gate (live)", () => {
  it("chat WITH Chrome User-Agent → 200", async () => {
    const { jwt } = await bootstrapWith(CHROME_UA);
    const r = await chatWith(jwt, CHROME_UA);
    expect(r.status).toBe(200);
  });
});
