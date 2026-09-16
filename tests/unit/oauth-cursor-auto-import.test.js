import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";
import { execFile } from "child_process";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// The route reads the Cursor DB through a bare `require("better-sqlite3")` so it
// stays importable when the native bindings are missing. Under vitest that
// `require` bypasses the ESM mock registry and loads the real native module,
// whose constructor then fails on the mocked path — so strategy 1 is inert here
// and the route always falls through to its sqlite3-CLI strategy. The CLI
// (`child_process.execFile`) is therefore the mock that decides what the DB
// "contains"; the better-sqlite3 mock below is kept only to pin that strategy 1
// is expected to exist and to exercise its failure path.
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

// Shared mock db instance
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 as a class so `new Database(...)` works
vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN");
      }
      return mockDbInstance;
    }
  },
}));

const MAC_DB =
  "/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb";
const POSIX_DBS = [
  "/mock/home/.config/Cursor/User/globalStorage/state.vscdb",
  "/mock/home/.config/cursor/User/globalStorage/state.vscdb",
];

/** Default: every external command fails (no `which cursor`, no `sqlite3`). */
function noCli() {
  vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
    const done = typeof opts === "function" ? opts : cb;
    return done(new Error(`${cmd} unavailable`));
  });
}

/**
 * Fake the sqlite3 CLI. `rows` maps an itemTable key to the raw value the CLI
 * prints for `SELECT value FROM itemTable WHERE key='<key>' LIMIT 1`; a key that
 * is absent prints an empty line (what sqlite3 does for no match).
 */
function cliDb(rows = {}) {
  vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
    const done = typeof opts === "function" ? opts : cb;
    if (cmd === "which") return done(new Error("not found"));
    const sql = Array.isArray(args) ? String(args[1] ?? "") : "";
    const hit = Object.keys(rows).find((key) => sql.includes(`'${key}'`));
    return done(null, { stdout: hit ? `${rows[hit]}\n` : "\n", stderr: "" });
  });
}

/** SQL statements the route sent to the sqlite3 CLI, in call order. */
function sqlCalls() {
  return vi
    .mocked(execFile)
    .mock.calls.filter(([cmd]) => cmd === "sqlite3")
    .map(([, args]) => String(args[1]));
}

// We need to dynamically import after mocks are registered
let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    noCli();
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    // The route now lists every candidate path it probed instead of naming a platform.
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain("Checked locations:");
  });

  it("falls back to manual paste when the macOS db file exists but cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    // Both extraction strategies fail here, so the route asks the user to paste the
    // tokens (windowsManual + dbPath) rather than reporting an error — but it must
    // still never claim the tokens were found.
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBeTruthy();
  });

  // ── Token extraction (sqlite3 CLI strategy) ───────────────────────────

  it("extracts tokens using exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    cliDb({
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });

    const response = await GET();

    expect(response.body).toEqual({
      found: true,
      accessToken: "test-token",
      machineId: "test-machine-id",
    });
    // Read the macOS candidate path, and probed each key in priority order.
    expect(vi.mocked(execFile).mock.calls[0][1][0]).toBe(MAC_DB);
    expect(sqlCalls()[0]).toContain("key='cursorAuth/accessToken'");
    expect(sqlCalls()[1]).toContain("key='storage.serviceMachineId'");
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    cliDb({
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    });

    const response = await GET();

    expect(response.body).toEqual({
      found: true,
      accessToken: "json-token",
      machineId: "json-machine-id",
    });
  });

  // ── No fuzzy promotion: only the exact keys are accepted ──────────────

  it("does not promote unrelated keys to tokens (no fuzzy key matching)", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    // Fuzzy LIKE matching used to promote any '*accessToken*' / '*machineId*' key.
    // The route now queries only the exact keys, so these must be ignored.
    cliDb({
      "cursorAuth/someOtherAccessTokenKey": "fallback-token",
      "storage.someMachineId": "fallback-machine",
    });

    const response = await GET();

    expect(response.body).toEqual({
      found: false,
      windowsManual: true,
      dbPath: MAC_DB,
    });
    expect(response.body.accessToken).toBeUndefined();
    expect(response.body.machineId).toBeUndefined();
    expect(sqlCalls().every((sql) => !sql.includes("LIKE"))).toBe(true);
  });

  it("never reports success with only one of the two tokens", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    cliDb({ "cursorAuth/accessToken": "lonely-token" });

    const response = await GET();

    // accessToken without machineId is not a usable credential pair: the route
    // must fall through to its manual-paste response, not report found.
    expect(response.body).toEqual({
      found: false,
      windowsManual: true,
      dbPath: MAC_DB,
    });
  });

  // ── Platform-specific handling ────────────────────────────────────────

  it("linux reports a dedicated error when the db exists but Cursor is not installed", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    // The state.vscdb path is readable; the app itself is missing (no `which
    // cursor`, no cursor.desktop file).
    vi.mocked(fsPromises.access).mockImplementation(async (target) => {
      if (String(target).endsWith("state.vscdb")) return;
      throw new Error("ENOENT");
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      found: false,
      error:
        "Cursor config files found but Cursor IDE does not appear to be installed. Skipping auto-import.",
    });
    expect(vi.mocked(execFile).mock.calls[0][0]).toBe("which");
    // Never reaches the DB readers.
    expect(sqlCalls()).toEqual([]);
  });

  it("unknown platforms fall back to the generic not-found response", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    // There is no platform whitelist: non-darwin/win32 platforms are probed with
    // the POSIX candidates and the response lists what was checked (HTTP 200).
    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Checked locations:");
    for (const candidate of POSIX_DBS) {
      expect(response.body.error).toContain(candidate);
    }
  });
});
