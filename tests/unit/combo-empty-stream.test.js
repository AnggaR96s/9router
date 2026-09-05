import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({ saveErrorLog: vi.fn() }));

const { handleComboChat } = await import("../../open-sse/services/combo.js");

function sse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("combo empty stream fallback", () => {
  it("tries the next model when the first stream has no content", async () => {
    const attempted = [];
    const response = await handleComboChat({
      body: { model: "combo", stream: true, messages: [{ role: "user", content: "hi" }] },
      models: ["a/one", "b/two"],
      handleSingleModel: async (_body, model) => {
        attempted.push(model);
        return model === "a/one"
          ? sse([": keepalive\n\ndata: [DONE]\n\n"])
          : sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
      },
      log: { info() {}, warn() {} },
      comboName: "test",
    });

    expect(attempted).toEqual(["a/one", "b/two"]);
    expect(await response.text()).toContain("ok");
  });
});
