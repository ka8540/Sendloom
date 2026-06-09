export const LOAD_SCREEN_PATHS = ["/", "/login", "/signup"] as const;
export const LOAD_SCREEN_LAST_SHOWN_KEY = "sendloom.loadScreen.lastShownAt";
export const LOAD_SCREEN_COOLDOWN_MS = 30 * 60 * 1000;

// Data attribute set on <html> by the synchronous boot script below. CSS reads it
// to keep the loader overlay covering the page from the very first paint (or to
// hide it instantly during the cooldown window) so landing content never flashes.
export const LOAD_SCREEN_ATTRIBUTE = "load-screen";

export function isLoadScreenPath(pathname: string | null | undefined): boolean {
  return Boolean(pathname) && (LOAD_SCREEN_PATHS as readonly string[]).includes(pathname as string);
}

export function shouldShowLoadScreen(lastShownAt: string | null, now = Date.now()) {
  if (!lastShownAt) {
    return true;
  }

  const timestamp = Number(lastShownAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return true;
  }

  return now - timestamp >= LOAD_SCREEN_COOLDOWN_MS;
}

// Runs synchronously (parser-blocking) before the page paints and before React
// hydrates, mirroring shouldShowLoadScreen + the cooldown bookkeeping. It records
// the decision on <html data-load-screen> so the loader is the first thing the
// user sees on a fresh visit, and is fully suppressed (no flash) within cooldown.
export const loadScreenInitScript = `
(() => {
  try {
    var root = document.documentElement;
    var paths = ${JSON.stringify(LOAD_SCREEN_PATHS)};
    var key = ${JSON.stringify(LOAD_SCREEN_LAST_SHOWN_KEY)};
    var cooldown = ${LOAD_SCREEN_COOLDOWN_MS};

    if (paths.indexOf(window.location.pathname) === -1) {
      root.dataset.loadScreen = "hide";
      return;
    }

    var now = Date.now();
    var lastShownAt = window.localStorage.getItem(key);
    var show;

    if (lastShownAt === null) {
      show = true;
    } else {
      var timestamp = Number(lastShownAt);
      show = !isFinite(timestamp) || timestamp <= 0 || now - timestamp >= cooldown;
    }

    if (show) {
      window.localStorage.setItem(key, String(now));
      root.dataset.loadScreen = "show";
    } else {
      root.dataset.loadScreen = "hide";
    }
  } catch (error) {
    try {
      document.documentElement.dataset.loadScreen = "hide";
    } catch (innerError) {}
  }
})();
`;
