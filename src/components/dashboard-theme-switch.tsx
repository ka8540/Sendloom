"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  forwardRef,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import { createPortal } from "react-dom";

import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import styles from "./dashboard-theme-switch.module.css";

const themes = ["light", "system", "dark"] as const;
const icons: Record<ThemePreference, LucideIcon> = {
  light: SunIcon,
  system: MonitorIcon,
  dark: MoonIcon
};

const iconInitial = { rotate: -90, opacity: 0, scale: 0.5 };
const iconAnimate = { rotate: 0, opacity: 1, scale: 1 };
const iconExit = { rotate: 90, opacity: 0, scale: 0.5 };
const iconTransition = { duration: 0.3 };

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "system" || saved === "dark" ? saved : "system";
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

type CircleButtonProps = {
  value: ThemePreference;
  selected?: boolean;
  animationSequence: number;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value">;

const ThemeCircleButton = forwardRef<HTMLButtonElement, CircleButtonProps>(function ThemeCircleButton({
  value,
  selected = false,
  animationSequence,
  className = "",
  ...buttonProps
}, ref) {
  const Icon = icons[value];

  return (
    <button
      {...buttonProps}
      ref={ref}
      className={`${styles.circle}${selected ? ` ${styles.selected}` : ""}${className ? ` ${className}` : ""}`}
      type="button"
    >
      <AnimatePresence mode="sync">
        <motion.span
          key={`${value}-${animationSequence}`}
          className={styles.animatedIcon}
          initial={iconInitial}
          animate={iconAnimate}
          exit={iconExit}
          transition={iconTransition}
        >
          <Icon size={24} aria-hidden="true" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
});

export function DashboardThemeSwitch({ collapsed }: { collapsed: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [animationSequences, setAnimationSequences] = useState<Record<ThemePreference, number>>({
    light: 0,
    system: 0,
    dark: 0
  });
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Record<ThemePreference, HTMLButtonElement | null>>({
    light: null,
    system: null,
    dark: null
  });
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const syncWithPreference = () => {
      const next = readPreference();
      setTheme(next);
      applyPreference(next);
    };
    syncWithPreference();
    setMounted(true);
    window.addEventListener("storage", syncWithPreference);
    return () => window.removeEventListener("storage", syncWithPreference);
  }, []);

  useEffect(() => {
    if (!collapsed) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      setOpen(false);
    }
  }, [collapsed]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[theme]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 178;
      const height = 66;
      const gutter = 12;
      setPopoverStyle({
        left: Math.min(rect.right + 12, window.innerWidth - width - gutter),
        top: Math.min(
          Math.max(gutter, rect.top + rect.height / 2 - height / 2),
          window.innerHeight - height - gutter
        )
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        setOpen(false);
      }
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const selectTheme = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Keep this session usable if storage is unavailable.
    }
    applyPreference(next);
    setTheme(next);
    setAnimationSequences((current) => ({ ...current, [next]: current[next] + 1 }));

    if (collapsed) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setOpen(false);
        triggerRef.current?.focus();
      }, 330);
    }
  }, [collapsed]);

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, value: ThemePreference) => {
    const index = themes.indexOf(value);
    let next: ThemePreference | null = null;
    if (event.key === "ArrowRight") next = themes[(index + 1) % themes.length];
    if (event.key === "ArrowLeft") next = themes[(index + themes.length - 1) % themes.length];
    if (event.key === "Home") next = "light";
    if (event.key === "End") next = "dark";
    if (!next) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
    selectTheme(next);
  };

  const renderOptions = () => themes.map((value) => (
    <ThemeCircleButton
      key={value}
      ref={(element: HTMLButtonElement | null) => { optionRefs.current[value] = element; }}
      value={value}
      selected={theme === value}
      animationSequence={animationSequences[value]}
      role="radio"
      aria-checked={theme === value}
      aria-label={`Use ${value} theme`}
      title={`Use ${value} theme`}
      tabIndex={theme === value ? 0 : -1}
      onClick={() => selectTheme(value)}
      onKeyDown={(event) => onOptionKeyDown(event, value)}
    />
  ));

  if (!mounted) {
    return (
      <div className={styles.slot} data-collapsed={collapsed} aria-hidden="true">
        {collapsed ? (
          <span className={styles.circle} />
        ) : (
          <div className={styles.row}>{themes.map((value) => <span key={value} className={styles.circle} />)}</div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.slot} data-collapsed={collapsed}>
      {collapsed ? (
        <ThemeCircleButton
          ref={triggerRef}
          value={theme}
          selected
          animationSequence={animationSequences[theme]}
          aria-label={`Theme: ${theme}. Choose theme`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`Theme: ${theme}`}
          onClick={() => {
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) {
              setPopoverStyle({
                left: Math.min(rect.right + 12, window.innerWidth - 190),
                top: Math.min(Math.max(12, rect.top - 9), window.innerHeight - 78)
              });
            }
            setOpen((current) => !current);
          }}
        />
      ) : (
        <div className={styles.row} role="radiogroup" aria-label="Dashboard color theme">
          {renderOptions()}
        </div>
      )}
      {collapsed && open && popoverStyle ? createPortal(
        <div ref={popoverRef} className={styles.popover} style={popoverStyle} role="dialog" aria-label="Choose dashboard theme">
          <div className={styles.row} role="radiogroup" aria-label="Dashboard color theme">
            {renderOptions()}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
