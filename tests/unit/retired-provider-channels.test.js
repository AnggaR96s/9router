import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import opencodeRegistry from "../../open-sse/providers/registry/opencode.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Retired 2026-09-18. "union-alpha" was the one Zen free id the anonymous tier
// served on the Anthropic /zen/v1/messages endpoint instead of /chat/completions;
// dropping the id takes that floating route with it, so the provider is back to
// two fingerprinted endpoints and no registered id is exempt from the gate.
const RETIRED_OPENCODE_MODEL_IDS = ["union-alpha"];

const ZEN_CHAT = "https://opencode.ai/zen/v1/chat/completions";
const ZEN_RESPONSES = "https://opencode.ai/zen/v1/responses";

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

describe("retired OpenCode Zen free id is fully gone", () => {
  const oc = () => getExecutor("opencode");

  it("keeps no catalog entry, in the registry or in the served list", () => {
    const served = (PROVIDER_MODELS.oc || []).map((m) => m.id ?? m);
    const registered = opencodeRegistry.models.map((m) => m.id);

    for (const id of RETIRED_OPENCODE_MODEL_IDS) {
      expect(registered, `registry lists ${id}`).not.toContain(id);
      expect(served, `served catalog lists ${id}`).not.toContain(id);
    }
  });

  it("leaves no route to the Anthropic endpoint that only served it", () => {
    const ids = [...opencodeRegistry.models.map((m) => m.id), ...RETIRED_OPENCODE_MODEL_IDS];

    for (const id of ids) {
      expect(oc().buildUrl(id), id).not.toContain("/messages");
    }
  });

  it("keeps the Zen ids that still serve traffic on the fingerprinted endpoints", () => {
    expect(oc().buildUrl("big-pickle")).toBe(ZEN_CHAT);
    expect(oc().buildUrl("mimo-v2.5-free")).toBe(ZEN_CHAT);
    expect(oc().buildUrl("muse-spark-1.3-contributor-free")).toBe(ZEN_RESPONSES);
  });

  it("does not re-import the id from the live Zen catalog", () => {
    const out = FILTERS["opencode-free"]([{ id: "union-alpha" }, { id: "big-pickle" }]);

    expect(out.map((m) => m.id)).toEqual(["big-pickle"]);
  });
});