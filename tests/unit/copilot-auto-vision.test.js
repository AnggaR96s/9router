import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getCapabilitiesForModel, PROVIDER_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { resolveProviderId } from "../../src/shared/constants/providers.js";

const repoRoot = new URL("../../", import.meta.url);

// Copilot's "Auto" disappeared from the model picker whenever a capability filter
// was on. The picker reads caps via getCaps(m.value)?.[capFilter] and Auto is the
// row it offers first, so a vision filter dropped the id a user picks exactly when
// they do not want to choose a model.
//
// Nothing in the fallback can describe it: the concrete model behind Auto is
// decided per account and per request, so MODEL_CAPABILITIES, the pattern table and
// the models.dev catalog all answer vision:false for a synthetic id they have never
// seen. The entry has to be hand written.
//
// It also has to be keyed the way the table is keyed. PROVIDER_CAPABILITIES entries
// are registry ids (codex, kiro, qoder… whose aliases are cx, kr, qd), and the two
// consumers disagree: the public /api/v1/models listing resolves alias -> id before
// asking, while the dashboard's /api/models used to pass the alias straight
// through. An entry keyed by the alias therefore fixed the picker and left the
// listing — and a registry-id entry would do the reverse.
describe("copilot auto capabilities", () => {
  it("marks github/auto as vision-capable", () => {
    expect(getCapabilitiesForModel("github", "auto").vision).toBe(true);
  });

  it("keeps a reasoning window for github/auto", () => {
    const caps = getCapabilitiesForModel("github", "auto");
    expect(caps.reasoning).toBe(true);
    // Auto resolves per account, so the window is the honest floor of the family it
    // lands on rather than the largest one it could reach: gh/claude-opus-4.8
    // reports 1M but gh/gpt-5.4 reports 400K, and over-claiming a window wedges a
    // thread while under-claiming only prunes early.
    expect(caps.contextWindow).toBe(400000);
  });

  it("reaches the same entry from either side of the alias", () => {
    const alias = PROVIDER_ID_TO_ALIAS.github;
    expect(alias).toBe("gh");
    // The listing resolves the alias first, the picker passes what it has; both must
    // land on the entry.
    expect(getCapabilitiesForModel(resolveProviderId(alias), "auto").vision).toBe(true);
    expect(resolveProviderId("github")).toBe("github");
  });

  it("keys every provider entry by registry id, never by alias", () => {
    // A convention guard: entries keyed by an alias silently miss the consumers that
    // resolve first, which is how gh/auto stayed broken for the picker.
    const aliasKeyed = Object.keys(PROVIDER_CAPABILITIES)
      .filter((key) => resolveProviderId(key) !== key && !PROVIDER_ID_TO_ALIAS[key])
      .sort();
    expect(aliasKeyed).toEqual([]);
  });

  it("does not blanket-enable vision for other gh models or other providers", () => {
    expect(getCapabilitiesForModel("github", "not-a-real-model").vision).toBe(false);
    expect(getCapabilitiesForModel("codex", "auto").vision).toBe(false);
    expect(getCapabilitiesForModel("openrouter", "auto").vision).toBe(false);
  });

  it("still lists auto beside the models it can resolve to", () => {
    const listed = getModelsByProviderId("github");
    expect(listed.some((m) => m.id === "auto")).toBe(true);
    expect(listed.some((m) => m.id === "gpt-5.4")).toBe(true);
  });

  it("resolves the alias before asking in the route the picker reads", () => {
    // /api/models is what loadModelCaps() fetches, and its rows are keyed by alias,
    // so it must normalise before lookup — otherwise moving the entry to a registry
    // id silently breaks the picker again.
    const route = readFileSync(new URL("src/app/api/models/route.js", repoRoot), "utf8");
    const calls = [...route.matchAll(/getCapabilitiesForModel\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toContain("resolveProviderId(");
    }
  });
});
