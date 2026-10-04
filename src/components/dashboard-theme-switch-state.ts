import type { ThemePreference } from "@/lib/theme";

export const DASHBOARD_THEMES = ["light", "system", "dark"] as const satisfies readonly ThemePreference[];

export function themeIndex(theme: ThemePreference): number {
  return DASHBOARD_THEMES.indexOf(theme);
}

export function themeForKey(
  key: string,
  theme: ThemePreference,
  collapsed: boolean
): ThemePreference | null {
  if (key === "Home") return "light";
  if (key === "End") return "dark";

  const next = collapsed ? key === "ArrowDown" : key === "ArrowRight";
  const previous = collapsed ? key === "ArrowUp" : key === "ArrowLeft";
  if (!next && !previous) return null;

  const current = themeIndex(theme);
  return DASHBOARD_THEMES[(current + (next ? 1 : DASHBOARD_THEMES.length - 1)) % DASHBOARD_THEMES.length];
}
