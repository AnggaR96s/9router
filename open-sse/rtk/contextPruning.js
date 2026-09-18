/**
 * Context Truncation & Pruning Helper for 9Router
 * Trims old conversation messages while preserving System prompts and recent turns.
 */

// A pruned window must stay valid for its wire format. Cutting to the newest N
// entries can otherwise leave the window opening on an entry whose counterpart
// was dropped (tool result without tool_calls, function_call_output without
// function_call, Gemini functionResponse without functionCall) or on a turn the
// provider rejects as the first entry (Gemini requires a user turn first).
function trimInvalidHead(items, isInvalid) {
  let i = 0;
  while (i < items.length - 1 && isInvalid(items[i])) i++;
  return i > 0 ? items.slice(i) : items;
}

const isValidMessagesHead = (m) => m.role !== "tool";
const isValidInputHead = (it) => it.type !== "function_call_output" && it.type !== "custom_tool_call_output";
const isValidContentsHead = (c) =>
  c.role === "user" && !(c.parts || []).some((p) => p && p.functionResponse);

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

  // Gemini format: body.contents
  if (Array.isArray(body.contents) && body.contents.length > maxKeep) {
    body.contents = trimInvalidHead(body.contents.slice(-maxKeep), (c) => !isValidContentsHead(c));
  }
}