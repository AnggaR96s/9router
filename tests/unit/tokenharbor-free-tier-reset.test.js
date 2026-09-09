import { describe, it, expect, vi } from "vitest";
import DefaultExecutor from "../../open-sse/executors/default.js";

describe("DefaultExecutor.parseError — tokenharbor free-tier rolling reset", () => {
  it("extracts resetsAtMs from the rolling-period message", () => {
    const exec = new DefaultExecutor("tokenharbor");
    const body = JSON.stringify({
      error: {
        message:
          "You've used this period's free allowance. Your next rolling 7-day period " +
          "starts at 2026-09-12T13:14:06.634411+00:00. Use the paid model 'deepseek-v4-flash' " +
          "to keep going, or subscribe to a Token Harbor Pass.",
        type: "free_tier_limit_reached",
        code: "free_tier_limit_reached",
      },
    });
    const parsed = exec.parseError({ status: 429 }, body);
    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBe(Date.parse("2026-09-12T13:14:06.634411+00:00"));
  });

  it("falls through when no future reset timestamp is present", () => {
    const exec = new DefaultExecutor("whatever");
    const parsed = exec.parseError(
      { status: 429 },
      JSON.stringify({ error: { message: "plain rate limited" } })
    );
    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it("falls through for non-429 errors", () => {
    const exec = new DefaultExecutor("whatever");
    const parsed = exec.parseError(
      { status: 500 },
      JSON.stringify({ error: { message: "next rolling 7-day period starts at 2030-01-01T00:00:00+00:00" } })
    );
    expect(parsed.resetsAtMs).toBeUndefined();
  });
});