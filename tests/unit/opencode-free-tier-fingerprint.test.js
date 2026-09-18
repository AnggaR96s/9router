/**
 * OpenCode Zen's free tier fingerprints the official agentic client on four axes
 * (measured live 2026-09-18 against /zen/v1/chat/completions and /zen/v1/responses,
 * model big-pickle / muse-spark-1.3-contributor-free, Authorization: Bearer ***):
 *
 *   - versioned User-Agent .................... bare "opencode" and non-client UAs -> 403
 *   - session shaped like the client's ids .... "ses_" + 32 hex -> 403
 *   - the file-search tool quartet ............ 0-3 of {bash,glob,grep,read} -> 403
 *   - stream:true upstream .................... stream:false -> 403
 *
 * The first two were fixed earlier; plain chat callers send no tools and ask for
 * JSON, so they still get 403. These tests pin the two remaining axes: the quartet
 * is merged in, and the upstream body always streams.
 *
 * Declaration shape is NOT the same on both endpoints: chat/completions nests the
 * name under `function`, the Responses endpoint is flat. Measured: sending the
 * nested shape to /responses answers 400 invalid_request_error, not a gate error.
 */
import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import registry from "../../open-sse/providers/registry/opencode.js";

const QUARTET = ["bash", "glob", "grep", "read"];

const CALLER_TOOL = {
  type: "function",
  function: { name: "shell", description: "Run shell command", parameters: { type: "object", properties: {} } },
};

function transform(model, body, stream = false) {
  const executor = new OpenCodeExecutor();
  const out = executor.transformRequest(model, structuredClone(body), stream, { connectionId: "conn-1" });
  return out || body;
}

// Both shapes carry a name; read it without assuming which one it is.
const namesOf = (tools) => tools.map((t) => t.function?.name ?? t.name);

describe("OpenCode free-tier tool fingerprint", () => {
  it("merges the file-search quartet when the caller sends no tools", () => {
    const out = transform("big-pickle", { messages: [{ role: "user", content: "hi" }] });

    expect(namesOf(out.tools)).toEqual(expect.arrayContaining(QUARTET));
  });

  it("declares the quartet in the nested shape the chat endpoint expects", () => {
    const out = transform("big-pickle", { messages: [{ role: "user", content: "hi" }] });

    for (const tool of out.tools) {
      expect(tool.type).toBe("function");
      expect(typeof tool.function?.name).toBe("string");
      expect(tool.function?.parameters).toEqual({ type: "object", properties: {} });
    }
  });

  it("declares the quartet flat on the Responses endpoint", () => {
    const out = transform("muse-spark-1.3-contributor-free", { input: [], stream: true });

    for (const tool of out.tools) {
      expect(tool.type).toBe("function");
      expect(typeof tool.name).toBe("string");
      expect(tool.function).toBeUndefined();
    }
    expect(namesOf(out.tools)).toEqual(expect.arrayContaining(QUARTET));
  });

  it("keeps the caller's own tools and appends only the missing names", () => {
    const out = transform("big-pickle", { messages: [], tools: [CALLER_TOOL] });
    const names = namesOf(out.tools);

    expect(names).toContain("shell");
    for (const name of QUARTET) expect(names.filter((n) => n === name)).toHaveLength(1);
    expect(out.tools).toHaveLength(5);
  });

  it("does not replace a caller tool that already carries one of the quartet names", () => {
    const callerRead = {
      type: "function",
      function: { name: "read", description: "caller's own read", parameters: { type: "object", properties: { path: {} } } },
    };
    const out = transform("big-pickle", { messages: [], tools: [callerRead] });

    const read = out.tools.find((t) => t.function?.name === "read");
    expect(read).toEqual(callerRead);
    expect(namesOf(out.tools)).toHaveLength(4);
  });

  it("leaves the quartet out when the endpoint is not a fingerprinted one", () => {
    // union-alpha is served by the Anthropic /zen/v1/messages endpoint, which the
    // gate does not fingerprint; injecting OpenAI-shaped declarations there would
    // send tools the format cannot carry.
    const out = transform("union-alpha", { messages: [], max_tokens: 16 });

    expect(out.tools).toBeUndefined();
  });
});

describe("OpenCode free-tier User-Agent version floor", () => {
  const uaFor = (ua) => {
    const executor = new OpenCodeExecutor();
    return executor.buildHeaders({ rawHeaders: { "user-agent": ua } }, false)["User-Agent"];
  };

  it("forwards a versioned client User-Agent", () => {
    expect(uaFor("opencode/1.18.31")).toBe("opencode/1.18.31");
  });

  it("forwards a client from a later major line", () => {
    expect(uaFor("opencode/2.0.0")).toBe("opencode/2.0.0");
  });

  it("replaces a User-Agent below the version floor", () => {
    // Measured: "opencode/1.0.0" answers 426 UpgradeRequired, a status no other axis
    // returns, so an outdated downstream is answered with our own version instead.
    const fallback = uaFor("opencode");

    expect(uaFor("opencode/1.0.0")).toBe(fallback);
    expect(uaFor("opencode/0.9.7")).toBe(fallback);
    expect(uaFor("opencode/1.16.9")).toBe(fallback);
  });
});

describe("OpenCode free-tier streaming fingerprint", () => {
  it("forces stream:true upstream when the caller asked for JSON", () => {
    const out = transform("big-pickle", { messages: [], stream: false }, false);

    expect(out.stream).toBe(true);
  });

  it("keeps streaming on when the caller already asked for it", () => {
    const out = transform("big-pickle", { messages: [], stream: true }, true);

    expect(out.stream).toBe(true);
  });

  it("forces streaming on the Responses endpoint too", () => {
    const out = transform("muse-spark-1.2-contributor-free", { input: [], stream: false }, false);

    expect(out.stream).toBe(true);
  });
});

describe("OpenCode registry declares the forced-SSE transport", () => {
  it("sets forceStream so chatCore serves SSE and converts back for JSON clients", () => {
    expect(registry.transport.forceStream).toBe(true);
  });
});
