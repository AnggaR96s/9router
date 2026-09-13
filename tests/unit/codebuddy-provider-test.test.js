import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyOAuthProbeResult } from "@/app/api/providers/[id]/test/testUtils.js";

// CodeBuddy came in two flavours of the same defect, and both were silent:
//
//   codebuddy-intl  had NO entry in OAUTH_TEST_CONFIG at all, so "Test
//                   connection" answered "Provider test not supported".
//   codebuddy-cn    was configured as `{ tokenExists: true }`, a stub that
//                   reports success for any non-empty string. That never fails,
//                   which means an expired or revoked login still reads as a
//                   healthy connection — worse than the loud error, because
//                   nothing tells you the credential is dead.
//
// Both now probe the billing meter, which is a real credential check. These
// cases lock the properties that make it one: 200 accepted, 401 rejected, and
// no acceptStatuses entry that would let a failure masquerade as success.
//
// The live HTTP behaviour is asserted separately (see LIVE probe below) because
// whether the endpoint discriminates is a fact about the provider, not about our
// code — and a mocked fetch would happily "pass" either way.

// Mirrors the shipped config; kept inline so a regression in the real table is
// caught by the shape assertions rather than by this copy drifting with it.
const CODEBUDDY_PROBE = {
  url: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
  method: "POST",
  refreshable: true,
};

const res = (status) => ({ status, ok: status >= 200 && status < 300 });

describe("CodeBuddy test-connection classification", () => {
  it("accepts a 200 from the billing meter", () => {
    const r = classifyOAuthProbeResult(res(200), CODEBUDDY_PROBE, "");
    expect(r.valid).toBe(true);
    expect(r.soft).toBe(false);
  });

  it("rejects a 401 as an invalid token rather than treating it as success", () => {
    const r = classifyOAuthProbeResult(res(401), CODEBUDDY_PROBE, "<html>401</html>");
    expect(r.valid).toBe(false);
    expect(r.error).toBe("Token invalid or revoked");
  });

  it("rejects 403 and other non-2xx statuses", () => {
    expect(classifyOAuthProbeResult(res(403), CODEBUDDY_PROBE, "").valid).toBe(false);
    expect(classifyOAuthProbeResult(res(500), CODEBUDDY_PROBE, "").valid).toBe(false);
    expect(classifyOAuthProbeResult(res(404), CODEBUDDY_PROBE, "").valid).toBe(false);
  });

  it("never marks a non-2xx a soft success", () => {
    // soft success needs an explicit acceptStatuses entry; the CodeBuddy probe
    // must not carry one, or a 401 could render as a warning instead of an error.
    expect(CODEBUDDY_PROBE.acceptStatuses).toBeUndefined();
    for (const s of [400, 401, 403, 404, 429, 500]) {
      const r = classifyOAuthProbeResult(res(s), CODEBUDDY_PROBE, "");
      expect(r.valid, `status ${s} must not pass`).toBe(false);
      expect(r.soft).toBe(false);
    }
  });
});

describe("CodeBuddy entries exist for both variants", async () => {
  // Guards the "Provider test not supported" failure directly: that message is
  // emitted only when OAUTH_TEST_CONFIG has no entry for the provider.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(
      new URL("../../src/app/api/providers/[id]/test/testUtils.js", import.meta.url),
      "utf8",
    ),
  );

  const entryFor = (id) => {
    const start = src.indexOf(`"${id}": {`);
    expect(start, `${id} has no OAUTH_TEST_CONFIG entry`).toBeGreaterThan(-1);
    // Stop at the next top-level entry key.
    const rest = src.slice(start);
    const next = rest.slice(1).search(/\n  (?:"[a-z0-9-]+"|[a-z][a-z0-9]*): \{|\n  \};/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };

  for (const id of ["codebuddy-cn", "codebuddy-intl"]) {
    it(`${id} is configured with a real probe, not the tokenExists stub`, () => {
      const entry = entryFor(id);
      expect(entry).toMatch(/https:\/\//);          // has a URL to hit
      expect(entry).toMatch(/method: "POST"/);      // GET returns 404 here
      expect(entry).toMatch(/authHeader:/);
      expect(entry).not.toMatch(/tokenExists/);     // the stub must be gone
      expect(entry).toMatch(/refreshable: true/);   // 401 can be retried
    });
  }
});

// Live probe — skipped unless a token is supplied, because the point of these
// cases is what the PROVIDER does, which no mock can establish:
//   COHERE_API_KEY-style: CODEBUDDY_TOKEN=ey... npx vitest run <this file>
describe("CodeBuddy billing meter discriminates credentials (live)", () => {
  const TOKEN = process.env.CODEBUDDY_TOKEN || "";
  const URL_ = "https://www.codebuddy.ai/v2/billing/meter/get-user-resource";

  const call = (token) =>
    fetch(URL_, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
        "X-Product": "SaaS",
        "X-IDE-Type": "CLI",
        "x-codebuddy-request": "1",
      },
      body: "{}",
    });

  it.runIf(TOKEN)("answers 200 for the real token", async () => {
    const r = await call(TOKEN);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.code).toBe(0);
  }, 30_000);

  it.runIf(TOKEN)("answers 401 for a junk token (so a 200 means something)", async () => {
    const r = await call("not-a-real-token");
    expect(r.status).toBe(401);
  }, 30_000);
});
