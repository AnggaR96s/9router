/**
 * Context Truncation & Pruning Helper for 9Router
 * Trims old conversation messages while preserving System prompts and recent turns.
 */

// A pruned window must stay valid for its wire format, otherwise the provider
// rejects the request. Cutting to the newest N entries can leave the window head
// on an entry whose counterpart was pruned (a tool result without its tool_calls,
// a function_call_output without its function_call) or on a turn the provider
// refuses as the first entry (Gemini needs a user turn first).
function trimInvalidHead(items, isInvalid) {
  let i = 0;
  while (i < items.length - 1 && isInvalid(items[i])) i++;
  return i > 0 ? items.slice(i) : items;
}

const isValidMessagesHead = (m) => m.role !== "tool";
const isValidInputHead = (it) => it.type !== "function_call_output" && it.type !== "custom_tool_call_output";

// Gemini contents cannot be repaired by dropping the head turn: in the shape the
// translator builds ([user][model+functionCall][user+functionResponse] per round)
// every heal-by-dropping step orphans the next turn's result and the window
// collapses to a single entry. Drop only model-first turns, and keep the tool
// results out of the head turn — they belong to the boundary being pruned anyway.
function pruneContents(contents, maxKeep) {
  let kept = contents.slice(Math.max(0, contents.length - maxKeep));
  while (kept.length > 1 && kept[0]?.role !== "user") kept = kept.slice(1);
  const head = kept[0];
  if (!head || head.role !== "user") return kept;

  const parts = head.parts || [];
  if (!parts.some((p) => p && p.functionResponse)) return kept;
  const keptParts = parts.filter((p) => !(p && p.functionResponse));
  return [{ ...head, parts: keptParts.length ? keptParts : [{ text: "..." }] }, ...kept.slice(1)];
}

export function pruneContextMessages(body, limit = 20) {
  if (!body || typeof body !== "object") return;
  const maxKeep = Math.max(4, Number(limit) || 20);

  // OpenAI / Claude format: body.messages
  if (Array.isArray(body.messages) && body.messages.length > maxKeep) {
    const systemMsgs = body.messages.filter((m) => m.role === "system");
    const nonSystemMsgs = body.messages.filter((m) => m.role !== "system");

    if (nonSystemMsgs.length > maxKeep) {
      const keptNonSystem = nonSystemMsgs.slice(-maxKeep);
      body.messages = [...systemMsgs, ...trimInvalidHead(keptNonSystem, (m) => !isValidMessagesHead(m))];
    }
  }

  // OpenAI Responses format: body.input
  if (Array.isArray(body.input) && body.input.length > maxKeep) {
    const systemInputs = body.input.filter((m) => m.role === "system");
    const nonSystemInputs = body.input.filter((m) => m.role !== "system");

    if (nonSystemInputs.length > maxKeep) {
      const keptNonSystem = nonSystemInputs.slice(-maxKeep);
      body.input = [...systemInputs, ...trimInvalidHead(keptNonSystem, (it) => !isValidInputHead(it))];
    }
  }

  // Gemini format: body.contents, or the Cloud Code envelope
  // ({ project, model, request: { contents } }) that gemini-cli and antigravity
  // send — the translator wraps contents before pruning runs.
  const gemini = Array.isArray(body.contents)
    ? body
    : Array.isArray(body.request?.contents)
      ? body.request
      : null;
  if (gemini && gemini.contents.length > maxKeep) {
    gemini.contents = pruneContents(gemini.contents, maxKeep);
  }
}