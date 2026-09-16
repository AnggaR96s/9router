import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

// cursorModels.js talks to agent.api5.cursor.sh, which is HTTP/2-only — Node
// fetch/undici cannot speak h2, so the catalog is fetched with node:http2 and
// the raw protobuf is sent as an unframed `application/proto` body. The
// transport is therefore mocked at the http2 layer, not via global.fetch.
const h2 = vi.hoisted(() => {
  class FakeEmitter {
    constructor() { this._listeners = {}; }
    on(event, fn) { (this._listeners[event] ||= []).push(fn); return this; }
    once(event, fn) {
      const wrapped = (...args) => { this.off(event, wrapped); fn(...args); };
      return this.on(event, wrapped);
    }
    off(event, fn) { this._listeners[event] = (this._listeners[event] || []).filter((f) => f !== fn); return this; }
    removeListener(event, fn) { return this.off(event, fn); }
    emit(event, ...args) {
      const fns = [...(this._listeners[event] || [])];
      for (const fn of fns) fn(...args);
      return fns.length > 0;
    }
  }

  const state = { calls: [], response: { status: 200, body: Buffer.alloc(0) } };

  state.connect = (origin) => {
    const client = new FakeEmitter();
    client.origin = origin;
    client.closed = false;
    client.close = () => { client.closed = true; };
    client.request = (headers) => {
      const req = new FakeEmitter();
      req.headers = headers;
      req.end = (chunk) => {
        state.calls.push({ origin, headers, body: chunk ?? null });
        setTimeout(() => {
          const { status, body, error } = state.response;
          if (error) { req.emit("error", error); return; }
          req.emit("response", { ":status": status });
          if (body && body.length) req.emit("data", Buffer.from(body));
          req.emit("end");
        }, 0);
      };
      return req;
    };
    return client;
  };

  return state;
});

vi.mock("http2", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, connect: h2.connect } };
});

vi.mock("node:http2", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, connect: h2.connect } };
});

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
    h2.calls.length = 0;
    h2.response = { status: 200, body: Buffer.alloc(0) };
  });

  afterEach(() => {
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog over HTTP/2 and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    h2.response = { status: 200, body: Buffer.from(payload) };
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    // Second call is served from the cache — exactly one request on the wire.
    expect(h2.calls).toHaveLength(1);
    expect(h2.calls[0].origin).toBe("https://agent.api5.cursor.sh");
    expect(h2.calls[0].headers).toMatchObject({
      ":method": "POST",
      ":path": "/agent.v1.AgentService/GetUsableModels",
      ":authority": "agent.api5.cursor.sh",
      ":scheme": "https",
      "content-type": "application/proto",
      accept: "application/proto",
    });
    // Unary Connect call: the protobuf body is unframed, and an empty request
    // message means nothing is written to the stream.
    expect(h2.calls[0].body).toBeNull();
  });

  it("fails open when the Cursor catalog request fails", async () => {
    h2.response = { status: 403, body: Buffer.alloc(0) };

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
    expect(h2.calls).toHaveLength(1);
  });

  it("fails open when the HTTP/2 request throws", async () => {
    h2.response = { status: 0, error: new Error("socket hang up") };

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});