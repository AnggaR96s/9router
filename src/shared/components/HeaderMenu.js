"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTheme } from "@/shared/hooks/useTheme";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import { VISUAL_THEMES } from "@/shared/constants/config";
import ChangelogModal from "./ChangelogModal";
import LanguageSwitcher from "./LanguageSwitcher";
import { ConfirmModal } from "./Modal";

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      <span className={`material-symbols-outlined text-[20px] ${danger ? "" : "text-text-muted"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

// Locale lives in a cookie, not in React state, so read it at open time and let
// the switcher's onClose report the new value back — the same source of truth
// HeaderLanguage used before its trigger moved in here.
function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

// The four colours of a look, miniaturised. It doubles as the current-value
// readout on the row, so the active look is visible without opening the list.
function VisualSwatch({ swatch, size }) {
  return (
    <span
      aria-hidden="true"
      className={`grid grid-cols-2 ${size} shrink-0 rounded-md border border-border overflow-hidden`}
    >
      {swatch.slice(0, 4).map((color, i) => (
        <span key={i} style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

VisualSwatch.propTypes = {
  swatch: PropTypes.arrayOf(PropTypes.string).isRequired,
  size: PropTypes.string.isRequired,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [visualOpen, setVisualOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const { toggleTheme, isDark, visualTheme, setVisualTheme } = useTheme();
  const menuRef = useRef(null);
  // Locale comes from a cookie, so the initial state is read once with a lazy
  // initializer (runs on the client, where document exists) rather than set from
  // an effect — react-hooks/set-state-in-effect rejects the reactive write, and
  // an effect would also fire on mount for a value already known.
  const [locale, setLocale] = useState(getLocaleFromCookie);
  const activeVisual =
    VISUAL_THEMES.find((option) => option.id === visualTheme) || VISUAL_THEMES[0];

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          title="Menu"
        >
          <span className="material-symbols-outlined">grid_view</span>
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden py-1">
            <MenuItem
              icon="history"
              label="Change Log"
              onClick={() => { close(); setChangelogOpen(true); }}
            />
            <MenuItem
              icon={isDark ? "light_mode" : "dark_mode"}
              label="Theme"
              onClick={() => { toggleTheme(); close(); }}
            />
            <MenuItem
              icon="palette"
              label="Visual theme"
              trailing={<VisualSwatch swatch={activeVisual.swatch} size="size-4" />}
              onClick={() => setVisualOpen((v) => !v)}
            />
            {visualOpen && (
              <div role="group" aria-label="Visual theme" className="px-2 pt-1 pb-2">
                {VISUAL_THEMES.map((option) => {
                  const active = visualTheme === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setVisualTheme(option.id)}
                      className={`flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-left transition-colors ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                    >
                      <VisualSwatch swatch={option.swatch} size="size-5" />
                      <span className="flex-1 min-w-0 truncate">{option.label}</span>
                      {active && (
                        <span className="material-symbols-outlined text-[16px]">check</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <MenuItem
              icon="language"
              label="Language"
              trailing={LOCALE_FLAGS[locale] || "🌐"}
              onClick={() => { close(); setLanguageOpen(true); }}
            />
            <MenuItem
              icon="power_settings_new"
              label="Shutdown"
              danger
              onClick={() => { close(); setShutdownOpen(true); }}
            />
            <MenuItem
              icon="logout"
              label="Logout"
              danger
              onClick={() => { close(); onLogout(); }}
            />
          </div>
        )}
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <LanguageSwitcher
        hideTrigger
        isOpen={languageOpen}
        onClose={(next) => {
          setLanguageOpen(false);
          setLocale(next);
        }}
      />
      <ConfirmModal
        isOpen={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />
    </>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
