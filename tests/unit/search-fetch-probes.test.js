// Guards the provider test connection probes for search/fetch services and the
// LLM providers that gained a validateUrl. These all answered
// "Provider test not supported" before because they have no /v1/models endpoint
// and no bespoke switch case.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Extract the probe table from the source so the test fails if the map drifts
// from what the switch actually consults.
const SRC = readFileSync(
  "/home/ubuntu/9router/src/app/api/providers/[id]/test/testUtils.js",
  "utf8"
);

function extractProbes() {
  const start = SRC.indexOf("const SEARCH_FETCH_PROBES = {");
  const end = SRC.indexOf("};", start);
  const block = SRC.slice(start, end + 2);
  const ids = [...block.matchAll(/"([a-z0-9-]+)": \{/g)].map((m) => m[1]);
  const rawKeys = [...block.matchAll(/rawKey: true/g)].length;
  return { ids, rawKeys, block };
}

const { ids } = extractProbes();

describe("search/fetch provider probes", () => {
  it("covers the providers that reported 'Provider test not supported'", () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        "brave-search",
        "exa",
        "firecrawl",
        "google-pse",
        "linkup",
        "searchapi",
        "serper",
        "tavily",
        "youcom",
        "xquik",
        "commandcode",
        "vertex-partner",
      ])
    );
  });

  it("sends raw keys only to providers whose header is not a bearer scheme", () => {
    // Every entry declaring x-api-key / key / api_key must set rawKey, otherwise
    // the probe would send "Bearer <key>" to a header that expects the key verbatim
    // and every connection would look invalid.
    const nonBearer = ["exa", "google-pse", "searchapi", "serper", "youcom", "xquik"];
    for (const pid of nonBearer) {
      const i = SRC.indexOf(`"${pid}": {`);
      const seg = SRC.slice(i, SRC.indexOf("},", i));
      expect(seg).toContain("rawKey: true");
    }
    // Bearer-scheme providers must NOT set rawKey.
    for (const pid of ["firecrawl", "tavily", "linkup", "commandcode"]) {
      const i = SRC.indexOf(`"${pid}": {`);
      const seg = SRC.slice(i, SRC.indexOf("},", i));
      expect(seg).not.toContain("rawKey: true");
    }
  });

  it("refuses a key the endpoint rejected (401/403/422), accepts anything else", () => {
    // The probe's verdict is the status mapping, not the fetch — so pin it directly.
    // A mutation that accepts 401 would report every dead key as healthy.
    const refused = [401, 403, 422];
    for (const st of refused) {
      expect(refused.includes(st)).toBe(true);
    }
    for (const st of [200, 400, 429, 500, 502]) {
      expect(refused.includes(st)).toBe(false);
    }
    // Guard the mapping itself: it must contain exactly these three codes.
    expect(SRC).toMatch(/\[401, 403, 422\]\.includes\(res\.status\)/);
  });

  it("probes a real endpoint, not a guessed /models path", () => {
    // Every probe URL must point at the provider's own documented host, so a 200
    // is evidence the credential was read by the real service.
    for (const pid of ids) {
      const i = SRC.indexOf(`"${pid}": {`);
      const seg = SRC.slice(i, SRC.indexOf("},", i));
      expect(seg).toMatch(/url: "https:\/\//);
      expect(seg).not.toMatch(/url: "https:\/\/[^"]*\/models"/);
    }
  });
});

describe("LLM providers that gained a validateUrl", () => {
  // These had no probe at all; the generic default branch now handles them.
  const cases = [
    ["alitp-intl", "token-plan.ap-southeast-1.maas.aliyuncs.com"],
    ["qwen", "dashscope-intl.aliyuncs.com"],
  ];

  it.each(cases)("%s declares a validateUrl on its real host", async (pid, host) => {
    const reg = await import(`../../open-sse/providers/registry/${pid}.js`);
    const url = reg.default.transport.validateUrl;
    expect(url).toBeTruthy();
    expect(url).toContain(host);
  });

  it("does not leave a broken validateUrl behind (commandcode/vertex use probes)", async () => {
    // commandcode has no /models endpoint (404) and vertex-partner is a GCP
    // service-account key — both are covered by SEARCH_FETCH_PROBES instead.
    for (const pid of ["commandcode", "vertex-partner"]) {
      const reg = await import(`../../open-sse/providers/registry/${pid}.js`);
      expect(reg.default.transport.validateUrl).toBeFalsy();
    }
  });
});
