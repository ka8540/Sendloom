"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { resolvesToDark } from "@/components/dashboard-theme-switch-state";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import styles from "./dashboard-theme-switch.module.css";

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
    return;
  }
  root.dataset.theme = preference;
  root.style.colorScheme = preference;
}

export function DashboardThemeSwitch({ collapsed }: { collapsed: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [checked, setChecked] = useState(false);
  const orientation = collapsed ? "vertical" : "horizontal";

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const syncWithPreference = () => {
      const preference = readPreference();
      applyPreference(preference);
      setChecked(resolvesToDark(preference, systemTheme.matches));
    };

    syncWithPreference();
    setMounted(true);
    window.addEventListener("storage", syncWithPreference);
    systemTheme.addEventListener("change", syncWithPreference);
    return () => {
      window.removeEventListener("storage", syncWithPreference);
      systemTheme.removeEventListener("change", syncWithPreference);
    };
  }, []);

  const handleCheckedChange = useCallback(() => {
    const nextChecked = !checked;
    const nextTheme = nextChecked ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The control still works for this session if storage is unavailable.
    }
    applyPreference(nextTheme);
    setChecked(nextChecked);
  }, [checked]);

  return (
    <div className={styles.slot} data-orientation={orientation}>
      {mounted ? (
        <button
          className={styles.track}
          type="button"
          role="switch"
          aria-label="Dashboard dark theme"
          aria-checked={checked}
          data-checked={checked}
          data-orientation={orientation}
          onClick={handleCheckedChange}
        >
          <span className={`${styles.icon} ${styles.sun}`} aria-hidden="true">
            <SunIcon size={16} />
          </span>
          <span className={`${styles.icon} ${styles.moon}`} aria-hidden="true">
            <MoonIcon size={16} />
          </span>
          <span className={styles.thumb} aria-hidden="true" />
        </button>
      ) : (
        <div className={styles.track} data-orientation={orientation} aria-hidden="true" />
      )}
    </div>
  );
}
