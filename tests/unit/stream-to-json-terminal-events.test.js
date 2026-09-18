import { describe, it, expect, vi } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

// A Responses API stream can end in more than one way, and the converter only
// understood `completed`/`failed`: a stream that stopped early (the upstream
// reports `response.incomplete` when the output cap is hit) left the JSON at
// `status: "in_progress"` with `output: []`, so a non-streaming client received a
// body with no answer in it. The terminal event carries the authoritative
// `output`, and it must be read whenever no `output_item.done` arrived.

const sse = (events) =>
  new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const [type, payload] of events) {
        controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`));
      }
      controller.close();
    },
  });

const message = (text) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});

describe("responses stream to json", () => {
  it("reads a terminal response.incomplete instead of reporting in_progress", async () => {
    const out = await convertResponsesStreamToJson(
      sse([
        ["response.created", { response: { id: "resp_1", created_at: 1 } }],
        ["response.in_progress", { response: { id: "resp_1" } }],
        ["response.output_item.added", { output_index: 0, item: { type: "reasoning" } }],
        [
          "response.incomplete",
          {
            response: {
              id: "resp_1",
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              output: [message("PROBE_OK")],
              usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
            },
          },
        ],
      ])
    );

    expect(out.status).toBe("incomplete");
    expect(JSON.stringify(out.output)).toContain("PROBE_OK");
    expect(out.usage.total_tokens).toBe(7);
  });

  it("prefers the terminal event's own output when nothing was finalised", async () => {
    const out = await convertResponsesStreamToJson(
      sse([
        ["response.created", { response: { id: "resp_2" } }],
        [
          "response.completed",
          { response: { id: "resp_2", status: "completed", output: [message("FINAL")] } },
        ],
      ])
    );

    expect(out.status).toBe("completed");
    expect(JSON.stringify(out.output)).toContain("FINAL");
  });

  it("keeps item-derived output when the stream does carry item.done", async () => {
    const out = await convertResponsesStreamToJson(
      sse([
        ["response.created", { response: { id: "resp_3" } }],
        ["response.output_item.done", { output_index: 0, item: message("LEGACY") }],
        ["response.completed", { response: { id: "resp_3", status: "completed" } }],
      ])
    );

    expect(out.status).toBe("completed");
    expect(JSON.stringify(out.output)).toContain("LEGACY");
  });

  it("reports a failed terminal event as failed", async () => {
    const out = await convertResponsesStreamToJson(
      sse([
        ["response.created", { response: { id: "resp_4" } }],
        ["response.failed", { response: { id: "resp_4", status: "failed" } }],
      ])
    );

    expect(out.status).toBe("failed");
  });
});

describe("a truncated provider stream reaching a chat client", () => {
  const ctx = () => {
    const enc = new TextEncoder();
    const frames = [
      ["response.created", { response: { id: "resp_t", created_at: 1 } }],
      ["response.in_progress", { response: { id: "resp_t" } }],
      ["response.output_item.added", { output_index: 0, item: { type: "reasoning" } }],
      [
        "response.incomplete",
        {
          response: {
            id: "resp_t",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [],
            usage: { input_tokens: 5, output_tokens: 60, total_tokens: 65 }
          }
        }
      ]
    ]
      .map(([type, payload]) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n`)
      .join("\n");

    return {
      providerResponse: new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(enc.encode(frames));
            controller.close();
          }
        }),
        { headers: { "content-type": "text/event-stream" } }
      ),
      // sourceFormat is the CLIENT format, targetFormat the provider's: a chat
      // client behind a Responses-API upstream is the pair that hits the converter.
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "opencode",
      model: "muse-spark-1.3-contributor-free",
      body: { model: "muse-spark-1.3-contributor-free", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-truncated",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      trackDone: vi.fn(),
      appendLog: vi.fn()
    };
  };

  it("reports finish_reason length instead of an unknown status", async () => {
    const result = await handleForcedSSEToJson(ctx());
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].finish_reason).toBe("length");
  });
});