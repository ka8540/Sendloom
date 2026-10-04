"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import React, { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { DASHBOARD_THEMES, themeForKey, themeIndex } from "@/components/dashboard-theme-switch-state";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import styles from "./dashboard-theme-switch.module.css";

const icons = { light: Sun, system: Monitor, dark: Moon };

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
  } else {
    root.dataset.theme = preference;
    root.style.colorScheme = preference;
  }
}

export function DashboardThemeSwitch({ collapsed }: { collapsed: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const optionsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const orientation = collapsed ? "vertical" : "horizontal";

  useEffect(() => {
    const saved = readPreference();
    setTheme(saved);
    applyPreference(saved);
    setMounted(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== THEME_STORAGE_KEY) return;
      const next = readPreference();
      setTheme(next);
      applyPreference(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const select = (next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Keep the control usable when storage is unavailable.
    }
    applyPreference(next);
    setTheme(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = themeForKey(event.key, theme, collapsed);
    if (next === null) return;
    event.preventDefault();
    select(next);
    optionsRef.current[themeIndex(next)]?.focus();
  };

  return (
    <div className={styles.slot} data-orientation={orientation}>
      {mounted ? (
        <div
          className={styles.track}
          role="radiogroup"
          aria-label="Dashboard color theme"
          aria-orientation={orientation}
          data-orientation={orientation}
          data-theme-preference={theme}
          style={{ "--selection-index": themeIndex(theme) } as CSSProperties}
        >
          {DASHBOARD_THEMES.map((option, index) => {
            const Icon = icons[option];
            return (
              <button
                key={option}
                ref={(element) => { optionsRef.current[index] = element; }}
                className={styles.option}
                type="button"
                role="radio"
                aria-checked={theme === option}
                aria-label={`Use ${option} theme`}
                title={`Use ${option} theme`}
                tabIndex={theme === option ? 0 : -1}
                data-selected={theme === option}
                onClick={() => select(option)}
                onKeyDown={onKeyDown}
              >
                <Icon aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            );
          })}
          <span className={styles.thumb} aria-hidden="true" />
        </div>
      ) : (
        <div className={styles.track} data-orientation={orientation} aria-hidden="true" />
      )}
    </div>
  );
}
