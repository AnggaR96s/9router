import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The visual theme (the look: radius, borders, shadows, palette) used to be
// reachable only from the profile page, so switching it meant leaving whatever
// you were doing. It now lives in the header menu next to the dark/light row.
// These assertions keep it wired: the row must read the active look, the list
// must write through the store, and picking an option must NOT dismiss the menu
// (otherwise comparing the two looks becomes open-pick-reopen every time).

const FILE = path.join(
  process.cwd(),
  "src/shared/components/HeaderMenu.js"
);
const SRC = fs.readFileSync(FILE, "utf8");

describe("header menu exposes the visual theme", () => {
  it("keeps every pre-existing menu entry", () => {
    for (const label of [
      "Change Log",
      'label="Theme"',
      'label="Language"',
      'label="Shutdown"',
      'label="Logout"',
    ]) {
      expect(SRC).toContain(label);
    }
  });

  it("reads the active look from the theme store", () => {
    expect(SRC).toMatch(/const\s*\{[^}]*visualTheme[^}]*setVisualTheme[^}]*\}\s*=\s*useTheme\(\)/);
    expect(SRC).toContain("VISUAL_THEMES.find(");
  });

  it("adds the row with an icon that renders as a glyph", () => {
    expect(SRC).toContain('icon="palette"');
    expect(SRC).toContain('label="Visual theme"');
  });

  it("expands the look list from the row instead of navigating away", () => {
    expect(SRC).toContain("setVisualOpen((v) => !v)");
    expect(SRC).toContain("VISUAL_THEMES.map(");
    expect(SRC).toContain("onClick={() => setVisualTheme(option.id)}");
    // picking a look keeps the menu open so the other look is one click away
    expect(SRC).not.toContain("setVisualTheme(option.id); close()");
  });

  it("marks the active look and shows its swatch on the row", () => {
    expect(SRC).toContain("aria-pressed={active}");
    expect(SRC).toContain("trailing={<VisualSwatch swatch={activeVisual.swatch}");
    expect(SRC.match(/<VisualSwatch/g) || []).toHaveLength(2);
  });
});
