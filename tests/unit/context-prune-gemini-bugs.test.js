import { describe, it, expect } from "vitest";
import { pruneContextMessages } from "../../open-sse/rtk/contextPruning.js";

// Follow-up audit: the `contents` (Gemini) branch is NOT covered by
// trimLeadingOrphans and can split a functionCall/functionResponse pair or
// leave the history starting on a model turn. normalizeGeminiContents
// (open-sse/translator/formats/gemini.js) inserts a synthetic user turn for
// exactly this requirement, and it runs BEFORE pruning — so pruning can undo it.

const user = (t) => ({ role: "user", parts: [{ text: `u${t}` }] });
const modelCall = (t) => ({ role: "model", parts: [{ functionCall: { id: `c${t}`, name: "f", args: {} } }] });
const userResp = (t) => ({ role: "user", parts: [{ functionResponse: { id: `c${t}`, name: "f", response: { result: t } } }] });

describe("pruneContextMessages — Gemini contents branch", () => {
  it("BUG: history can start on a model turn (leading-user guarantee lost)", () => {
    const body = { contents: [user("0"), ...Array.from({ length: 20 }, (_, i) => user(i + 1))] };
    body.contents[1] = modelCall("x"); // 21 entries → slice(-20) drops index 0
    pruneContextMessages(body, 20);
    expect(body.contents[0].role).toBe("user"); // ← FAILS: window now opens with "model"
  });

  it("BUG: functionResponse orphaned from its functionCall after slicing", () => {
    const contents = [];
    for (let t = 0; t < 5; t++) contents.push(user(t), modelCall(t), userResp(t));
    contents.push(user("final")); // 16 entries; limit 14 → keep last 14 → head = userResp(0)
    const body = { contents };
    pruneContextMessages(body, 14);

    // Every functionResponse must be preceded by a model turn carrying the same functionCall id.
    const seenCalls = new Set();
    for (const c of body.contents) {
      for (const p of c.parts || []) {
        if (p.functionCall) seenCalls.add(p.functionCall.id);
        if (p.functionResponse) {
          expect(seenCalls.has(p.functionResponse.id)).toBe(true); // ← FAILS for orphan
        }
      }
    }
  });

  it("CONTROL: untouched formats keep working (messages path stays green)", () => {
    const body = { messages: Array.from({ length: 21 }, (_, i) => ({ role: "user", content: `u${i}` })) };
    pruneContextMessages(body, 20);
    expect(body.messages.length).toBe(20);
  });
});