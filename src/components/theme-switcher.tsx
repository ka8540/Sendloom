"use client";

import { LaptopMinimal, MoonStar, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";

import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

const options = [
  { value: "light", label: "Light", icon: SunMedium },
  { value: "dark", label: "Dark", icon: MoonStar },
  { value: "system", label: "System", icon: LaptopMinimal }
] as const;

function readThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);

    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyThemePreference(theme: ThemePreference) {
  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
    return;
  }

  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeSwitcher({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    const savedTheme = readThemePreference();
    setTheme(savedTheme);
    applyThemePreference(savedTheme);

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== THEME_STORAGE_KEY) {
        return;
      }

      const nextTheme = readThemePreference();
      setTheme(nextTheme);
      applyThemePreference(nextTheme);
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const updateTheme = (nextTheme: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Fall back to the in-memory state if storage is unavailable.
    }

    applyThemePreference(nextTheme);
    setTheme(nextTheme);
  };

  return (
    <div className={`theme-switcher${className ? ` ${className}` : ""}`} role="group" aria-label="Color theme">
      {options.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;

        return (
          <button
            key={option.value}
            className={`theme-switcher__option${active ? " is-active" : ""}`}
            type="button"
            onClick={() => updateTheme(option.value)}
            aria-pressed={active}
            title={`Use ${option.label.toLowerCase()} theme`}
          >
            <Icon aria-hidden="true" />
            <span className="theme-switcher__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
