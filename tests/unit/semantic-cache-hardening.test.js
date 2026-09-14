import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hardening cases for the response cache that the upstream fix does not cover.
//
// The imported-cache bug (save never wired) and the cross-tenant key (apiKey not
// hashed) are locked by semantic-response-cache.test.js. What is left is object
// identity: the cache stores one entry and hands it to every caller that matches
// the key, so if either side mutates what it holds, the other side sees the edit.
// That is invisible in a single-request test and only shows up as one caller
// receiving another caller's data.
//
// Also covered here: TTL expiry and the 1000-entry ceiling, neither of which had
// a test, so a regression in either would silently serve stale answers or grow
// without bound.

const {
  checkSemanticCache,
  saveToSemanticCache,
} = await import("../../open-sse/rtk/semanticCache.js");

const body = (content, overrides = {}) => ({
  model: "test-model",
  stream: false,
  messages: [{ role: "user", content }],
  ...overrides,
});

const reply = (content) => ({
  id: "resp-1",
  choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
});

describe("response cache — stored objects are isolated from callers", () => {
  it("a caller mutating the response after saving does not corrupt the entry", () => {
    const b = body("mutation-after-save");
    const response = reply("original");
    saveToSemanticCache(b, "p/m", response, "key-A");

    // The saving handler serialises this same object into the client response,
    // so it legitimately keeps using the reference afterwards.
    response.choices[0].message.content = "OVERWRITTEN_BY_SAVER";
    response.usage = { total_tokens: 999 };

    const hit = checkSemanticCache(b, "p/m", "key-A");
    expect(hit).not.toBeNull();
    expect(hit.choices[0].message.content).toBe("original");
    expect(hit.usage).toBeUndefined();
  });

  it("one caller mutating a hit does not leak into the next caller's hit", () => {
    const b = body("mutation-after-hit");
    saveToSemanticCache(b, "p/m", reply("shared"), "key-A");

    const first = checkSemanticCache(b, "p/m", "key-A");
    first.choices[0].message.content = "EDITED_BY_FIRST_CALLER";
    first.choices.push({ message: { role: "assistant", content: "extra" } });

    const second = checkSemanticCache(b, "p/m", "key-A");
    expect(second.choices[0].message.content).toBe("shared");
    expect(second.choices).toHaveLength(1);
  });

  it("each hit is a distinct object (no shared reference between callers)", () => {
    const b = body("distinct-objects");
    saveToSemanticCache(b, "p/m", reply("x"), "key-A");
    const a = checkSemanticCache(b, "p/m", "key-A");
    const c = checkSemanticCache(b, "p/m", "key-A");
    expect(a).toEqual(c);
    expect(a).not.toBe(c);
  });

  it("nested structures are copied deeply, not just the top level", () => {
    const b = body("nested");
    saveToSemanticCache(b, "p/m", {
      id: "r",
      choices: [{ message: { content: "deep", tool_calls: [{ function: { name: "f", arguments: "{}" } }] } }],
    }, "key-A");

    const hit = checkSemanticCache(b, "p/m", "key-A");
    hit.choices[0].message.tool_calls[0].function.name = "CHANGED";
    const hit2 = checkSemanticCache(b, "p/m", "key-A");
    expect(hit2.choices[0].message.tool_calls[0].function.name).toBe("f");
  });
});

describe("response cache — keying and guards", () => {
  it("never stores or returns anything without an apiKey", () => {
    const b = body("no-key");
    saveToSemanticCache(b, "p/m", reply("should-not-stick"), undefined);
    // Fail closed: without a key there is no tenant to scope to, so the cache
    // must neither store nor serve.
    expect(checkSemanticCache(b, "p/m", undefined)).toBeNull();
    expect(checkSemanticCache(b, "p/m", "")).toBeNull();
    // and nothing was written under a falsy key
    expect(checkSemanticCache(b, "p/m", null)).toBeNull();
  });

  it("keeps tenants apart even when prompt and model are identical", () => {
    const b = body("same-prompt");
    saveToSemanticCache(b, "p/m", reply("tenant-A-answer"), "key-A");
    expect(checkSemanticCache(b, "p/m", "key-A").choices[0].message.content).toBe("tenant-A-answer");
    expect(checkSemanticCache(b, "p/m", "key-B")).toBeNull();
  });

  it("distinguishes generation options that change the answer", () => {
    saveToSemanticCache(body("opts", { temperature: 0.2 }), "p/m", reply("cold"), "key-A");
    expect(checkSemanticCache(body("opts", { temperature: 0.2 }), "p/m", "key-A")).not.toBeNull();
    // temperature/top_p/max_tokens are part of the body, so they are part of the key
    expect(checkSemanticCache(body("opts", { temperature: 1.4 }), "p/m", "key-A")).toBeNull();
    expect(checkSemanticCache(body("opts", { max_tokens: 64 }), "p/m", "key-A")).toBeNull();
  });

  it("refuses streaming requests and forced tool calls", () => {
    saveToSemanticCache(body("stream", { stream: true }), "p/m", reply("s"), "key-A");
    expect(checkSemanticCache(body("stream", { stream: true }), "p/m", "key-A")).toBeNull();

    const forced = body("forced", { tool_choice: { type: "function", function: { name: "f" } } });
    saveToSemanticCache(forced, "p/m", reply("f"), "key-A");
    expect(checkSemanticCache(forced, "p/m", "key-A")).toBeNull();
  });

  it("never caches an error response", () => {
    saveToSemanticCache(body("err"), "p/m", { error: { message: "boom" } }, "key-A");
    expect(checkSemanticCache(body("err"), "p/m", "key-A")).toBeNull();

    saveToSemanticCache(body("err2"), "p/m", { is_error: true }, "key-A");
    expect(checkSemanticCache(body("err2"), "p/m", "key-A")).toBeNull();
  });

  it("separates models and providers", () => {
    saveToSemanticCache(body("m"), "provider-a/model", reply("A"), "key-A");
    expect(checkSemanticCache(body("m"), "provider-b/model", "key-A")).toBeNull();
    expect(checkSemanticCache(body("m"), "provider-a/other", "key-A")).toBeNull();
  });
});

describe("response cache — lifetime and bounds", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("expires an entry after the 3 hour TTL", () => {
    const b = body("ttl");
    saveToSemanticCache(b, "p/m", reply("fresh"), "key-A");
    expect(checkSemanticCache(b, "p/m", "key-A")).not.toBeNull();

    // Just inside the window still hits…
    vi.advanceTimersByTime(3 * 60 * 60 * 1000 - 1000);
    expect(checkSemanticCache(b, "p/m", "key-A")).not.toBeNull();

    // …and just past it misses, so a stale answer cannot outlive the TTL.
    vi.advanceTimersByTime(2000);
    expect(checkSemanticCache(b, "p/m", "key-A")).toBeNull();
  });

  it("stays bounded when far more than 1000 distinct keys are stored", () => {
    for (let i = 0; i < 1400; i++) {
      saveToSemanticCache(body(`bulk-${i}`), "p/m", reply(`r${i}`), "key-A");
    }
    // The ceiling holds, so memory cannot grow without bound under varied traffic.
    // (The map is not exported, so this is checked through behaviour: an early key
    // has been evicted while a recent one survives.)
    expect(checkSemanticCache(body("bulk-0"), "p/m", "key-A")).toBeNull();
    expect(checkSemanticCache(body("bulk-1399"), "p/m", "key-A")).not.toBeNull();
  });
});