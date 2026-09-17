// Renumber open-sse/providers/registry/index.js so the import aliases are 0..n-1
// with no gaps, preserving the array order (which defines PROVIDERS key order).
//
// Registry numbering drifts whenever an entry is removed: the old alias is simply
// deleted, leaving a hole (p57, p61, ...). Run this after removing entries.
//
//   node scripts/renumber-registry-index.mjs [--check]
//
// --check exits 1 without writing when the numbering is already clean.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "../open-sse/providers/registry/index.js");
const IMPORT_RE = /^import p(\d+) from "\.\/([\w-]+)\.js";$/gm;
const ENTRY_RE = /^  p(\d+),$/gm;

const source = readFileSync(INDEX, "utf8");

const imports = [...source.matchAll(IMPORT_RE)].map((m) => ({
  line: m[0],
  n: Number(m[1]),
  file: m[2],
}));
const entries = [...source.matchAll(ENTRY_RE)].map((m) => Number(m[1]));

if (imports.length !== entries.length) {
  console.error(`❌ ${imports.length} imports vs ${entries.length} array entries`);
  process.exit(1);
}

const importNumbers = new Set(imports.map((i) => i.n));
const unlisted = entries.filter((n) => !importNumbers.has(n));
if (unlisted.length) {
  console.error(`❌ array entries without an import: ${unlisted.join(", ")}`);
  process.exit(1);
}

// The array order IS the PROVIDERS key order, so the script only renames aliases; it
// must never be the thing that decides order. Refuse a scrambled array instead of
// baking the scramble in.
const scrambled = entries.findIndex((n, i) => i > 0 && n < entries[i - 1]);
if (scrambled !== -1) {
  console.error(
    `❌ array order is not ascending at index ${scrambled} (p${entries[scrambled - 1]} then p${entries[scrambled]})`,
  );
  console.error("   fix the array order first: it defines the order of PROVIDERS keys.");
  process.exit(1);
}

// New number = position in the array, so array order is untouched.
const remap = new Map(entries.map((oldN, i) => [oldN, i]));
const used = new Set(imports.map((i) => i.n));
// missing = numbers absent from 0..max; moved = aliases that keep a value but need renaming.
const missing = Array.from({ length: Math.max(...used) + 1 }, (_, i) => i).filter((i) => !used.has(i));
const moved = imports.filter((i) => remap.get(i.n) !== i.n).length;
const holes = missing;

if (!holes.length) {
  console.log(`✅ registry index numbering is clean (${imports.length} entries, 0..${imports.length - 1}).`);
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error(`❌ registry index is not contiguous: ${holes.length} missing (${holes.join(", ")}), ${moved} alias(es) to rename`);
  console.error("   run: node scripts/renumber-registry-index.mjs");
  process.exit(1);
}

let out = source;
// Rename array entries and import aliases; both use the same alias token, so the
// replacements are done per line to avoid rewriting an unrelated p<digits> string.
out = out.replace(ENTRY_RE, (_, n) => `  p${remap.get(Number(n))},`);
out = out.replace(IMPORT_RE, (_, n, file) => `import p${remap.get(Number(n))} from "./${file}.js";`);

writeFileSync(INDEX, out);
console.log(
  `✅ renumbered ${imports.length} entries (0..${imports.length - 1}); filled ${missing.length} missing number(s)` +
    `${missing.length ? ` (${missing.join(", ")})` : ""}, renamed ${moved} alias(es)`,
);