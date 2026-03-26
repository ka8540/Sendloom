"use client";

import { LaptopMinimal, MoonStar, SunMedium } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const isFooterMenu = className.includes("theme-menu--footer");

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

    const updatePosition = () => {
      const trigger = triggerRef.current;

      if (!trigger || !isFooterMenu) {
        setMenuStyle(undefined);
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const inCollapsedSidebar = Boolean(trigger.closest(".sidebar.is-collapsed"));

      if (inCollapsedSidebar) {
        setMenuStyle({
          left: rect.right + 12,
          position: "fixed",
          top: Math.max(12, rect.bottom - 214),
          zIndex: 80
        });
        return;
      }

      setMenuStyle({
        left: rect.left,
        position: "fixed",
        top: Math.max(12, rect.top - 214 - 12),
        zIndex: 80
      });
    };

    updatePosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
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
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isFooterMenu, open]);

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
  const menu = (
    <div
      id={menuId}
      ref={panelRef}
      className={`theme-menu__panel${isFooterMenu ? " theme-menu__panel--floating" : ""}`}
      style={menuStyle}
      role="menu"
      aria-label="Color theme options"
    >
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
  );

  return (
    <div ref={rootRef} className={`theme-menu${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
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

      {open ? (isFooterMenu ? createPortal(menu, document.body) : menu) : null}
    </div>
  );
}
