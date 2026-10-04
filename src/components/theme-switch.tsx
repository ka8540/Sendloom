"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import styles from "./theme-switch.module.css";

function readThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "system" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyThemePreference(theme: ThemePreference) {
  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
  } else {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }
}

export function switchChecked(theme: ThemePreference, systemDark: boolean) {
  return theme === "system" ? systemDark : theme === "dark";
}

export function themeFromSwitch(
  theme: ThemePreference,
  isChecked: boolean,
  pointerSide: "light" | "dark" | null
): ThemePreference {
  return theme === "system" && pointerSide ? pointerSide : isChecked ? "dark" : "light";
}

export function ThemeSwitch() {
  const [mounted, setMounted] = useState(false);
  const [theme, setThemePreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(false);
  const pointerSide = useRef<"light" | "dark" | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const saved = readThemePreference();
    setThemePreference(saved);
    setSystemDark(media.matches);
    setMounted(true);

    const handleSystemChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = readThemePreference();
      setThemePreference(nextTheme);
      applyThemePreference(nextTheme);
    };

    media.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      media.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the switch usable for this session when storage is unavailable.
    }
    applyThemePreference(nextTheme);
    setThemePreference(nextTheme);
  }, []);

  const handleCheckedChange = useCallback(
    (isChecked: boolean) => {
      // In System mode each half is directly selectable, including the half
      // that currently matches the operating system's resolved appearance.
      const nextTheme = themeFromSwitch(theme, isChecked, pointerSide.current);
      pointerSide.current = null;
      setTheme(nextTheme);
    },
    [setTheme, theme]
  );

  // The track and System slot keep their final footprint during hydration.
  if (!mounted) {
    return (
      <div className={styles.root} aria-hidden="true">
        <span className={styles.placeholderTrack} />
        <span className={styles.placeholderSystem} />
      </div>
    );
  }

  const checked = switchChecked(theme, systemDark);

  return (
    <div className={styles.root}>
      <div className={styles.switchWrap}>
        <Switch
          checked={checked}
          onCheckedChange={handleCheckedChange}
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            pointerSide.current = event.clientX < bounds.left + bounds.width / 2 ? "light" : "dark";
          }}
          onPointerCancel={() => { pointerSide.current = null; }}
          onKeyDown={() => { pointerSide.current = null; }}
          aria-label="Sendloom dashboard theme"
          className={styles.track}
        />

        <span className={styles.sunSlot} aria-hidden="true">
          <SunIcon size={16} className={`${styles.icon} ${checked ? styles.inactive : styles.active}`} />
        </span>
        <span className={styles.moonSlot} aria-hidden="true">
          <MoonIcon size={16} className={`${styles.icon} ${checked ? styles.active : styles.inactive}`} />
        </span>
      </div>

      <button
        type="button"
        className={`${styles.systemButton} ${theme === "system" ? styles.systemActive : ""}`}
        aria-label="Use system theme"
        aria-pressed={theme === "system"}
        title="System theme"
        onClick={() => setTheme("system")}
      >
        <MonitorIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
