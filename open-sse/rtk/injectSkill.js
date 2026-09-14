// injectSkill.js — inject active add-on skill prompts into the system prompt
// of routed chat requests. Independent of token-saver toggles.
import crypto from "crypto";
import { getInstalledSkills } from "@/lib/skillsRegistry.js";
import { injectSystemPrompt } from "./systemInject.js";

// Read one header value that may arrive either as a string (from
// Object.fromEntries(request.headers.entries())) or as an array (Node's raw
// IncomingMessage / undici Headers.getSetCookie style callers).
// Indexing a STRING would return its first character — "on" -> "o" — which is
// how the x-skill header silently became a no-op. Never index blind.
export function readHeaderValue(headers, name) {
  const raw = headers?.[name] ?? headers?.[name?.toLowerCase?.()];
  if (raw == null) return undefined;
  return Array.isArray(raw) ? raw[0] : String(raw);
}

// Header overrides the dashboard setting per-request:
// - "off": disable all skills
// - "on":  fall back to dashboard activeSkills
// - "<csv>": explicit list of skill ids (case-insensitive)
export function resolveActiveSkillIds(dbActiveSkills, headerValue) {
  if (!headerValue) {
    return Array.isArray(dbActiveSkills) ? dbActiveSkills : [];
  }
  const v = String(headerValue).trim().toLowerCase();
  if (v === "off") return [];
  if (v === "on") return Array.isArray(dbActiveSkills) ? dbActiveSkills : [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function escapeXmlAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[c]);
}

export function injectSkillBlock(body, format, skillId, prompt) {
  if (!prompt) return;
  const block = `<add_on_skill id="${escapeXmlAttr(skillId)}">\n${prompt}\n</add_on_skill>`;
  // Delegate to the shared injector: supports claude/gemini/antigravity/kiro/
  // openai-chat/responses shapes and is idempotent per skill.
  injectSystemPrompt(body, format, block);
}

// Extract the text of one message across provider shapes:
// openai/claude: content string or [{text}], gemini/antigravity: parts [{text}]
function msgText(m) {
  const c = m?.content ?? m?.parts;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p?.text || p?.input_text?.text || "").join(" ");
  return "";
}

// Lowercased concatenation of the last few user messages, used for smart routing.
function userText(body) {
  // Kiro has no messages array by the time we see it: chatCore injects AFTER
  // translation, so the body is already in Kiro's conversationState shape with the
  // user turns under history[].userInputMessage / currentMessage.userInputMessage.
  // Without this branch the generic path below finds nothing for Kiro, so smart
  // routing silently never matched and the skill was never injected.
  const kiroState = body?.conversationState;
  if (kiroState && typeof kiroState === "object") {
    const kiroMsgs = [
      ...(Array.isArray(kiroState.history) ? kiroState.history : []),
      kiroState.currentMessage,
    ]
      .filter((item) => item?.userInputMessage)
      .map((item) => item.userInputMessage)
      .slice(-3);
    return kiroMsgs.map(msgText).join(" ").toLowerCase();
  }

  const msgs =
    Array.isArray(body?.messages) ? body.messages :
    Array.isArray(body?.contents) ? body.contents :
    Array.isArray(body?.request?.contents) ? body.request.contents :
    Array.isArray(body?.input) ? body.input :
    [];
  const userMsgs = msgs.filter((m) => m?.role === "user" || m?.author === "user").slice(-3);
  return userMsgs.map(msgText).join(" ").toLowerCase();
}

// Smart mode: inject only when a skill keyword appears in recent user text.
// Word-boundary match so short keywords ("copy") do not fire inside longer
// words ("copyright"). Keywords come from remote manifests, so escape them
// before building the regex.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function smartMatches(text, keywords) {
  if (!text) return false;
  return keywords.some((k) => {
    const kw = String(k).trim().toLowerCase();
    if (!kw) return false;
    try {
      return new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(text);
    } catch {
      return false;
    }
  });
}

// Resolve which installed skills a request would inject: skips unknown ids,
// per-skill mode "off", and "smart" skills whose keywords are absent from the
// recent user turns. Shared by the injector and by buildSkillVariant so the
// cache key and the actual injection can never disagree about the selection.
async function resolveSkillsToInject(body, activeSkillIds, routingModes) {
  if (!activeSkillIds || !Array.isArray(activeSkillIds) || activeSkillIds.length === 0) {
    return [];
  }

  const allSkills = await getInstalledSkills();
  const lookup = new Map();
  for (const s of allSkills) {
    if (s.prompt) lookup.set(s.id.toLowerCase(), s);
  }

  const modes = routingModes && typeof routingModes === "object" ? routingModes : {};
  const text = userText(body);

  const resolved = [];
  for (const rawId of activeSkillIds) {
    const id = String(rawId).trim().toLowerCase();
    const skill = lookup.get(id);
    if (!skill) continue;
    // Per-skill routing mode: manifest default overridden by dashboard setting.
    const mode = modes[id] ?? skill.routingMode ?? "always";
    if (mode === "off") continue;
    if (mode === "smart" && !smartMatches(text, skill.keywords || [])) continue;
    resolved.push(skill);
  }
  return resolved;
}

// Fingerprint of the skill configuration that may affect this request. Skill
// settings live outside the request body (x-skill header, dashboard settings),
// so they are invisible to a body-only cache key: without this, a request that
// asks for a skill is served the answer cached without it, and the reverse.
// Include smart-mode candidates conservatively: cache lookup runs before the
// translated provider body exists, so over-separating is safer than serving an
// answer generated under a different prompt. Prompt content is included because
// updating a skill changes the outbound body without changing the client's.
export async function buildSkillVariant(_body, activeSkillIds, routingModes) {
  if (!Array.isArray(activeSkillIds) || activeSkillIds.length === 0) return "";

  const modes = routingModes && typeof routingModes === "object" ? routingModes : {};
  const allSkills = await getInstalledSkills();
  const lookup = new Map(allSkills.filter((s) => s.prompt).map((s) => [s.id.toLowerCase(), s]));
  const fingerprints = new Map();

  for (const rawId of activeSkillIds) {
    const id = String(rawId).trim().toLowerCase();
    const skill = lookup.get(id);
    if (!skill) continue;
    const mode = modes[id] ?? skill.routingMode ?? "always";
    if (mode === "off") continue;
    const digest = crypto.createHash("sha256").update(String(skill.prompt)).digest("hex").slice(0, 16);
    fingerprints.set(id, `${id}:${mode}:${digest}`);
  }

  return [...fingerprints.values()].sort().join(",");
}

export async function injectActiveSkills(body, format, activeSkillIds, routingModes) {
  const skills = await resolveSkillsToInject(body, activeSkillIds, routingModes);
  for (const skill of skills) {
    injectSkillBlock(body, format, skill.id, skill.prompt);
  }
  return skills.map((s) => s.id.toLowerCase());
}
