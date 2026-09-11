import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Isolate HOME and cwd so the registry never sees the real ~/.9router/skills
describe("skillsRegistry", () => {
  let tmp, realHome;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ngg-reg-"));
    realHome = process.env.HOME;
    process.env.HOME = tmp;
    process.chdir(tmp);
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = realHome;
  });

  it("returns [] when no skills dir exists (fail-open)", async () => {
    const { getInstalledSkills } = await import("../../../src/lib/skillsRegistry.js");
    const skills = await getInstalledSkills();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBe(0);
  });

  it("loads a system-prompt skill from skills/", async () => {
    fs.mkdirSync(path.join(tmp, "skills", "demo"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "demo", "prompt.txt"), "Demo prompt body");
    fs.writeFileSync(
      path.join(tmp, "skills", "demo", "manifest.json"),
      JSON.stringify({
        id: "demo",
        name: "Demo",
        description: "A demo skill",
        hook: "system-prompt",
        default_enabled: true,
        updatable: true,
      })
    );

    const { getInstalledSkills } = await import("../../../src/lib/skillsRegistry.js");
    const skills = await getInstalledSkills();
    expect(skills.length).toBe(1);
    expect(skills[0].id).toBe("demo");
    expect(skills[0].prompt).toBe("Demo prompt body");
    expect(skills[0].updatable).toBe(true);
  });

  it("ignores non-system-prompt skills", async () => {
    fs.mkdirSync(path.join(tmp, "skills", "other"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "other", "manifest.json"), JSON.stringify({ id: "other", hook: "other-hook" }));

    const { getInstalledSkills } = await import("../../../src/lib/skillsRegistry.js");
    const skills = await getInstalledSkills();
    expect(skills.length).toBe(0);
  });

  it("skips a skill with a corrupt manifest (fail-open, no throw)", async () => {
    fs.mkdirSync(path.join(tmp, "skills", "broken"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "skills", "broken", "manifest.json"), "not json{");

    const { getInstalledSkills } = await import("../../../src/lib/skillsRegistry.js");
    const skills = await getInstalledSkills();
    expect(skills.length).toBe(0);
  });
});
