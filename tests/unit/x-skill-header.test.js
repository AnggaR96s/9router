// Regression tests for the x-skill request header.
//
// The original PR tested resolveActiveSkillIds() directly, passing it a plain
// string. That passed. What was never tested is the BRIDGE from the inbound
// header to that function, and that is exactly where the bug was: chat.js read
// `headers["x-skill"]?.[0] ?? headers["x-skill"]`, and because the header object
// is built with Object.fromEntries(request.headers.entries()) the value is a
// STRING — so `[0]` returned its first character. "on" became "o", "off" became
// "o", and every value resolved to a non-existent skill id, making the whole
// header a silent no-op. It failed open (nothing injected, nothing errored),
// which is why only a live probe caught it.
//
// These tests pin the bridge itself: the shape chat.js actually produces.

import { describe, it, expect } from "vitest";
import { resolveActiveSkillIds, readHeaderValue } from "open-sse/rtk/injectSkill.js";

const DB_SKILLS = ["human-handwritten"];

// Exactly how chat.js builds headers for the request it hands around.
function headersAsChatJsBuildsThem(pairs) {
  return Object.fromEntries(new Map(pairs).entries());
}

// Exactly the call site in src/sse/handlers/chat.js.
function activeSkillsFromRequest(headerPairs, dbSkills = DB_SKILLS) {
  const headers = headersAsChatJsBuildsThem(headerPairs);
  return resolveActiveSkillIds(dbSkills, readHeaderValue(headers, "x-skill"));
}

describe("readHeaderValue", () => {
  it("returns a string header whole, not its first character", () => {
    expect(readHeaderValue({ "x-skill": "on" }, "x-skill")).toBe("on");
    expect(readHeaderValue({ "x-skill": "human-handwritten" }, "x-skill")).toBe("human-handwritten");
    expect(readHeaderValue({ "x-skill": "on,commit-lint" }, "x-skill")).toBe("on,commit-lint");
  });

  it("still accepts an array-valued header", () => {
    expect(readHeaderValue({ "x-skill": ["on", "x"] }, "x-skill")).toBe("on");
    expect(readHeaderValue({ "x-skill": ["human-handwritten"] }, "x-skill")).toBe("human-handwritten");
  });

  it("is undefined when the header is absent", () => {
    expect(readHeaderValue({}, "x-skill")).toBeUndefined();
    expect(readHeaderValue(undefined, "x-skill")).toBeUndefined();
    expect(readHeaderValue(null, "x-skill")).toBeUndefined();
  });

  it("falls back to the lowercased name (HTTP headers are case-insensitive)", () => {
    expect(readHeaderValue({ "x-skill": "off" }, "X-Skill")).toBe("off");
  });
});

describe("x-skill header -> resolveActiveSkillIds (the previously untested bridge)", () => {
  it("THE BUG: a plain string header must not be truncated to one character", () => {
    // Guard the exact regression: ['on'] must fall back to the dashboard list,
    // not resolve to the skill id "o".
    expect(activeSkillsFromRequest([["x-skill", "on"]])).toEqual(DB_SKILLS);
    expect(activeSkillsFromRequest([["x-skill", "off"]])).toEqual([]);
    expect(activeSkillsFromRequest([["x-skill", "human-handwritten"]])).toEqual(["human-handwritten"]);

    // The old expression, for contrast — proves the test would have caught it.
    const legacy = resolveActiveSkillIds(
      DB_SKILLS,
      headersAsChatJsBuildsThem([["x-skill", "on"]])["x-skill"]?.[0] ??
        headersAsChatJsBuildsThem([["x-skill", "on"]])["x-skill"]
    );
    expect(legacy).not.toEqual(DB_SKILLS);
    expect(legacy).toEqual(["o"]);
  });

  it("no header falls back to the dashboard list", () => {
    expect(activeSkillsFromRequest([])).toEqual(DB_SKILLS);
  });

  it("an explicit csv list selects those ids", () => {
    expect(activeSkillsFromRequest([["x-skill", "commit-lint,human-handwritten"]]))
      .toEqual(["commit-lint", "human-handwritten"]);
  });

  it("is case-insensitive", () => {
    expect(activeSkillsFromRequest([["x-skill", "OFF"]])).toEqual([]);
    expect(activeSkillsFromRequest([["x-skill", "ON"]])).toEqual(DB_SKILLS);
  });

  it("a csv list longer than one character is never split into single chars", () => {
    const out = activeSkillsFromRequest([["x-skill", "commit-lint"]]);
    expect(out).toEqual(["commit-lint"]);
    expect(out).not.toEqual(["c"]);
  });

  it("survives an empty string header (falls back to the dashboard list)", () => {
    expect(activeSkillsFromRequest([["x-skill", ""]])).toEqual(DB_SKILLS);
  });
});
