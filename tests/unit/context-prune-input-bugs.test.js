import { describe, it, expect } from "vitest";
import { pruneContextMessages } from "../../open-sse/rtk/contextPruning.js";

// Phase 3 hypothesis: the `body.input` (Responses) branch has the same root cause
// as the messages/contents branches — blind slice(-maxKeep) preserves no pairing
// invariant. Responses input items are {type:"message",role}, {type:"function_call",
// call_id}, {type:"function_call_output",call_id}, {type:"reasoning"}.
// Live providers using Responses: codex, github (copilot), grok-cli, opencode.

const userMsg = (t) => ({ type: "message", role: "user", content: [{ type: "input_text", text: `u${t}` }] });
const assistantMsg = (t) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text: `a${t}` }] });
const call = (t) => ({ type: "function_call", call_id: `c${t}`, name: "f", arguments: "{}" });
const output = (t) => ({ type: "function_call_output", call_id: `c${t}`, output: `r${t}` });

describe("pruneContextMessages — Responses input branch", () => {
  it("BUG: function_call_output orphaned from its function_call after slicing", () => {
    const input = [];
    for (let t = 0; t < 5; t++) input.push(userMsg(t), call(t), output(t));
    input.push(userMsg("final")); // 16 items; limit 14 → head = output(0), its call pruned
    const body = { input };
    pruneContextMessages(body, 14);

    const seenCalls = new Set();
    for (const item of body.input) {
      if (item.type === "function_call") seenCalls.add(item.call_id);
      if (item.type === "function_call_output") {
        // Responses API rejects an output with no matching call in the same request.
        expect(seenCalls.has(item.call_id)).toBe(true); // ← FAILS
      }
    }
  });

  it("BUG: window can open with a non-message item (reasoning/function_call_output)", () => {
    const input = [
      ...Array.from({ length: 12 }, (_, i) => userMsg(i)),
      { type: "reasoning", id: "r1", summary: [] },
      ...Array.from({ length: 8 }, (_, i) => userMsg(i + 100)),
    ]; // 21 items → limit 20 drops index 0 only, head stays user — control
    pruneContextMessages({ input }, 20);
    // now force head onto the reasoning item
    const input2 = [
      ...Array.from({ length: 20 }, (_, i) => userMsg(i)),
      assistantMsg("x"),
    ]; // 21 items, limit 20 → head = user(1) fine; rewrite to make head a call output
    const body2 = { input: [output("gone"), ...Array.from({ length: 21 }, (_, i) => userMsg(i))] };
    pruneContextMessages(body2, 20);
    expect(body2.input[0].type).not.toBe("function_call_output"); // ← FAILS: head is an orphan output
  });
});