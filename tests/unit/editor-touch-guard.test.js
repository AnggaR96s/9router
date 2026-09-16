import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { attachEditorTouchGuard } from "@/lib/editorTouchGuard";

const PAGE = path.join(process.cwd(), "src/app/(dashboard)/dashboard/translator/page.js");

const fakeWrapper = () => {
  const listeners = {};
  return {
    listeners,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
  };
};

describe("editor touch guard", () => {
  it("hands every gesture back to the page instead of letting Monaco eat it", () => {
    const w = fakeWrapper();
    const stop = vi.fn();
    attachEditorTouchGuard(w);
    w.listeners.touchstart[0]({ stopPropagation: stop });
    w.listeners.touchmove[0]({ stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("detaches on cleanup", () => {
    const w = fakeWrapper();
    const detach = attachEditorTouchGuard(w);
    detach();
    expect(w.listeners.touchstart.length).toBe(0);
    expect(w.listeners.touchmove.length).toBe(0);
  });

  it("survives a missing wrapper", () => {
    expect(() => attachEditorTouchGuard(null)()).not.toThrow();
  });


  it("lets wheel/touchpad scrolling reach the page while the pointer is over the editor", () => {
    // Monaco defaults alwaysConsumeMouseWheel to true, which swallows the wheel
    // even when the editor has nothing to scroll: over an editor the page then
    // does not move at all (reproduced on the deployed build).
    const src = fs.readFileSync(PAGE, "utf8");
    const options = src.slice(src.indexOf("const EDITOR_OPTIONS"));
    expect(options).toContain("alwaysConsumeMouseWheel: false");
  });

  it("wraps every step editor", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    expect(src).toContain("<EditorTouchArea>");
    expect(src).toContain("attachEditorTouchGuard(ref.current)");
    expect(src).not.toContain("editorsRef");
  });
});
