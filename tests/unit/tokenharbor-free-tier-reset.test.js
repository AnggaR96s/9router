import { describe, it, expect } from "vitest";
import DefaultExecutor from "../../open-sse/executors/default.js";

// parseError only honours a reset that is still ahead of Date.now()
// (open-sse/executors/default.js: `resetMs > Date.now()`), so the fixture is
// built relative to now — a frozen literal rots into the past and stops
// exercising the extraction it is meant to lock.
const isoLater = (msFromNow) =>
  new Date(Date.now() + msFromNow).toISOString().replace(/\.\d{3}Z$/, ".634411+00:00");

const FAR_FUTURE_ISO = isoLater(7 * 24 * 60 * 60 * 1000);

const rollingBody = (iso) =>
  JSON.stringify({
    error: {
      message:
        "You've used this period's free allowance. Your next rolling 7-day period " +
        `starts at ${iso}. Use the paid model 'deepseek-v4-flash' ` +
        "to keep going, or subscribe to a Token Harbor Pass.",
      type: "free_tier_limit_reached",
      code: "free_tier_limit_reached",
    },
  });

describe("DefaultExecutor.parseError — tokenharbor free-tier rolling reset", () => {
  it("extracts resetsAtMs from the rolling-period message", () => {
    const exec = new DefaultExecutor("tokenharbor");
    const parsed = exec.parseError({ status: 429 }, rollingBody(FAR_FUTURE_ISO));
    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBe(Date.parse(FAR_FUTURE_ISO));
  });

  it("ignores a rolling-period timestamp that already passed", () => {
    const exec = new DefaultExecutor("tokenharbor");
    const parsed = exec.parseError(
      { status: 429 },
      rollingBody(isoLater(-24 * 60 * 60 * 1000))
    );
    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBeUndefined();
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