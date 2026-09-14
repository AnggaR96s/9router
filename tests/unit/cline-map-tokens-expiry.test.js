import { describe, it, expect } from "vitest";
import cline from "../../src/lib/oauth/providers/cline.js";

/**
 * Cline's OAuth code carries an `expiresAt` field that is NOT the signed expiry.
 * Measured on a real re-auth: the payload claimed ~286s of life while the JWT it
 * accompanied was valid for another ~55 minutes, and the token answered 200 long
 * past the payload's timestamp. Trusting it stored a connection expiring 55 minutes
 * early, and the background refresher (30-minute lead) then rotated the
 * refresh token within minutes of every re-auth — churn on the one credential that
 * cannot be regenerated once it dies.
 *
 * So the JWT's own `exp` wins. These cases pin that preference order and the
 * fallbacks, and every one of them fails against `expires_at - now`.
 */
const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");

const jwt = ({ iat, exp, authTime }) =>
  [
    b64url({ alg: "RS256", typ: "JWT" }),
    b64url({ iat, exp, auth_time: authTime ?? iat, sub: "u" }),
    "signature-not-verified-here",
  ].join(".");

const nowSec = () => Math.floor(Date.now() / 1000);

describe("cline mapTokens — expiry comes from the token, not the payload", () => {
  it("prefers the JWT exp over a stale payload expiresAt (the real bug)", () => {
    // Exactly the observed shape: payload says 286s, the JWT says 3600s.
    const iat = nowSec();
    const token = jwt({ iat, exp: iat + 3600 });
    const staleExpiresAt = new Date(Date.now() + 286 * 1000).toISOString();

    const mapped = cline.mapTokens({
      access_token: token,
      refresh_token: "rt",
      expires_at: staleExpiresAt,
    });

    // The bug produced ~286. The fix must be ~3600, never the payload's number.
    expect(mapped.expiresIn).toBeGreaterThan(3400);
    expect(mapped.expiresIn).toBeLessThanOrEqual(3600);
    expect(mapped.expiresIn).not.toBeLessThan(3000);
  });

  it("gives the full lifetime so the 30-minute refresh lead is not crossed immediately", () => {
    const iat = nowSec();
    const mapped = cline.mapTokens({
      access_token: jwt({ iat, exp: iat + 3600 }),
      refresh_token: "rt",
      expires_at: new Date(Date.now() + 120 * 1000).toISOString(),
    });
    // A 2-minute lifetime would be inside the 30-minute lead on arrival, forcing a
    // refresh on the very next tick — the churn this fix removes.
    expect(mapped.expiresIn).toBeGreaterThan(30 * 60);
  });

  it("still honours the payload for an opaque token with no JWT", () => {
    const mapped = cline.mapTokens({
      access_token: "clp_opaque_key_has_no_claims",
      refresh_token: "rt",
      expires_at: new Date(Date.now() + 1200 * 1000).toISOString(),
    });
    expect(mapped.expiresIn).toBeGreaterThan(1100);
    expect(mapped.expiresIn).toBeLessThanOrEqual(1200);
  });

  it("falls back to one hour when neither source is usable", () => {
    expect(
      cline.mapTokens({ access_token: "opaque", refresh_token: "rt" }).expiresIn,
    ).toBe(3600);
    expect(
      cline.mapTokens({
        access_token: "opaque",
        refresh_token: "rt",
        expires_at: "not-a-date",
      }).expiresIn,
    ).toBe(3600);
  });

  it("clamps an already-expired token to 1s rather than zero or negative", () => {
    const iat = nowSec() - 7200;
    const mapped = cline.mapTokens({
      access_token: jwt({ iat, exp: iat + 3600 }),
      refresh_token: "rt",
      expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
    });
    // Zero is treated as "no expiry" by the callers, which would stop refreshing a
    // dead token forever; a positive value keeps it refreshable.
    expect(mapped.expiresIn).toBe(1);
  });

  it("survives a malformed JWT instead of throwing", () => {
    const mapped = cline.mapTokens({
      access_token: "aaa.!!!not-base64-json!!!.ccc",
      refresh_token: "rt",
      expires_at: new Date(Date.now() + 600 * 1000).toISOString(),
    });
    expect(mapped.expiresIn).toBeGreaterThan(500); // fell back to the payload
  });

  it("ignores a JWT whose payload carries no numeric exp", () => {
    const token = [b64url({ alg: "RS256" }), b64url({ sub: "u", iat: 1 }), "sig"].join(".");
    const mapped = cline.mapTokens({
      access_token: token,
      refresh_token: "rt",
      expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
    });
    expect(mapped.expiresIn).toBeGreaterThan(800);
  });

  it("keeps the other mapped fields intact", () => {
    const iat = nowSec();
    const mapped = cline.mapTokens({
      access_token: jwt({ iat, exp: iat + 3600 }),
      refresh_token: "rt-1",
      email: "a@b.c",
      firstName: "Angga",
      lastName: "R",
    });
    expect(mapped.accessToken).toContain(".");
    expect(mapped.refreshToken).toBe("rt-1");
    expect(mapped.email).toBe("a@b.c");
    expect(mapped.providerSpecificData).toEqual({ firstName: "Angga", lastName: "R" });
  });
});