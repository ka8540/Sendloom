// The startup splash appears on a true full-page load of the public entry paths
// (landing + auth). It is a boot transition, so it is intentionally NOT shown
// during client-side navigation between pages — the root layout persists, so the
// splash component never re-mounts. It is brief and readiness-driven; see
// components/use-startup-readiness.ts.
export const LOAD_SCREEN_PATHS = ["/", "/login", "/signup"] as const;

// Data attribute set on <html> by the synchronous boot script below. CSS reads
// it to keep the splash overlay covering the page from the very first paint on
// splash paths (and to hide it with no flash on every other route / no-JS).
export const LOAD_SCREEN_ATTRIBUTE = "load-screen";

export function isLoadScreenPath(pathname: string | null | undefined): boolean {
  return Boolean(pathname) && (LOAD_SCREEN_PATHS as readonly string[]).includes(pathname as string);
}

// Runs synchronously (parser-blocking) before the page paints and before React
// hydrates. It records the decision on <html data-load-screen> so the splash is
// the first thing the user sees on a splash path, and is fully suppressed (no
// flash) everywhere else. No storage / no cooldown: the splash is brief and
// dismissed by app readiness, so a plain per-load decision is all that's needed.
export const loadScreenInitScript = `
(() => {
  try {
    var root = document.documentElement;
    var paths = ${JSON.stringify(LOAD_SCREEN_PATHS)};
    root.dataset.loadScreen = paths.indexOf(window.location.pathname) === -1 ? "hide" : "show";
  } catch (error) {
    try {
      document.documentElement.dataset.loadScreen = "hide";
    } catch (innerError) {}
  }
})();
`;
