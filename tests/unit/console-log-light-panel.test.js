import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The console log panel used to be a hardcoded opaque `bg-black` box with -400
// log colours. On a light theme that left the empty-state text dark-on-black and
// every log line at 1.6-3.1:1. These assertions keep the panel theme-aware so it
// cannot quietly regress to a black box in light mode.

const FILE = path.join(
  process.cwd(),
  "src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js"
);
const SRC = fs.readFileSync(FILE, "utf8");

// Pull a class attribute out of the source without regex gymnastics.
function classAttrContaining(needle) {
  let from = 0;
  for (;;) {
    const at = SRC.indexOf(needle, from);
    if (at === -1) return null;
    const open = SRC.lastIndexOf('className="', at);
    if (open !== -1) {
      const start = open + 'className="'.length;
      const end = SRC.indexOf('"', start);
      if (end > at) return SRC.slice(start, end);
    }
    from = at + needle.length;
  }
}

describe("console log panel follows the active theme", () => {
  it("has no opaque bg-black left in the component", () => {
    const offenders = [];
    let from = 0;
    for (;;) {
      const at = SRC.indexOf("bg-black", from);
      if (at === -1) break;
      const before = SRC.slice(Math.max(0, at - 5), at);
      const after = SRC[at + "bg-black".length] || "";
      const isOpacity = after === "/";
      const isDarkPrefixed = before.endsWith("dark:");
      if (!isOpacity && !isDarkPrefixed) offenders.push(SRC.slice(at - 20, at + 20));
      from = at + "bg-black".length;
    }
    expect(offenders).toEqual([]);
  });

  it("gives the log panel a light surface and a dark override", () => {
    const cls = classAttrContaining("h-[calc(100vh-220px)]");
    expect(cls, "log panel class not found").toBeTruthy();
    expect(cls).toContain("bg-surface-2");
    expect(cls).toContain("dark:bg-black");
  });

  it("keeps a light and a dark shade for every log level", () => {
    const start = SRC.indexOf("const LOG_LEVEL_COLORS = {");
    expect(start, "LOG_LEVEL_COLORS not found").toBeGreaterThan(-1);
    const end = SRC.indexOf("};", start);
    const rows = SRC.slice(start, end).split("\n").map((l) => l.trim()).filter((l) => l.includes(":"));
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row, "no light shade in " + row).toMatch(/-[6-8]00/);
      expect(row, "no dark shade in " + row).toContain("dark:text-");
    }
  });
  it("does not fall back to a dark-only shade for unlabelled lines", () => {
    const marker = "LOG_LEVEL_COLORS[levelTag] || ";
    const at = SRC.indexOf(marker);
    expect(at, "fallback colour not found").toBeGreaterThan(-1);
    const tail = SRC.slice(at + marker.length, at + marker.length + 80);
    let value;
    if (tail.startsWith(String.fromCharCode(34))) {
      value = tail.slice(1, tail.indexOf(String.fromCharCode(34), 1));
    } else {
      const name = tail.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)[0];
      const defAt = SRC.indexOf("const " + name + " = ");
      expect(defAt, name + " is not defined").toBeGreaterThan(-1);
      value = SRC.slice(defAt, SRC.indexOf(";", defAt));
    }
    expect(value, "fallback has no light shade").toMatch(/-[6-8]00/);
    expect(value, "fallback has no dark shade").toContain("dark:text-");
  });
});
