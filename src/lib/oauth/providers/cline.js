import { CLINE_CONFIG } from "../constants/oauth.js";

/**
 * Remaining lifetime, in seconds, according to the access token's own `exp`.
 *
 * Preference order matters. Cline's OAuth code carries an `expiresAt` field, but
 * that field is not the signed expiry: measured on a re-auth, the payload said the
 * token had ~286s left while the JWT it accompanied was valid for another ~55
 * minutes, and the token kept answering 200 well past the payload's timestamp. The
 * gateway trusted the payload, stored a connection expiring 55 minutes early, and
 * the background refresher (30-minute lead) then rotated the refresh token within
 * minutes of every re-auth — needless churn on the one credential that cannot be
 * regenerated once it dies. A JWT states its own expiry in `exp`, cryptographically
 * bound to the token, so it wins; the payload timestamp stays as the fallback for
 * opaque tokens, and 3600 as the last resort.
 */
const tokenLifetimeSeconds = (accessToken, expiresAt) => {
  const fromJwt = () => {
    if (typeof accessToken !== "string") return null;
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      if (!Number.isFinite(payload?.exp)) return null;
      return Math.floor(payload.exp - Date.now() / 1000);
    } catch {
      return null;
    }
  };
  const fromPayload = () => {
    if (!expiresAt) return null;
    const ms = new Date(expiresAt).getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.floor((ms - Date.now()) / 1000);
  };
  // An already-expired token still needs a positive value, otherwise callers treat
  // 0 as "no expiry" and stop refreshing it entirely.
  return Math.max(1, fromJwt() ?? fromPayload() ?? 3600);
};

const cline = {
  config: CLINE_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config, redirectUri) => {
    const params = new URLSearchParams({
      client_type: "extension",
      callback_url: redirectUri,
      redirect_uri: redirectUri,
    });
    return `${config.authorizeUrl}?${params.toString()}`;
  },
  exchangeToken: async (config, code, redirectUri) => {
    try {
      // Cline encodes token data as base64 in the code param
      let base64 = code;
      const padding = 4 - (base64.length % 4);
      if (padding !== 4) base64 += "=".repeat(padding);
      const decoded = Buffer.from(base64, "base64").toString("utf-8");
      const lastBrace = decoded.lastIndexOf("}");
      if (lastBrace === -1) throw new Error("No JSON found in decoded code");
      const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1));
      return {
        access_token: tokenData.accessToken,
        refresh_token: tokenData.refreshToken,
        email: tokenData.email,
        firstName: tokenData.firstName,
        lastName: tokenData.lastName,
        expires_at: tokenData.expiresAt,
      };
    } catch (e) {
      const response = await fetch(config.tokenExchangeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code, client_type: "extension", redirect_uri: redirectUri }),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cline token exchange failed: ${error}`);
      }
      const data = await response.json();
      return {
        access_token: data.data?.accessToken || data.accessToken,
        refresh_token: data.data?.refreshToken || data.refreshToken,
        email: data.data?.userInfo?.email || "",
        expires_at: data.data?.expiresAt || data.expiresAt,
      };
    }
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokenLifetimeSeconds(tokens.access_token, tokens.expires_at),
    email: tokens.email,
    providerSpecificData: { firstName: tokens.firstName, lastName: tokens.lastName },
  }),
};

export default cline;
