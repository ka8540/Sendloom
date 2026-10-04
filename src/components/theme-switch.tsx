"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import styles from "./theme-switch.module.css";

const options = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "dark", label: "Dark", icon: MoonIcon }
] as const;
const THEME_CHANGE_EVENT = "sendloom-public-theme-change";

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

export function ThemeSwitch() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    setTheme(readThemePreference());
    setMounted(true);

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = readThemePreference();
      setTheme(nextTheme);
      applyThemePreference(nextTheme);
    };
    const handleThemeChange = (event: Event) => setTheme((event as CustomEvent<ThemePreference>).detail);

    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    };
  }, []);

  // Keep the same footprint on the server and during hydration, without
  // claiming that System is selected before the saved preference is known.
  if (!mounted) return <div className={styles.track} aria-hidden="true" />;

  const selectTheme = (nextTheme: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The control still works for this page when storage is unavailable.
    }

    applyThemePreference(nextTheme);
    setTheme(nextTheme);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: nextTheme }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = options.findIndex((option) => option.value === theme);
    let next = current;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current + options.length - 1) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;

    event.preventDefault();
    selectTheme(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className={styles.track} role="radiogroup" aria-label="Color theme" onKeyDown={onKeyDown}>
      <span
        aria-hidden="true"
        className={`${styles.thumb} ${
          theme === "light" ? styles.thumbLight : theme === "system" ? styles.thumbSystem : styles.thumbDark
        }`}
      />
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          className={`${styles.option} ${theme === value ? styles.selected : ""}`}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={`Use ${value} theme`}
          title={label}
          tabIndex={theme === value ? 0 : -1}
          onClick={() => selectTheme(value)}
        >
          <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}
