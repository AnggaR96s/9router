import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const sha256 = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

function writeSkill(dir, id, opts = {}) {
  const sdir = path.join(dir, "skills", id);
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, "prompt.txt"), opts.prompt ?? "PROMPT-V1");
  fs.writeFileSync(
    path.join(sdir, "manifest.json"),
    JSON.stringify({
      id,
      name: id,
      hook: "system-prompt",
      updatable: true,
      source_repo: "miqdadbadjuber/anti-slop",
      source_branch: "main",
      source_path: `skills/${id}/SKILL.md`,
      content_hash: sha256(opts.prompt ?? "PROMPT-V1"),
      ...opts.manifest,
    })
  );
  return sdir;
}

async function loadUpdater(fetchImpl) {
  vi.resetModules();
  const origFetch = global.fetch;
  if (fetchImpl) global.fetch = fetchImpl;
  const mod = await import("../../../src/lib/addonUpdater.js");
  mod.clearAddonFetchCache();
  return { mod, restore: () => (global.fetch = origFetch) };
}

describe("addonUpdater", () => {
  let tmp, realHome;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ngg-upd-"));
    realHome = process.env.HOME;
    process.env.HOME = tmp;
    process.chdir(tmp);
  });

  afterEach(() => {
    process.env.HOME = realHome;
  });

  it("POST-update: rewrites prompt, backs up .bak, records new hash", async () => {
    const sdir = writeSkill(tmp, "demo");
    const localPrompt = fs.readFileSync(path.join(sdir, "prompt.txt"), "utf8");

    const { mod, restore } = await loadUpdater(async () =>
      new Response("PROMPT-V2", { status: 200 })
    );
    try {
      const r = await mod.checkAndUpdateSkill("demo");
      expect(r.status).toBe("updated");
      expect(fs.readFileSync(path.join(sdir, "prompt.txt"), "utf8")).toBe("PROMPT-V2");
      expect(fs.readFileSync(path.join(sdir, "prompt.txt.bak"), "utf8")).toBe(localPrompt);
      const m = JSON.parse(fs.readFileSync(path.join(sdir, "manifest.json"), "utf8"));
      expect(m.content_hash).toBe(sha256("PROMPT-V2"));
    } finally {
      restore();
    }
  });

  it("up-to-date: same content -> no write", async () => {
    const sdir = writeSkill(tmp, "demo");
    const before = fs.statSync(path.join(sdir, "prompt.txt")).mtimeMs;
    const { mod, restore } = await loadUpdater(async () =>
      new Response("PROMPT-V1", { status: 200 })
    );
    try {
      const r = await mod.checkAndUpdateSkill("demo");
      expect(r.status).toBe("up-to-date");
      expect(fs.statSync(path.join(sdir, "prompt.txt")).mtimeMs).toBe(before);
    } finally {
      restore();
    }
  });

  it("locally-modified: recorded hash mismatch -> skip, never overwrite user edit", async () => {
    const sdir = writeSkill(tmp, "demo");
    fs.writeFileSync(path.join(sdir, "prompt.txt"), "USER-EDITED");
    const { mod, restore } = await loadUpdater(async () =>
      new Response("PROMPT-V2", { status: 200 })
    );
    try {
      const r = await mod.checkAndUpdateSkill("demo");
      expect(r.status).toBe("locally-modified");
      expect(fs.readFileSync(path.join(sdir, "prompt.txt"), "utf8")).toBe("USER-EDITED");
    } finally {
      restore();
    }
  });

  it("rejects non-whitelisted repo in manifest", async () => {
    writeSkill(tmp, "evil", {
      manifest: { source_repo: "attacker/evil-repo" },
    });
    const { mod, restore } = await loadUpdater(null);
    try {
      await expect(mod.checkAndUpdateSkill("evil")).rejects.toThrow(/not whitelisted/);
      await expect(mod.checkSkillStatus("evil")).rejects.toThrow(/not whitelisted/);
    } finally {
      restore();
    }
  });

  it("rejects prompt_file with path components (traversal guard)", async () => {
    writeSkill(tmp, "trav", {
      manifest: { prompt_file: "../../etc/passwd" },
    });
    const { mod, restore } = await loadUpdater(null);
    try {
      await expect(mod.checkAndUpdateSkill("trav")).rejects.toThrow(/invalid prompt file/);
    } finally {
      restore();
    }
  });

  it("strips SKILL.md YAML frontmatter on fetch", async () => {
    const sdir = writeSkill(tmp, "mdskill", {
      prompt: "BODY-CONTENT",
      manifest: { source_path: "skills/x/SKILL.md" },
    });
    const remote = "---\nname: x\ndescription: \"y\"\n---\nBODY-CONTENT";
    const { mod, restore } = await loadUpdater(async () =>
      new Response(remote, { status: 200 })
    );
    try {
      const r = await mod.checkAndUpdateSkill("mdskill");
      expect(r.status).toBe("up-to-date");
      const m = JSON.parse(fs.readFileSync(path.join(sdir, "manifest.json"), "utf8"));
      expect(m.content_hash).toBe(sha256("BODY-CONTENT"));
    } finally {
      restore();
    }
  });

  it("rejects prompt > 64KB", async () => {
    writeSkill(tmp, "big");
    const big = "A".repeat(65 * 1024);
    const { mod, restore } = await loadUpdater(async () =>
      new Response(big, { status: 200 })
    );
    try {
      await expect(mod.checkAndUpdateSkill("big")).rejects.toThrow(/too large/);
    } finally {
      restore();
    }
  });

  it("skips non-updatable skill (updatable !== true)", async () => {
    writeSkill(tmp, "locked", { manifest: { updatable: false } });
    const { mod, restore } = await loadUpdater(null);
    try {
      const r = await mod.checkAndUpdateSkill("locked");
      expect(r.status).toBe("not-updatable");
    } finally {
      restore();
    }
  });
});
