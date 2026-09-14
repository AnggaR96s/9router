import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";

// Cline's access token must reach the API as `Bearer workos:<jwt>`. buildClineHeaders
// produces exactly that, and the registry wires it in as an auth hook — so the hook
// has to run AFTER applyAuth. It ran BEFORE, which meant applyAuth overwrote the
// prefixed value with the raw token and every chat request answered:
//
//   401 {"error":"Unauthorized: Please make sure you're using the latest version of
//        Cline and re-authenticate your Cline account."}
//
// That message reads like a dead credential, so the account looked broken and the
// fix looked like "re-authenticate". It was neither: the token was valid the whole
// time and a probe with the prefix returned 200 while the bare token returned 401.
// The visible symptom was worse than a 401 — the account got locked after the
// failures, stopped being used, its access token expired unused, and the refresh
// was then rejected with invalid_grant. Re-authenticating produced a fresh token
// that failed in exactly the same way, which is why the problem kept coming back.
//
// These cases assert the header the executor actually builds, since the ordering is
// invisible from the outside: everything else about the request looked correct.

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl";
const CLP = "clp_1234567890abcdef";

const headersFor = (provider, credentials) =>
  new DefaultExecutor(provider).buildHeaders(
    { authType: "oauth", providerSpecificData: {}, ...credentials },
    false,
  );

describe("DefaultExecutor — auth hooks run after base auth", () => {
  it("Cline sends the WorkOS-prefixed token, not the raw one", () => {
    const h = headersFor("cline", { accessToken: JWT });
    expect(h.Authorization).toBe(`Bearer workos:${JWT}`);
  });

  it("every hook still runs (their other headers must not be lost)", () => {
    // Guards the opposite mistake: dropping hooks entirely, or returning early
    // after applyAuth. Cline's device/identity headers come from the same hook as
    // the prefix, so a fix that only reordered them must keep all of them.
    const h = headersFor("cline", { accessToken: JWT });
    expect(h["X-CLIENT-TYPE"]).toBe("9router");
    expect(h["X-Title"]).toBe("Cline");
    expect(h["HTTP-Referer"]).toBe("https://cline.bot");
    expect(h["X-IS-MULTIROOT"]).toBe("false");
  });

  it("ClinePass API keys are sent verbatim (no workos: prefix)", () => {
    // clp_ keys are not JWTs; prefixing them breaks auth. The hook decides this,
    // so the reordering must not turn every credential into a prefixed one.
    const h = headersFor("clinepass", { accessToken: CLP });
    expect(h.Authorization).toBe(`Bearer ${CLP}`);
    expect(h.Authorization).not.toContain("workos:");
  });

  it("does not double-prefix an already-prefixed token", () => {
    const h = headersFor("cline", { accessToken: `workos:${JWT}` });
    expect(h.Authorization).toBe(`Bearer workos:${JWT}`);
    expect(h.Authorization.match(/workos:/g)).toHaveLength(1);
  });

  it("Kimi keeps its x-api-key token AND its device header", () => {
    // Kimi's hook touches a different header than its auth descriptor, so it is
    // the case that proves hooks are additive rather than an override.
    const h = headersFor("kimi", {
      apiKey: "sk-kimi-test",
      providerSpecificData: { deviceId: "device-abc" },
    });
    expect(h["x-api-key"]).toBe("sk-kimi-test");
    expect(JSON.stringify(h)).toContain("device-abc");
  });

  it("a hook provider without a token still sends its identity headers", () => {
    // applyAuth writes `Bearer undefined` for combined descriptors when nothing is
    // supplied; the hook must still get its chance to add headers.
    const h = headersFor("cline", {});
    expect(h["X-CLIENT-TYPE"]).toBe("9router");
  });
});
