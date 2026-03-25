"use client";

import { LaptopMinimal, MoonStar, SunMedium } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

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

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const updateTheme = (nextTheme: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Fall back to the in-memory state if storage is unavailable.
    }

    applyThemePreference(nextTheme);
    setTheme(nextTheme);
    setOpen(false);
  };

  const activeOption = options.find((option) => option.value === theme) ?? options[2];
  const ActiveIcon = activeOption.icon;

  return (
    <div ref={rootRef} className={`theme-menu${className ? ` ${className}` : ""}`}>
      <button
        className={`theme-menu__trigger${open ? " is-open" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        aria-label={`Theme: ${activeOption.label}. Open theme menu`}
        title={`Theme: ${activeOption.label}`}
      >
        <ActiveIcon aria-hidden="true" />
      </button>

      {open ? (
        <div id={menuId} className="theme-menu__panel" role="menu" aria-label="Color theme options">
          {options.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;

            return (
              <button
                key={option.value}
                className={`theme-menu__option${active ? " is-active" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => updateTheme(option.value)}
                title={`Use ${option.label.toLowerCase()} theme`}
              >
                <Icon aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
