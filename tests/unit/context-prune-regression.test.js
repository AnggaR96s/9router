import { describe, it, expect } from "vitest";
import { pruneContextMessages } from "../../open-sse/rtk/contextPruning.js";

// Regression tests for pruneContextMessages (see fix/context-prune-bugs):
// 1) off-by-one: exactly maxKeep+1 non-system messages were never pruned
// 2) orphaned tool results: slicing could open the window with a tool message
//    whose assistant tool_calls had been pruned away

const msg = (role, i) => ({ role, content: `${role}-${i}` });

describe("pruneContextMessages", () => {
  it("trims to maxKeep when non-system messages exceed the limit (off-by-one gate)", () => {
    const body = { messages: Array.from({ length: 21 }, (_, i) => msg("user", i)) };
    pruneContextMessages(body, 20);
    expect(body.messages.length).toBe(20);
  });

  it("keeps exactly maxKeep non-system + all system messages", () => {
    const body = {
      messages: [
        { role: "system", content: "SYS" },
        ...Array.from({ length: 30 }, (_, i) => msg("user", i)),
      ],
    };
    pruneContextMessages(body, 20);
    expect(body.messages.length).toBe(21);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("SYS");
  });

  it("drops orphaned leading tool results after slicing", () => {
    const turns = [];
    for (let t = 0; t < 5; t++) {
      turns.push(
        { role: "user", content: `u${t}` },
        { role: "assistant", content: null, tool_calls: [{ id: `c${t}`, type: "function", function: { name: "f", arguments: "{}" } }] },
        { role: "tool", tool_call_id: `c${t}`, content: `r${t}` }
      );
    }
    turns.push({ role: "user", content: "final" });
    const body = { messages: turns };
    pruneContextMessages(body, 14);

    for (let i = 0; i < body.messages.length; i++) {
      const m = body.messages[i];
      if (m.role === "tool") {
        const prev = body.messages[i - 1];
        expect(prev).toBeDefined();
        expect(prev.role).toBe("assistant");
        expect(prev.tool_calls).toBeDefined();
      }
    }
    expect(body.messages[0].role).not.toBe("tool");
  });

  it("honors the same gate for body.input (Responses format)", () => {
    const body = { input: Array.from({ length: 22 }, (_, i) => ({ role: "user", content: `u${i}` })) };
    pruneContextMessages(body, 20);
    expect(body.input.length).toBe(20);
  });
});