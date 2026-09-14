import { describe, it, expect, vi } from "vitest";
import {
  getClineAuthCandidates,
  getClineAuthorizationHeader,
  getAlternateClineToken,
  clineTokenShape,
  getClineAccessToken,
  buildClineHeaders,
} from "open-sse/shared/clineAuth.js";

// Cline accepts the same access token in two different wire shapes, and which one
// works depends on how the token was MINTED — not on the endpoint:
//
//   login-minted   (OAuth exchange; `iat` ≈ `auth_time`) → bare:      Bearer eyJ...
//   refresh-minted (/auth/refresh;  `iat` ≫ `auth_time`)  → prefixed:  Bearer workos:eyJ...
//
// Sending the wrong one answers 401 "…re-authenticate your Cline account", which
// reads like a dead credential although the token is fine. Measured on one account
// minutes apart: login-minted bare=200/prefixed=401, refresh-minted bare=401/
// prefixed=200, and five freshly-refreshed tokens all answered 401 bare, 200
// prefixed. Background refresh rewrites the stored token every ~25 minutes, so a
// hardcoded choice is wrong half the time — that produced the "works right after
// re-auth, then 401s again" cycle, and each recovery looked like a needed re-auth.
//
// The fix predicts from JWT claims and, because a prediction can miss, retries
// once with the other shape (covered by executor-auth-hook-order.test.js).

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function jwt({ iat, auth_time }) {
  return `${b64url({ alg: "RS256", kid: "k" })}.${b64url({ iat, auth_time, exp: iat + 3600, sub: "u" })}.sig`;
}

const LOGIN = jwt({ iat: 1000, auth_time: 985 });      // minted by login
const REFRESHED = jwt({ iat: 5000, auth_time: 1400 }); // minted by refresh

describe("clineAuth — token shape selection", () => {
  it("prefers the bare form for a login-minted token", () => {
    // This is the case that broke: right after a re-auth the stored token is
    // login-minted, and the prefix makes Cline answer 401.
    expect(getClineAuthorizationHeader(LOGIN)).toBe(`Bearer ${LOGIN}`);
    expect(getClineAuthCandidates(LOGIN)[0]).toBe(LOGIN);
  });

  it("prefers the prefixed form for a refresh-minted token", () => {
    // The steady state once the background refresher has run — the common case,
    // and what 5/5 live probes confirmed needs the prefix.
    expect(getClineAuthorizationHeader(REFRESHED)).toBe(`Bearer workos:${REFRESHED}`);
    expect(getClineAuthCandidates(REFRESHED)[0]).toBe(`workos:${REFRESHED}`);
  });

  it("offers the other shape as a fallback in both directions", () => {
    expect(getClineAuthCandidates(LOGIN)).toEqual([LOGIN, `workos:${LOGIN}`]);
    expect(getClineAuthCandidates(REFRESHED)).toEqual([`workos:${REFRESHED}`, REFRESHED]);
  });

  it("treats the 60s boundary as login-minted and just past it as refreshed", () => {
    expect(clineTokenShape(getAlternateClineToken(jwt({ iat: 3000, auth_time: 2941 })) ?? ""))
      .toBe("prefixed"); // login-minted → alternate is the prefixed form
    expect(clineTokenShape(getAlternateClineToken(jwt({ iat: 4000, auth_time: 3939 })) ?? ""))
      .toBe("raw"); // refreshed → alternate is the bare form
  });

  it("never prefixes an opaque ClinePass key", () => {
    // clp_ keys are not JWTs; a prefix makes Cline reject them, and there is no
    // second shape to probe.
    const key = "clp_1234567890abcdef";
    expect(getClineAuthCandidates(key)).toEqual([key]);
    expect(getClineAuthorizationHeader(key)).toBe(`Bearer ${key}`);
    expect(getAlternateClineToken(key)).toBeNull();
    expect(buildClineHeaders(key).Authorization).toBe(`Bearer ${key}`);
  });

  it("does not double-prefix an already-prefixed token", () => {
    const already = `workos:${REFRESHED}`;
    expect(getClineAuthorizationHeader(already)).toBe(`Bearer ${already}`);
    expect(getClineAuthorizationHeader(already).match(/workos:/g)).toHaveLength(1);
  });

  it("falls back to the prefixed form when the JWT cannot be read", () => {
    // Unreadable claims must not be treated as login-minted: the prefixed form is
    // what the majority of stored tokens need.
    const opaqueJwt = "eyJub3QtanNvbg.eyJub3Rqc29u.c2ln";
    expect(getClineAuthCandidates(opaqueJwt)[0]).toMatch(/^workos:/);
    // A JWT with no auth_time at all is also treated as refreshed.
    expect(getClineAuthCandidates(jwt({ iat: 7000, auth_time: undefined }))[0]).toMatch(/^workos:/);
  });

  it("returns nothing for empty input rather than throwing", () => {
    for (const bad of [undefined, null, "", "   "]) {
      expect(getClineAccessToken(bad)).toBe("");
      expect(getClineAuthCandidates(bad)).toEqual([]);
      expect(getClineAuthorizationHeader(bad)).toBe("");
      expect(getAlternateClineToken(bad)).toBeNull();
    }
    expect(buildClineHeaders(undefined).Authorization).toBeUndefined();
  });

  it("honours a forced shape (the retry path)", () => {
    // execute() sets this after a 401; it must produce the OTHER header regardless
    // of what the prediction would have chosen.
    expect(buildClineHeaders(REFRESHED, {}, { shape: "raw" }).Authorization).toBe(`Bearer ${REFRESHED}`);
    expect(buildClineHeaders(LOGIN, {}, { shape: "prefixed" }).Authorization).toBe(`Bearer workos:${LOGIN}`);
    // Forcing a shape on an opaque key is a no-op, not a prefixed key.
    expect(buildClineHeaders("clp_abc", {}, { shape: "prefixed" }).Authorization).toBe("Bearer clp_abc");
  });

  it("keeps the identity headers on every shape", () => {
    for (const token of [LOGIN, REFRESHED, "clp_abc"]) {
      const h = buildClineHeaders(token);
      expect(h["X-CLIENT-TYPE"]).toBe("9router");
      expect(h["HTTP-Referer"]).toBe("https://cline.bot");
      expect(h["X-IS-MULTIROOT"]).toBe("false");
    }
  });
});

describe("clineAuth — the executor retry hook", () => {
  it("switches shape once and then refuses to loop", async () => {
    const { DefaultExecutor } = await import("open-sse/executors/default.js");
    const ex = new DefaultExecutor("cline");
    const creds = { authType: "oauth", accessToken: REFRESHED, providerSpecificData: {} };

    // First 401 → switch to the bare form and report that a retry is warranted.
    expect(await ex.retryAlternativeAuth(creds, null)).toBe(true);
    expect(creds.clineAuthShape).toBe("raw");
    expect(creds.accessToken).toBe(REFRESHED);

    // Second 401 on the same request must not ping-pong between shapes.
    expect(await ex.retryAlternativeAuth(creds, null)).toBe(false);
  });

  it("does not fire for other providers", async () => {
    const { DefaultExecutor } = await import("open-sse/executors/default.js");
    const ex = new DefaultExecutor("openai");
    expect(typeof ex.retryAlternativeAuth).toBe("function");
    expect(await ex.retryAlternativeAuth({ accessToken: REFRESHED }, null)).toBe(false);
  });

  it("does not fire for an opaque credential (no second shape exists)", async () => {
    const { DefaultExecutor } = await import("open-sse/executors/default.js");
    const ex = new DefaultExecutor("clinepass");
    const creds = { authType: "apikey", apiKey: "clp_abc", providerSpecificData: {} };
    expect(await ex.retryAlternativeAuth(creds, null)).toBe(false);
    expect(creds.clineAuthShape).toBeUndefined();
  });
});
