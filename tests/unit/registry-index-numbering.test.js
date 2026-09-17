import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = readFileSync(
  resolve(REPO, "open-sse/providers/registry/index.js"),
  "utf8",
);

const imports = [...SOURCE.matchAll(/^import p(\d+) from "\.\/([\w-]+)\.js";$/gm)].map(
  (m) => ({ n: Number(m[1]), file: m[2] }),
);
const entries = [...SOURCE.matchAll(/^  p(\d+),$/gm)].map((m) => Number(m[1]));

describe("registry index numbering", () => {
  it("numbers entries 0..n-1 with no gaps", () => {
    const numbers = imports.map((i) => i.n).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i));
  });

  it("lists every imported entry exactly once, in numeric order", () => {
    expect(entries).toEqual([...imports].map((i) => i.n).sort((a, b) => a - b));
  });

  it("points each import at a distinct registry file", () => {
    const files = imports.map((i) => i.file);
    expect(new Set(files).size).toBe(files.length);
  });
});