// injectSkill.js — inject active add-on skill prompts into the system prompt
// of routed chat requests. Independent of token-saver toggles.
import { getInstalledSkills } from "@/lib/skillsRegistry.js";

export function resolveActiveSkillIds(dbActiveSkills, headerValue) {
  // Header overrides the dashboard setting per-request:
  // - "off": disable all skills
  // - "on":  fall back to dashboard activeSkills
  // - "<csv>": explicit list of skill ids (case-insensitive)
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
  const block = `\n\n<add_on_skill id="${escapeXmlAttr(skillId)}">\n${prompt}\n</add_on_skill>\n\n`;

  if (format === "claude" && Array.isArray(body.system)) {
    body.system.push({ role: "system", content: block });
  } else if (format === "claude" && typeof body.system === "string") {
    body.system = body.system + block;
  } else if (Array.isArray(body.messages)) {
    const idx = body.messages.findIndex((m) => m.role === "system");
    if (idx >= 0) {
      const cur = body.messages[idx];
      const appended = typeof cur.content === "string"
        ? cur.content + block
        : [...(Array.isArray(cur.content) ? cur.content : []), { type: "text", text: block }];
      body.messages[idx] = { ...cur, content: appended };
    } else {
      body.messages.unshift({ role: "system", content: block });
    }
  }
}

export async function injectActiveSkills(body, format, activeSkillIds) {
  if (!activeSkillIds || !Array.isArray(activeSkillIds) || activeSkillIds.length === 0) {
    return [];
  }

  const allSkills = await getInstalledSkills();
  const lookup = new Map();
  for (const s of allSkills) {
    if (s.prompt) lookup.set(s.id.toLowerCase(), s);
  }

  const injected = [];
  for (const rawId of activeSkillIds) {
    const id = String(rawId).trim().toLowerCase();
    const skill = lookup.get(id);
    if (!skill) continue;
    injectSkillBlock(body, format, skill.id, skill.prompt);
    injected.push(skill.id.toLowerCase());
  }
  return injected;
}
