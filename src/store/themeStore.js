"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG, VISUAL_THEMES } from "@/shared/constants/config";

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,
      visualTheme: THEME_CONFIG.defaultVisualTheme,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme, get().visualTheme);
      },

      toggleTheme: () => {
        const currentTheme = get().theme;
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        set({ theme: newTheme });
        applyTheme(newTheme, get().visualTheme);
      },

      setVisualTheme: (visualTheme) => {
        if (!VISUAL_THEMES.some((t) => t.id === visualTheme)) return;
        set({ visualTheme });
        applyTheme(get().theme, visualTheme);
      },

      initTheme: () => {
        applyTheme(get().theme, get().visualTheme);
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
      // Older persisted snapshots only carry `theme`; merge so a missing
      // visualTheme falls back to the config default instead of undefined.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted || {}),
        visualTheme: persisted?.visualTheme || THEME_CONFIG.defaultVisualTheme,
      }),
    }
  )
);

// Apply theme to document. Two independent axes:
//   - `theme`      → the dark/light variant, carried by the `dark` class.
//   - `visualTheme` → the full visual language (radius, borders, shadows,
//                    palette), carried by data-visual on <html>.
// A visual theme that is neither "default" nor a known id is ignored, so a
// stale localStorage value can never leave the dashboard unstyled.
function applyTheme(theme, visualTheme) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

  const effectiveTheme = theme === "system" ? systemTheme : theme;

  if (effectiveTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  const known = VISUAL_THEMES.some((t) => t.id === visualTheme);
  if (known && visualTheme !== THEME_CONFIG.defaultVisualTheme) {
    root.setAttribute("data-visual", visualTheme);
  } else {
    root.removeAttribute("data-visual");
  }
}

export default useThemeStore;