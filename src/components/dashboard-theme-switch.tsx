"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import styles from "./dashboard-theme-switch.module.css";

export const nextTheme: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light"
};

const icons: Record<ThemePreference, LucideIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon
};

const initial = { rotate: -90, opacity: 0, scale: 0.5 };
const animate = { rotate: 0, opacity: 1, scale: 1 };
const exit = { rotate: 90, opacity: 0, scale: 0.5 };
const transition = { duration: 0.3 };

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

export function DashboardThemeSwitch() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    const syncWithPreference = () => {
      const saved = readPreference();
      setTheme(saved);
      applyPreference(saved);
    };
    syncWithPreference();
    setMounted(true);
    window.addEventListener("storage", syncWithPreference);
    return () => window.removeEventListener("storage", syncWithPreference);
  }, []);

  const handleClick = useCallback(() => {
    const next = nextTheme[theme];
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The control remains usable in this session if storage is unavailable.
    }
    applyPreference(next);
    setTheme(next);
  }, [theme]);

  if (!mounted) {
    return (
      <div className={styles.slot} aria-hidden="true">
        <span className={`${styles.circle} ${styles.placeholder}`} />
      </div>
    );
  }

  const Icon = icons[theme];
  const label = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}. Switch to ${nextTheme[theme][0].toUpperCase()}${nextTheme[theme].slice(1)}.`;

  return (
    <div className={styles.slot}>
      <button className={styles.circle} type="button" onClick={handleClick} aria-label={label} title={label}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            className={styles.animatedIcon}
            initial={initial}
            animate={animate}
            exit={exit}
            transition={transition}
          >
            <Icon size={18} aria-hidden="true" />
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}
