import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cline's upstream /api/v1/models feed lists every model the aggregator can route
// (~450 entries, mostly paid models a free Cline account cannot use). Showing that
// catalog in the model selector buries the handful of models a free connection can
// actually run. Cline therefore stays on the static registry catalog, which holds
// the free tier only; cursor and clinepass keep their account-scoped live catalogs.

const ROOT = process.cwd();
const MODAL = join(ROOT, "src/shared/components/ModelSelectModal.js");
const CLINE_REGISTRY = join(ROOT, "open-sse/providers/registry/cline.js");

const FREE_MODELS = [
  "cline-free/deepseek-v4.1-flash",
  "cline-free/muse-spark-1.3-contributor",
  "deepseek/deepseek-v4-flash",
  "z-ai/glm-5.3-flash",
  "cline-free/solar-pro4",
  "cline-free/longcat-2.0",
  "poolside/laguna-s-2.1:free",
];

function liveCatalogProviders() {
  const src = readFileSync(MODAL, "utf8");
  const m = src.match(/const LIVE_CATALOG_PROVIDERS\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error("LIVE_CATALOG_PROVIDERS not found");
  return (m[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ""));
}

function registryModelIds() {
  const src = readFileSync(CLINE_REGISTRY, "utf8");
  const m = src.match(/\n\s*models:\s*\[([\s\S]*?)\n\s*\],/);
  if (!m) throw new Error("cline models array not found");
  return (m[1].match(/id:\s*"([^"]+)"/g) || []).map((s) => s.replace(/id:\s*"/, "").replace(/"$/, ""));
}

describe("cline model selector uses the static free catalog", () => {
  it("keeps cline out of the live per-account catalog providers", () => {
    const providers = liveCatalogProviders();
    expect(providers).not.toContain("cline");
  });

  it("still uses the live catalog for the providers that need it", () => {
    const providers = liveCatalogProviders();
    expect(providers).toContain("cursor");
    expect(providers).toContain("clinepass");
  });

  it("lists exactly the free cline models and no paid ones", () => {
    const ids = registryModelIds();
    expect(ids.sort()).toEqual([...FREE_MODELS].sort());
    for (const paid of ["anthropic/", "openai/", "x-ai/", "moonshotai/"]) {
      expect(ids.some((id) => id.startsWith(paid))).toBe(false);
    }
  });
});
