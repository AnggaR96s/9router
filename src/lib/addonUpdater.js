// Add-on skill updater — fetch the prompt from a whitelisted source repo,
// sha256-compare, back up before overwrite. No exec/spawn.
// Repo/branch/path are read from the LOCAL manifest, never from the request.
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { findSkillsDirForUpdate, invalidateSkillCache } from "./skillsRegistry.js";

const ALLOWED_REPOS = new Set([
  "miqdadbadjuber/anti-slop",
  "guillaumemeyer/watermarks-remover",
]);

const MAX_PROMPT_BYTES = 64 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const fetchCache = (global.__addonFetchCache ??= new Map());

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function fetchRawPrompt(repo, branch, filePath) {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
  const cached = fetchCache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const res = await fetch(url, {
    headers: { "User-Agent": "nggrouter-addon-updater" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("empty prompt");
  if (buf.length > MAX_PROMPT_BYTES) throw new Error(`prompt too large (${buf.length}B > ${MAX_PROMPT_BYTES}B)`);
  const text = buf.toString("utf8");
  if (/\uFFFD/.test(text.slice(0, 4096))) throw new Error("content is not UTF-8 text");

  // SKILL.md format: strip YAML frontmatter so only the prompt body remains
  let finalText = text;
  if (/SKILL\.md$/i.test(filePath)) {
    finalText = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim() || text;
  }
  const entry = { at: Date.now(), text: finalText, hash: sha256(finalText) };
  fetchCache.set(url, entry);
  return entry;
}

// Atomic write: tmp file + rename — a crash or concurrent reader never sees
// a torn file
async function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}

async function readPromptFile(skillDir, promptFile) {
  try {
    return await fs.readFile(path.join(skillDir, promptFile), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("prompt file missing");
    throw e;
  }
}

// Per-skill update lock: concurrent POST for the same skill (e.g. a double
// click during the up-to-15s fetch) must not interleave check-then-write
const updateLocks = new Set();

function validateSource(manifest) {
  const { source_repo, source_branch, source_path } = manifest;
  if (manifest.updatable !== true) return { status: "not-updatable" };
  if (!source_repo || !source_branch || !source_path) return { status: "no-source" };
  if (!ALLOWED_REPOS.has(source_repo)) {
    throw new Error(`repo '${source_repo}' is not whitelisted`);
  }
  if (!/^[a-z0-9-]+$/.test(source_branch) || source_branch.length > 50) {
    throw new Error("invalid branch name");
  }
  if (source_path.includes("..") || !/^[a-zA-Z0-9/._-]+$/.test(source_path)) {
    throw new Error("invalid source path");
  }
  return null; // validation passed
}

function validatePromptFile(promptFile) {
  // Basename only — blocks path traversal via manifest.prompt_file
  if (!/^[a-zA-Z0-9._-]+$/.test(promptFile)) {
    throw new Error("invalid prompt file name");
  }
}

async function loadManifest(skillDir, skillId) {
  try {
    return JSON.parse(await fs.readFile(path.join(skillDir, "manifest.json"), "utf8"));
  } catch {
    throw new Error(`skill '${skillId}' not found`);
  }
}

export async function checkAndUpdateSkill(skillId) {
  if (updateLocks.has(skillId)) {
    return { status: "update-in-progress", skillId };
  }
  updateLocks.add(skillId);
  try {
    return await doUpdateSkill(skillId);
  } finally {
    updateLocks.delete(skillId);
  }
}

async function doUpdateSkill(skillId) {
  const skillsDir = await findSkillsDirForUpdate();
  if (!skillsDir) throw new Error("skills directory not found");
  const skillDir = path.join(skillsDir, skillId);

  const manifest = await loadManifest(skillDir, skillId);

  // Security: source repo/branch/path ONLY from the local manifest, and the
  // repo must be whitelisted
  const early = validateSource(manifest);
  if (early) return { ...early, skillId };

  const promptFile = manifest.prompt_file || "prompt.txt";
  validatePromptFile(promptFile);

  const localPrompt = await readPromptFile(skillDir, promptFile);
  const localHash = sha256(localPrompt);

  // Local-edit protection: recorded hash != current file -> user modified it
  if (manifest.content_hash && manifest.content_hash !== localHash) {
    return { status: "locally-modified", skillId };
  }

  const remote = await fetchRawPrompt(manifest.source_repo, manifest.source_branch, manifest.source_path);
  if (remote.hash === localHash) {
    return { status: "up-to-date", skillId };
  }

  // Backup then write — atomic, so a torn manifest/prompt is impossible
  await writeFileAtomic(path.join(skillDir, `${promptFile}.bak`), localPrompt);
  await writeFileAtomic(path.join(skillDir, promptFile), remote.text);

  manifest.content_hash = remote.hash;
  manifest.updated_at = new Date().toISOString();
  await writeFileAtomic(path.join(skillDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Drop the cached fetch so the next status check reflects the new file
  fetchCache.delete(`https://raw.githubusercontent.com/${manifest.source_repo}/${manifest.source_branch}/${manifest.source_path}`);

  invalidateSkillCache();
  return { status: "updated", skillId, bytes: remote.text.length };
}

export async function checkSkillStatus(skillId) {
  const skillsDir = await findSkillsDirForUpdate();
  if (!skillsDir) throw new Error("skills directory not found");
  const skillDir = path.join(skillsDir, skillId);

  const manifest = await loadManifest(skillDir, skillId);

  // Security: identical validation to checkAndUpdateSkill — the GET status
  // path must not bypass the repo whitelist
  const early = validateSource(manifest);
  if (early) return { ...early, skillId };

  const promptFile = manifest.prompt_file || "prompt.txt";
  validatePromptFile(promptFile);

  const localPrompt = await readPromptFile(skillDir, promptFile);
  const localHash = sha256(localPrompt);
  if (manifest.content_hash && manifest.content_hash !== localHash) {
    return { status: "locally-modified", skillId };
  }

  const remote = await fetchRawPrompt(manifest.source_repo, manifest.source_branch, manifest.source_path);
  return {
    status: remote.hash === localHash ? "up-to-date" : "update-available",
    skillId,
  };
}

export function clearAddonFetchCache() {
  fetchCache.clear();
}
