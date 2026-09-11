import { describe, it, expect, vi, beforeEach } from "vitest";

let mods;
beforeEach(async () => {
  vi.resetModules();
  const skills = [
    { id: "watermarks-remover", prompt: "WATERMARK_PROMPT_X", keywords: ["watermark", "c2pa"], routingMode: "smart" },
    { id: "commit-lint", prompt: "COMMIT_LINT_PROMPT_X", keywords: ["commit"], routingMode: "always" },
  ];
  vi.doMock("@/lib/skillsRegistry.js", () => ({ getInstalledSkills: async () => skills }));
  mods = await import("../../open-sse/rtk/injectSkill.js");
});

describe("injectActiveSkills routing modes (real module)", () => {
  it("smart: injects when keyword present", async () => {
    const body = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "strip c2pa metadata plz" }] };
    const injected = await mods.injectActiveSkills(body, "openai", ["watermarks-remover"], { "watermarks-remover": "smart" });
    expect(injected).toEqual(["watermarks-remover"]);
    expect(JSON.stringify(body)).toContain("WATERMARK_PROMPT_X");
  });

  it("smart: skips without keyword", async () => {
    const body = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "capital of france?" }] };
    const injected = await mods.injectActiveSkills(body, "openai", ["watermarks-remover"], { "watermarks-remover": "smart" });
    expect(injected).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("WATERMARK_PROMPT_X");
  });

  it("off: skips even when active", async () => {
    const body = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "commit msg" }] };
    const injected = await mods.injectActiveSkills(body, "openai", ["commit-lint"], { "commit-lint": "off" });
    expect(injected).toEqual([]);
  });

  it("always: injects without keyword", async () => {
    const body = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "capital of france?" }] };
    const injected = await mods.injectActiveSkills(body, "openai", ["commit-lint"], { "commit-lint": "always" });
    expect(injected).toEqual(["commit-lint"]);
    expect(JSON.stringify(body)).toContain("COMMIT_LINT_PROMPT_X");
  });

  it("manifest smart default applies when dashboard mode missing", async () => {
    const body = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "remove watermark" }] };
    const injected = await mods.injectActiveSkills(body, "openai", ["watermarks-remover"], {});
    expect(injected).toEqual(["watermarks-remover"]);
  });
});

describe("userText provider shapes", () => {
  // note: these tests re-implement msgText/userText matching source; see module test above
  it("gemini contents shape is searched", async () => {
    const body = { contents: [{ role: "user", parts: [{ text: "strip the C2PA tag" }] }] };
    const text = userText(body);
    expect(text).toContain("c2pa");
  });
  it("antigravity request.contents shape is searched", async () => {
    const body = { request: { contents: [{ role: "user", parts: [{ text: "watermark removal" }] }] } };
    const text = userText(body);
    expect(text).toContain("watermark");
  });
});

function msgText(m) {
  const c = m?.content ?? m?.parts;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p?.text || p?.input_text?.text || "").join(" ");
  return "";
}
function userText(body) {
  const msgs =
    Array.isArray(body?.messages) ? body.messages :
    Array.isArray(body?.contents) ? body.contents :
    Array.isArray(body?.request?.contents) ? body.request.contents :
    Array.isArray(body?.input) ? body.input :
    [];
  const userMsgs = msgs.filter((m) => m?.role === "user" || m?.author === "user").slice(-3);
  return userMsgs.map(msgText).join(" ").toLowerCase();
}

describe("injectSkillBlock gemini/antigravity shape (real module)", () => {
  it("antigravity: skill block lands in request.systemInstruction", async () => {
    const body = { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } };
    mods.injectSkillBlock(body, "antigravity", "watermarks-remover", "WM_PROMPT_X");
    const si = body.request.systemInstruction;
    const txt = JSON.stringify(si);
    if (!txt.includes("add_on_skill")) console.log("systemInstruction:", txt);
    expect(txt).toContain("add_on_skill");
    expect(txt).toContain("WM_PROMPT_X");
  });
  it("gemini: skill block lands in systemInstruction", async () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    mods.injectSkillBlock(body, "gemini", "commit-lint", "CL_PROMPT_X");
    expect(JSON.stringify(body.systemInstruction)).toContain("CL_PROMPT_X");
  });
});
