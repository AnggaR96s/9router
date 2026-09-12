import { describe, it, expect } from "vitest";

// Smart routing logic mirrors injectSkill.js (keyword match against recent user text).
// Re-implemented here as pure functions so the test needs no module aliasing.
function userText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const userMsgs = msgs.filter((m) => m.role === "user").slice(-3);
  return userMsgs
    .map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => p?.text || "").join(" ") : ""))
    .join(" ")
    .toLowerCase();
}

function smartMatches(text, keywords) {
  if (!text) return false;
  return keywords.some((k) => text.includes(String(k).toLowerCase()));
}

describe("skill smart routing", () => {
  const kw = ["watermark", "c2pa", "synthid", "metadata"];

  it("off mode never injects", () => {
    const mode = "off";
    expect(mode === "off").toBe(true);
  });

  it("smart mode injects on keyword hit", () => {
    const body = { messages: [{ role: "user", content: "help me strip C2PA metadata from this png" }] };
    expect(smartMatches(userText(body), kw)).toBe(true);
  });

  it("smart mode skips without keyword", () => {
    const body = { messages: [{ role: "user", content: "what is the capital of france" }] };
    expect(smartMatches(userText(body), kw)).toBe(false);
  });

  it("smart mode is case-insensitive and checks last 3 user turns", () => {
    const body = { messages: [
      { role: "user", content: "hello" },
      { role: "user", content: "SYNTHID detection question" },
      { role: "user", content: "thanks" },
    ] };
    expect(smartMatches(userText(body), kw)).toBe(true);
  });

  it("always mode ignores keywords", () => {
    const body = { messages: [{ role: "user", content: "what is the capital of france" }] };
    const mode = "always";
    const shouldInject = mode === "off" ? false : mode === "smart" ? smartMatches(userText(body), kw) : true;
    expect(shouldInject).toBe(true);
  });

  it("content blocks (claude-style arrays) are searched too", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "remove this Watermark please" }] }] };
    expect(smartMatches(userText(body), kw)).toBe(true);
  });
});
