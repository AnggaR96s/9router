/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */

/**
 * Process a single SSE message and update state accordingly.
 */
// Terminal events, and the status each one reports. `response.completed` is not
// the only way a stream ends: an upstream that hits the output cap sends
// `response.incomplete`, and treating that as "still running" handed a
// non-streaming client `status: "in_progress"` with an empty `output`.
const TERMINAL_EVENTS = {
  "response.completed": "completed",
  "response.done": "completed",
  "response.incomplete": "incomplete",
  "response.failed": "failed",
  "response.cancelled": "cancelled"
};

function processSSEMessage(msg, state) {
  if (!msg.trim()) return;

  const eventMatch = msg.match(/^event:\s*(.+)$/m);
  const dataMatch = msg.match(/^data:\s*(.+)$/m);
  if (!eventMatch || !dataMatch) return;

  const eventType = eventMatch[1].trim();
  const dataStr = dataMatch[1].trim();
  if (dataStr === "[DONE]") return;

  let parsed;
  try { parsed = JSON.parse(dataStr); }
  catch { return; }

  if (eventType === "response.created") {
    state.responseId = parsed.response?.id || state.responseId;
    state.created = parsed.response?.created_at || state.created;
  } else if (eventType === "response.output_item.done") {
    state.items.set(parsed.output_index ?? 0, parsed.item);
  } else if (TERMINAL_EVENTS[eventType]) {
    state.status = TERMINAL_EVENTS[eventType];
    // The terminal event carries the whole response object, so it is the only
    // place the answer exists when the stream stopped before any item was
    // finalised (`output_item.done` never arrived).
    const finalOutput = parsed.response?.output;
    if (Array.isArray(finalOutput) && finalOutput.length > 0) state.finalOutput = finalOutput;
    if (parsed.response?.incomplete_details) state.incompleteDetails = parsed.response.incomplete_details;
    if (parsed.response?.usage) {
      state.usage.input_tokens = parsed.response.usage.input_tokens || 0;
      state.usage.output_tokens = parsed.response.usage.output_tokens || 0;
      state.usage.total_tokens = parsed.response.usage.total_tokens || 0;
    }
  }
}

const EMPTY_RESPONSE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream) {
  if (!stream || typeof stream.getReader !== "function") {
    return { id: `resp_${Date.now()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "failed", output: [], usage: { ...EMPTY_RESPONSE } };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const state = {
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    status: "in_progress",
    usage: { ...EMPTY_RESPONSE },
    finalOutput: null,
    incompleteDetails: null,
    items: new Map()
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const msg of messages) {
        processSSEMessage(msg, state);
      }
    }

    // Flush remaining buffer (last event may not end with \n\n)
    if (buffer.trim()) {
      processSSEMessage(buffer, state);
    }
  } finally {
    reader.releaseLock();
  }

  // Build output array: the terminal event wins when it carried one, otherwise
  // fall back to the items that were finalised (ordered by index).
  let output = state.finalOutput;
  if (!output) {
    output = [];
    const maxIndex = state.items.size > 0 ? Math.max(...state.items.keys()) : -1;
    for (let i = 0; i <= maxIndex; i++) {
      output.push(state.items.get(i) || { type: "message", content: [], role: "assistant" });
    }
  }

  const result = {
    id: state.responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: state.created,
    status: state.status || "completed",
    output,
    usage: state.usage
  };
  if (state.incompleteDetails) result.incomplete_details = state.incompleteDetails;
  return result;
}
