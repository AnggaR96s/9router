import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Retired 2026-07-26T10:00:00Z by Xiaomi (packages/opencode/src/util/free-api-sunset.ts
// upstream). Both ids fronted the same dead channel; the alias "mmf" lived on the
// "mimo-free" entry, so dropping either one alone leaves the other advertised.
const RETIRED_PROVIDER_IDS = ["mmf", "mimo-free"];

describe("retired MiMo free channel is fully gone", () => {
  it("keeps no registry entry", () => {
    for (const id of RETIRED_PROVIDER_IDS) {
      expect(PROVIDERS[id]).toBeUndefined();
      expect(PROVIDER_MODELS[id]).toBeUndefined();
    }
  });

  it("keeps no registry or executor source file", () => {
    const stale = [
      "open-sse/providers/registry/mmf.js",
      "open-sse/providers/registry/mimo-free.js",
      "open-sse/executors/mimo-free.js",
    ].filter((rel) => existsSync(resolve(REPO, rel)));

    expect(stale).toEqual([]);
  });

  it("routes its ids to the default executor instead of a dead-channel executor", () => {
    for (const id of RETIRED_PROVIDER_IDS) {
      expect(getExecutor(id).constructor.name).toBe("DefaultExecutor");
    }
  });

  it("leaves no suggested-models filter behind", () => {
    expect(FILTERS["mimo-free"]).toBeUndefined();
  });

  it("keeps the MiMo routes that still serve traffic", () => {
    // oc/mimo-v2.5-free (OpenCode Zen) answers 200; xiaomi-mimo is the keyed route.
    const live = Object.keys(PROVIDER_MODELS).filter((id) => id.includes("mimo"));
    expect(live).toContain("xiaomi-mimo");
    expect(PROVIDER_MODELS["xiaomi-mimo"].some((m) => m.id === "mimo-v2.5")).toBe(
      true,
    );
  });
});