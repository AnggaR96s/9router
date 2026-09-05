import { describe, expect, it } from "vitest";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("public /models catalog filters", () => {
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
