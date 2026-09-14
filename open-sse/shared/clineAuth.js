import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

/**
 * Cline's API takes the same access token in two different shapes, and which one
 * it accepts depends on how that token was minted — not on the endpoint:
 *
 *   login-minted  (the token returned by the OAuth exchange, `iat` ≈ `auth_time`)
 *                 → sent RAW:            `Bearer eyJ...`
 *   refresh-minted (the token returned by /auth/refresh, `iat` well past
 *                 `auth_time`)            → sent PREFIXED: `Bearer workos:eyJ...`
 *
 * Feeding either token the other way answers 401 with "…re-authenticate your
 * Cline account", which reads like a dead credential while the token is in fact
 * perfectly valid. Measured on a single account, one session, minutes apart:
 * login-minted raw=200 / prefixed=401, refresh-minted raw=401 / prefixed=200,
 * and five freshly-refreshed tokens all answered 401 raw and 200 prefixed.
 *
 * Sending BOTH is therefore the safe move rather than trying to classify: the
 * accepted shape returns 200 and the rejected one returns 401, so probing costs
 * nothing when the first guess is right and recovers the account when it is not.
 * That matters because background refresh rewrites the stored token roughly
 * every 25 minutes — a static choice is wrong half the time, which is exactly the
 * "works right after re-auth, then breaks again" cycle this replaces.
 */
function isWorkOsJwt(token) {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token);
}

export function getClineAccessToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("workos:")) return trimmed;
  // Cline OAuth access tokens are WorkOS JWTs (base64url `eyJ...` header).
  // ClinePass API keys (category "apikey", e.g. `clp_...`) are NOT JWTs and must
  // be sent verbatim — prefixing them with `workos:` makes the Cline API reject
  // the request with HTTP 401.
  return isWorkOsJwt(trimmed) ? `workos:${trimmed}` : trimmed;
}

/**
 * The Authorization header to try FIRST for this token.
 *
 * A refresh-minted token (the common case once the background refresher has run)
 * needs the prefix, so that is the default. A login-minted token needs it raw,
 * and is detected by its `iat` sitting within a minute of `auth_time` — the
 * signature of a token minted by the interactive login rather than by a refresh.
 * Anything unreadable falls back to the prefixed form, which is correct for the
 * shape most tokens in the database have.
 */
export function getClineAuthCandidates(token) {
  if (typeof token !== "string") return [];
  const trimmed = token.trim();
  if (!trimmed) return [];
  // Opaque credentials (clp_…) have exactly one valid shape and must not be
  // probed with a prefix.
  if (!isWorkOsJwt(trimmed)) return [trimmed];

  const raw = trimmed;
  const prefixed = `workos:${trimmed}`;
  const loginMinted = isLoginMintedJwt(trimmed);
  return loginMinted ? [raw, prefixed] : [prefixed, raw];
}

/** True when `iat` is close to `auth_time`, i.e. minted by the login flow. */
function isLoginMintedJwt(jwt) {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return false;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
    const { iat, auth_time: authTime } = claims;
    if (typeof iat !== "number" || typeof authTime !== "number") return false;
    return Math.abs(iat - authTime) <= 60;
  } catch {
    return false;
  }
}

export function getClineAuthorizationHeader(token) {
  const candidates = getClineAuthCandidates(token);
  return candidates.length ? `Bearer ${candidates[0]}` : "";
}

/**
 * The same token in its OTHER shape, or null when only one shape is valid.
 *
 * Used as a one-shot retry: the shape is chosen by inspecting the JWT, and
 * inspection can in principle be wrong (an unexpected issuer, a clock skew that
 * makes a refresh-minted token look login-minted). Since the wrong shape answers
 * 401 and the right one answers 200, retrying with the other costs a single
 * request on a path that was about to fail anyway — and turns a misprediction
 * from "account unusable until re-auth" into "one wasted round trip".
 */
export function getAlternateClineToken(token) {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  // An opaque credential has exactly one valid shape — never probe it.
  if (!isWorkOsJwt(stripPrefix(trimmed))) return null;

  const candidates = getClineAuthCandidates(trimmed);
  const second = candidates[1];
  if (!second || second === candidates[0]) return null;
  return second;
}

/** The shape a token string represents: "raw" or "prefixed". */
export function clineTokenShape(token) {
  if (typeof token !== "string") return null;
  return token.trim().toLowerCase().startsWith("workos:") ? "prefixed" : "raw";
}

function stripPrefix(token) {
  return token.toLowerCase().startsWith("workos:") ? token.slice(7) : token;
}

export function buildClineHeaders(token, extraHeaders = {}, options = {}) {
  const authorization = buildAuthorization(token, options.shape);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "User-Agent": `9Router/${APP_VERSION}`,
    "X-PLATFORM": process.platform || "unknown",
    "X-PLATFORM-VERSION": process.version || "unknown",
    "X-CLIENT-TYPE": "9router",
    "X-CLIENT-VERSION": APP_VERSION,
    "X-CORE-VERSION": APP_VERSION,
    "X-IS-MULTIROOT": "false",
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}

/**
 * Build the Authorization header, optionally forcing a shape.
 *
 * `shape` is only passed by the retry path in DefaultExecutor, after the
 * predicted shape came back 401. Everything else uses the automatic choice.
 */
function buildAuthorization(token, shape) {
  if (typeof token !== "string" || !token.trim()) return "";
  const trimmed = token.trim();

  if (shape === "raw" || shape === "prefixed") {
    const bare = stripPrefix(trimmed);
    // Only meaningful for JWTs; an opaque key has no second shape to force.
    if (!isWorkOsJwt(bare)) return `Bearer ${trimmed}`;
    return shape === "raw" ? `Bearer ${bare}` : `Bearer workos:${bare}`;
  }

  const candidates = getClineAuthCandidates(trimmed);
  return candidates.length ? `Bearer ${candidates[0]}` : "";
}
