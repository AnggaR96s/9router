"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, Badge } from "@/shared/components";
import { ADDON_SKILLS } from "@/shared/constants/addonSkills";

const ICONS = {
  "human-handwritten": "edit_note",
  "watermarks-remover": "cleaning_services",
  "commit-lint": "rule",
};

export default function AddonsClient() {
  const [skills, setSkills] = useState(
    ADDON_SKILLS.map((s) => ({ ...s, mode: "always", updatable: false }))
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // skill id being updated
  const [toast, setToast] = useState(null); // {id, msg, kind}

  const load = useCallback(async () => {
    try {
      const [settingsRes, skillsRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/addons/list"),
      ]);
      if (!settingsRes.ok) throw new Error(`Settings ${settingsRes.status}`);
      const settings = await settingsRes.json();
      const activeIds = Array.isArray(settings.activeSkills) ? settings.activeSkills : [];
      const modes = settings.skillRoutingModes && typeof settings.skillRoutingModes === "object" ? settings.skillRoutingModes : {};

      let updatableIds = [];
      if (skillsRes.ok) {
        try {
          const data = await skillsRes.json();
          updatableIds = (data.skills || [])
            .filter((s) => s.updatable)
            .map((s) => s.id);
        } catch {}
      }

      setSkills((prev) =>
        prev.map((s) => {
          const isActive = activeIds.includes(s.id);
          // Active skill without a saved mode keeps its manifest default ("always").
          const savedMode = modes[s.id];
          const mode = isActive ? (savedMode || "always") : "off";
          return { ...s, mode, updatable: updatableIds.includes(s.id) };
        })
      );
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setSkillMode = async (id, mode) => {
    const prevSkills = skills;
    const nextSkills = prevSkills.map((s) => (s.id === id ? { ...s, mode } : s));
    setSkills(nextSkills);
    const activeIds = nextSkills.filter((s) => s.mode !== "off").map((s) => s.id);
    const modes = Object.fromEntries(nextSkills.filter((s) => s.mode !== "off").map((s) => [s.id, s.mode]));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeSkills: activeIds, skillRoutingModes: modes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(e.message);
      setSkills(prevSkills);
    }
  };

  const activeCount = skills.filter((s) => s.mode !== "off").length;

  const updateSkill = async (id) => {
    setBusy(id);
    setToast(null);
    try {
      const res = await fetch("/api/addons/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const msg = {
        updated: "Updated (backup .bak saved)",
        "up-to-date": "Already up to date",
        "locally-modified": "Skipped — prompt was edited locally",
        "not-updatable": "This skill cannot be updated remotely",
        "update-in-progress": "An update is already running",
        "no-source": "No remote source configured",
      }[data.status] || data.status;
      setToast({ id, msg, kind: data.status === "updated" ? "ok" : "info" });
    } catch (e) {
      setToast({ id, msg: `Failed: ${e.message}`, kind: "err" });
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="size-12 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
              <span className="material-symbols-outlined text-[24px]">auto_fix_high</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-main">Add-on Skills</h1>
              <p className="text-sm text-text-muted mt-0.5">
                Inject behavior rules into the system prompt of every routed
                request — without touching the client&apos;s own prompt.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={activeCount > 0 ? "primary" : "default"}>
              {activeCount}/{skills.length} active
            </Badge>
          </div>
        </div>
      </div>

      {error && (
        <Card padding="sm" className="!border-red-500/30 !bg-red-500/5 !text-red-400 text-sm">
          {error} — toggle changes may not be saved.
        </Card>
      )}

      {/* Skill list */}
      <div className="space-y-2">
        {loading ? (
          <Card padding="md" className="text-center text-text-muted text-sm">
            Loading add-ons…
          </Card>
        ) : (
          skills.map((skill) => (
            <div
              key={skill.id}
              className={`relative flex items-center gap-3 p-4 pl-5 rounded-xl border transition-all ${
                skill.mode !== "off"
                  ? "border-primary/40 bg-primary/5"
                  : "border-border-subtle bg-surface hover:bg-surface-2"
              }`}
            >
              <span
                className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${
                  skill.mode !== "off" ? "bg-primary" : "bg-transparent"
                }`}
              />
              <div
                className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
                  skill.mode !== "off" ? "bg-primary text-white" : "bg-primary/10 text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {ICONS[skill.id] || "auto_fix_high"}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
                  {skill.mode !== "off" ? (
                    <Badge variant="primary" size="sm">{skill.mode === "smart" ? "SMART" : "ALWAYS"}</Badge>
                  ) : (
                    <Badge size="sm">OFF</Badge>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                  {skill.description}
                </p>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <code className="text-[10px] text-text-muted/80 font-mono">
                    x-skill: {skill.id}
                  </code>
                </div>
                {toast?.id === skill.id && (
                  <p
                    className={`text-[11px] mt-1.5 ${
                      toast.kind === "ok"
                        ? "text-green-400"
                        : toast.kind === "err"
                          ? "text-red-400"
                          : "text-text-muted"
                    }`}
                  >
                    {toast.msg}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                {skill.updatable && (
                  <button
                    onClick={() => updateSkill(skill.id)}
                    disabled={busy === skill.id}
                    className="px-2 py-1 rounded-md border border-border-subtle text-text-muted text-[11px] hover:border-primary/40 hover:text-primary transition-colors cursor-pointer inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Check and update the prompt from its source repo"
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {busy === skill.id ? "progress_activity" : "sync"}
                    </span>
                    {busy === skill.id ? "…" : "Update"}
                  </button>
                )}
                <div className="flex items-center gap-1 p-0.5 rounded-lg border border-border-subtle bg-surface-2">
                  {["off", "smart", "always"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSkillMode(skill.id, m)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                        skill.mode === m
                          ? "bg-primary text-white shadow-sm"
                          : "text-text-muted hover:text-text-main"
                      }`}
                      title={
                        m === "off"
                          ? "Never inject this skill"
                          : m === "smart"
                            ? "Inject only when a skill keyword appears in the conversation"
                            : "Inject on every request"
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] text-text-muted text-center">
        Built-in agent skills (copyable prompts for external AI) live under the{" "}
        <span className="text-primary font-medium">Skills</span> menu.
      </p>
    </div>
  );
}
