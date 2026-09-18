import { describe, expect, it } from "vitest";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("public /models catalog filters", () => {
  it("imports only the free OpenCode ids, minus the ones upstream answers 404 for", () => {
    const out = FILTERS["opencode-free"]([
      { id: "big-pickle" },
      { id: "muse-spark-1.3-contributor-free" },
      { id: "union-alpha" },
      { id: "deepseek-v4-flash-free" },
      { id: "claude-fable-5" },
    ]);

    expect(out.map((m) => m.id)).toEqual(["big-pickle", "muse-spark-1.3-contributor-free"]);
  });

  it("normalizes OpenAI-style model entries for bulk import", () => {
    expect(FILTERS.openai([
      { id: "alpha", name: "Alpha" },
      { id: "beta" },
      { name: "fallback-name" },
      { id: "" },
      null,
    ])).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "beta" },
      { id: "fallback-name", name: "fallback-name" },
    ]);
  });
});
