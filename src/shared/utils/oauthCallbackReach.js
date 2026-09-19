// Some providers (zed, trae, windsurf) finish the browser flow by redirecting to a loopback
// callback served by THIS app — the URL carries 127.0.0.1 and a fixed port. That only works
// when the browser runs on the same machine as the gateway. Reached through a tunnel (an
// HTTPS dashboard host, a LAN address, a remote VPS) the redirect lands on the user's own
// machine, nothing answers, and the modal waits forever for a callback the server will never
// see. This helper decides when to say so up front and offer pasting the callback URL.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname ?? "").trim().toLowerCase());
}

/**
 * True when the callback the browser will be redirected to cannot reach this server from
 * where the dashboard is being used, so the user must hand the callback URL over manually.
 * Unparseable input returns false: a missing URL is not evidence of a remote dashboard.
 */
export function needsManualCallbackPaste({ callbackUrl, pageHostname } = {}) {
  let callbackHost;
  try {
    callbackHost = new URL(String(callbackUrl)).hostname;
  } catch {
    return false;
  }
  if (!isLoopbackHost(callbackHost)) return false;
  return !isLoopbackHost(pageHostname);
}
