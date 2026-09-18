import { describe, it, expect } from "vitest";
import { pruneContextMessages } from "../../open-sse/rtk/contextPruning.js";

// The `contents` (Gemini) branch needs its own handling: in the shape the
// translator builds ([user+text][model+functionCall][user+text+functionResponse]
// per round) repairing the head by dropping turns orphans every next result and
// collapses the window. normalizeGeminiContents (open-sse/translator/formats/
// gemini.js) also asserts the user-first rule that pruning must not undo.

const user = (t) => ({ role: "user", parts: [{ text: `u${t}` }] });
const modelCall = (t) => ({ role: "model", parts: [{ functionCall: { id: `c${t}`, name: "f", args: {} } }] });
const userResp = (t) => ({ role: "user", parts: [{ functionResponse: { id: `c${t}`, name: "f", response: { result: t } } }] });
const userTextResp = (t) => ({ role: "user", parts: [{ text: `u${t}` }, { functionResponse: { id: `c${t}`, name: "f", response: { result: t } } }] });

// Shape produced by openai-to-gemini for a tool-calling conversation.
const translatorShape = (rounds) => {
  const out = [user("0")];
  for (let t = 0; t < rounds; t++) out.push(modelCall(t), userTextResp(t));
  out.push(user("final"));
  return out;
};

const pairingHolds = (contents) => {
  const seenCalls = new Set();
  for (const c of contents) {
    for (const p of c.parts || []) {
      if (p.functionCall) seenCalls.add(p.functionCall.id);
      if (p.functionResponse && !seenCalls.has(p.functionResponse.id)) return false;
    }
  }
  return true;
};

describe("pruneContextMessages — Gemini contents branch", () => {
  it("does not start the window on a model turn", () => {
    const contents = [user("0"), ...Array.from({ length: 20 }, (_, i) => user(i + 1))];
    contents[1] = modelCall("x"); // 21 entries → slice(-20) drops index 0
    const body = { contents };
    pruneContextMessages(body, 20);
    expect(body.contents[0].role).toBe("user");
  });

  it("keeps the window size and pairing for the translator's tool-call shape", () => {
    const contents = translatorShape(14); // 2 entries per round + 2
    const body = { contents };
    pruneContextMessages(body, 20);
    expect(body.contents.length).toBe(20); // no collapse
    expect(body.contents[0].role).toBe("user");
    expect(pairingHolds(body.contents)).toBe(true);
  });

  it("drops the boundary tool results when the head turn cannot be a clean cut", () => {
    const contents = [user("0"), modelCall(0), userResp(0), modelCall(1), userResp(1), user("final")];
    const body = { contents };
    pruneContextMessages(body, 4);
    expect(body.contents.length).toBe(4);
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[0].parts.some((p) => p.functionResponse)).toBe(false);
    expect(pairingHolds(body.contents)).toBe(true);
  });

  it("prunes the Cloud Code envelope used by gemini-cli and antigravity", () => {
    // The translator wraps contents into { project, model, request: { contents } }
    // before pruning runs, so a top-level body.contents check never fires there.
    const body = {
      project: "p", model: "m",
      request: { contents: Array.from({ length: 25 }, (_, i) => user(i)) },
    };
    pruneContextMessages(body, 20);
    expect(body.request.contents.length).toBe(20);
    expect(body.request.contents[0].role).toBe("user");
  });

  it("CONTROL: messages path is unaffected", () => {
    const body = { messages: Array.from({ length: 21 }, (_, i) => ({ role: "user", content: `u${i}` })) };
    pruneContextMessages(body, 20);
    expect(body.messages.length).toBe(20);
  });
});