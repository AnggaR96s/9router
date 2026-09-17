/**
 * Context Truncation & Pruning Helper for 9Router
 * Trims old conversation messages while preserving System prompts and recent turns.
 */

function trimLeadingOrphans(msgs) {
  // After slicing to the newest N messages, the window may open with a `tool`
  // result whose assistant tool_calls was pruned away — drop orphans so the
  // upstream conversation stays valid.
  const firstValid = msgs.findIndex((m) => m.role !== "tool");
  return firstValid > 0 ? msgs.slice(firstValid) : msgs;
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
      body.messages = [...systemMsgs, ...trimLeadingOrphans(keptNonSystem)];
    }
  }

  // OpenAI Responses format: body.input
  if (Array.isArray(body.input) && body.input.length > maxKeep) {
    const systemInputs = body.input.filter((m) => m.role === "system");
    const nonSystemInputs = body.input.filter((m) => m.role !== "system");

    if (nonSystemInputs.length > maxKeep) {
      const keptNonSystem = nonSystemInputs.slice(-maxKeep);
      body.input = [...systemInputs, ...trimLeadingOrphans(keptNonSystem)];
    }
  }

  // Gemini format: body.contents
  if (Array.isArray(body.contents) && body.contents.length > maxKeep) {
    body.contents = body.contents.slice(-maxKeep);
  }
}