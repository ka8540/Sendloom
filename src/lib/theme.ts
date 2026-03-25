export const THEME_STORAGE_KEY = "sendloom-theme";

export const themePreferences = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof themePreferences)[number];

export const themeInitScript = `
(() => {
  try {
    const root = document.documentElement;
    const saved = window.localStorage.getItem("${THEME_STORAGE_KEY}");

    if (saved === "light" || saved === "dark") {
      root.dataset.theme = saved;
      root.style.colorScheme = saved;
      return;
    }

    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
  } catch {}
})();
`;
