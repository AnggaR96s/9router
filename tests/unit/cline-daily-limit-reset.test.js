import { describe, it, expect } from "vitest";
import DefaultExecutor from "../../open-sse/executors/default.js";

describe("DefaultExecutor.parseError — relative retry windows (Cline daily cap)", () => {
  const bodyFor = (message) =>
    JSON.stringify({ error: { code: "INFERENCE_CAP_ERROR", message } });

  it("extracts 'Try again in 19h 46m' as an absolute resetsAtMs", () => {
    const exec = new DefaultExecutor("cline");
    const before = Date.now();
    const parsed = exec.parseError(
      { status: 429 },
      bodyFor(
        "Error 429: Daily free limit reached on model deepseek/deepseek-v4-flash-0731. Try again in 19h 46m"
      )
    );
    const after = Date.now();
    expect(parsed.status).toBe(429);
    const expectedMs = (19 * 3600 + 46 * 60) * 1000;
    expect(parsed.resetsAtMs).toBeGreaterThan(before + expectedMs - 2000);
    expect(parsed.resetsAtMs).toBeLessThan(after + expectedMs + 2000);
  });

  it("handles minutes-only and seconds-only windows", () => {
    const exec = new DefaultExecutor("cline");
    const p1 = exec.parseError({ status: 429 }, bodyFor("... Try again in 45m"));
    const ms1 = p1.resetsAtMs - Date.now();
    expect(ms1).toBeGreaterThan(44 * 60 * 1000);
    expect(ms1).toBeLessThan(46 * 60 * 1000);

    const p2 = exec.parseError({ status: 429 }, bodyFor("... Try again in 30s"));
    const ms2 = p2.resetsAtMs - Date.now();
    expect(ms2).toBeGreaterThan(29 * 1000);
    expect(ms2).toBeLessThan(31 * 1000);
  });

  it("does not false-positive on 'Try again later'", () => {
    const exec = new DefaultExecutor("cline");
    const parsed = exec.parseError({ status: 429 }, bodyFor("Error 429: Try again later"));
    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it("falls through for non-429 errors", () => {
    const exec = new DefaultExecutor("cline");
    const parsed = exec.parseError(
      { status: 500 },
      bodyFor("Error 500: Daily free limit reached. Try again in 19h 46m")
    );
    expect(parsed.resetsAtMs).toBeUndefined();
  });
});