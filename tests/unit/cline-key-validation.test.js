/**
 * Unit tests for cline API-key validation on the add-a-key path
 * (POST /api/providers/validate).
 *
 * Cline's catalog (GET /api/v1/models) answers 200 to an anonymous request and to any
 * wrong key, so a probe derived from the chat baseUrl declares every key valid. The
 * credential check is GET /api/v1/users/me — declared as the provider's validateUrl —
 * which answers 401 for a wrong key and 200 for a good one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;
const BOGUS = "sk_" + "0".repeat(64);

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function validate(provider, apiKey) {
  const { POST } = await import("../../src/app/api/providers/validate/route.js");
  const res = await POST(
    new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey }),
    })
  );
  return res.json();
}

describe("cline API-key validation", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      const target = typeof url === "string" ? url : url.url;
      calls.push({ url: target, method: opts?.method || "GET", auth: opts?.headers?.Authorization });
      if (target.includes("/users/me")) return jsonResponse({ error: "Unauthorized" }, 401);
      return jsonResponse({ object: "list", data: [{ id: "~deepseek/deepseek-pro-latest" }] }, 200);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects a wrong key instead of trusting the public model catalog", async () => {
    const body = await validate("cline", BOGUS);

    expect(calls.map((c) => c.url)).toContain("https://api.cline.bot/api/v1/users/me");
    expect(body.valid).toBe(false);
    expect(body.error).toBe("Invalid API key");
  });

  it("sends the key and accepts a good one through the same endpoint", async () => {
    global.fetch = vi.fn(async (url, opts) => {
      const target = typeof url === "string" ? url : url.url;
      calls.push({ url: target, auth: opts?.headers?.Authorization });
      if (target.includes("/users/me")) return jsonResponse({ data: { id: "usr-1" } }, 200);
      return jsonResponse({ object: "list", data: [] }, 200);
    });

    const body = await validate("cline", "sk_" + "1".repeat(64));

    const probe = calls.find((c) => c.url.includes("/users/me"));
    expect(probe?.auth).toBe("Bearer sk_" + "1".repeat(64));
    expect(body.valid).toBe(true);
    expect(body.error).toBeNull();
  });
});
