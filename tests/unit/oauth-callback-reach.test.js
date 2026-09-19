// Zed (and trae/windsurf) complete the browser flow by redirecting to a loopback callback
// on the machine that runs the gateway. When the dashboard is reached from another host —
// a Cloudflare tunnel, a LAN address, a remote VPS — that redirect lands on the USER's
// machine, where nothing listens: the browser shows "This page couldn't load" and the modal
// spins on "Waiting for browser authorization" forever. This helper decides when the modal
// must say so up front and offer the paste-the-callback-URL path instead.
import { describe, it, expect } from "vitest";
import {
  isLoopbackHost,
  needsManualCallbackPaste,
} from "../../src/shared/utils/oauthCallbackReach.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

describe("isLoopbackHost", () => {
  it("accepts the loopback spellings a browser can produce", () => {
    for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const host of ["ai.deathrhythm.com", "192.168.1.10", "0.0.0.0", "", null, undefined]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});

describe("needsManualCallbackPaste", () => {
  it("says nothing when the dashboard itself is on loopback", () => {
    expect(
      needsManualCallbackPaste({
        callbackUrl: "http://127.0.0.1:58443/",
        pageHostname: "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      needsManualCallbackPaste({
        callbackUrl: "http://127.0.0.1:58443/",
        pageHostname: "localhost",
      }),
    ).toBe(false);
  });

  it("asks for a paste when the callback is loopback but the page is not", () => {
    expect(
      needsManualCallbackPaste({
        callbackUrl: "http://127.0.0.1:58443/",
        pageHostname: "ai.deathrhythm.com",
      }),
    ).toBe(true);
  });

  it("stays quiet when the callback host is reachable from the browser", () => {
    expect(
      needsManualCallbackPaste({
        callbackUrl: "https://ai.deathrhythm.com/callback",
        pageHostname: "ai.deathrhythm.com",
      }),
    ).toBe(false);
  });

  it("does not nag on an unparseable callback URL", () => {
    expect(needsManualCallbackPaste({ callbackUrl: "", pageHostname: "example.com" })).toBe(false);
    expect(needsManualCallbackPaste({})).toBe(false);
  });

  it("treats a loopback callback as unreachable from any non-loopback page host", () => {
    for (const pageHostname of ["ai.deathrhythm.com", "192.168.1.10", "9router.example.net"]) {
      expect(isLoopbackHost(pageHostname), pageHostname).toBe(false);
      expect(
        needsManualCallbackPaste({ callbackUrl: "http://127.0.0.1:58443/?user_id=1", pageHostname }),
        pageHostname,
      ).toBe(true);
    }
  });
});

// The helper is only useful if the modal actually consults it and offers the paste path:
// guard the wiring itself, since that is what the user sees hang.
describe("OAuthModal wiring", () => {
  const src = read("src/shared/components/OAuthModal.js");

  it("decides from the helper, comparing the callback host with the page host", () => {
    expect(src).toMatch(/import \{ needsManualCallbackPaste \} from "@\/shared\/utils\/oauthCallbackReach"/);
    const call = src.slice(src.indexOf("needsManualCallbackPaste({"));
    expect(call.slice(0, 200)).toMatch(/callbackUrl/);
    expect(call.slice(0, 260)).toMatch(/pageHostname:\s*window\.location\.hostname/);
  });

  it("renders the paste field inside the waiting step of a proxy flow", () => {
    // A spinner alone is what made the remote case look like a hang.
    const start = src.indexOf('{PROXY_OAUTH_PROVIDERS.has(provider) && (step === "waiting"');
    const end = src.indexOf('{(step === "waiting" || step === "input") && !isDeviceCode');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = src.slice(start, end);
    expect(branch).toMatch(/\{step === "waiting" &&/);
    expect(branch).toMatch(/\{manualCallbackRequired &&/);
    expect(branch).toMatch(/handleManualSubmit/);
  });
});
