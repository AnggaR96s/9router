import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// src/lib/localDb.js is a compatibility shim that re-exports the SQLite db layer.
// It drifted: nine names it still forwarded (getApiKeyByKey, the budget-group
// helpers, cloneApiKey, auditApiKeys) no longer exist in the barrel, and nothing
// in the repo imports them from here either. Webpack warns about each one on
// every build — "Compiled with warnings" was nothing but these nine — so the
// shim must forward exactly what the barrel exports, nothing more.
const repoRoot = new URL("../../", import.meta.url);
const shim = readFileSync(new URL("src/lib/localDb.js", repoRoot), "utf8");
const barrel = readFileSync(new URL("src/lib/db/index.js", repoRoot), "utf8");

// Names re-exported by a module, ignoring the module specifier of `export {…} from`.
function exportedNames(source) {
  const names = new Set();
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  for (const fn of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(fn[1]);
  }
  for (const cnst of source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(cnst[1]);
  }
  return names;
}

describe("localDb shim re-exports", () => {
  const barrelNames = exportedNames(barrel);
  const shimNames = exportedNames(shim);

  it("reads both modules", () => {
    expect(barrelNames.size).toBeGreaterThan(50);
    expect(shimNames.size).toBeGreaterThan(20);
  });

  it("forwards nothing the db barrel does not export", () => {
    const dead = [...shimNames].filter((n) => !barrelNames.has(n)).sort();
    expect(dead).toEqual([]);
  });

  it("drops only names nobody imports from the shim", () => {
    // The shim exists for backward-compatible imports, so a name leaving it must
    // not be a name something still asks it for. Scan every importer of the shim.
    const dead = [...shimNames].filter((n) => !barrelNames.has(n));
    const importers = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(full);
          continue;
        }
        if (!/\.(js|jsx|mjs)$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        if (!text.includes("lib/localDb")) continue;
        importers.push(text);
      }
    };
    walk(new URL("src/", repoRoot));

    const imported = dead.filter((n) =>
      importers.some((text) =>
        [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*lib\/localDb["']/g)]
          .some((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).includes(n))
      )
    );
    expect(imported).toEqual([]);
  });
});
