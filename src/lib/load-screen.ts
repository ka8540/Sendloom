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

// ---------------------------------------------------------------------------
// 30-minute cooldown. Once the splash has actually been shown, hard refreshes
// of the public entry paths within the window skip it entirely — the page
// appears immediately. The stamp is written at the moment the boot script
// commits to showing (not when the animation ends), so rapid refreshes during
// the splash do not replay it. Storage failures (private mode, quota, denial)
// must never crash the boot path: they simply fall back to showing the splash.
// ---------------------------------------------------------------------------

export const STARTUP_SPLASH_COOLDOWN_MS = 30 * 60 * 1000;
export const STARTUP_SPLASH_LAST_SHOWN_KEY = "sendloom:startup-splash:last-shown-at";

/** Minimal storage surface so tests (and non-browser callers) can inject one. */
export type SplashCooldownStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function resolveStorage(): SplashCooldownStorage | null {
  // Merely touching window.localStorage can throw (storage-denied embeds,
  // some private modes), so the access itself is guarded.
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether the splash was shown recently enough to skip it. Missing, malformed,
 * or future timestamps and unavailable/throwing storage all report `false`
 * (i.e. show the splash) — the cooldown only ever suppresses, never blocks.
 */
export function isStartupSplashCooldownActive(
  now: number = Date.now(),
  storage: SplashCooldownStorage | null = resolveStorage()
): boolean {
  if (!storage) {
    return false;
  }
  try {
    const raw = storage.getItem(STARTUP_SPLASH_LAST_SHOWN_KEY);
    const lastShownAt = raw === null || raw === "" ? Number.NaN : Number(raw);
    if (!Number.isFinite(lastShownAt)) {
      return false;
    }
    const elapsed = now - lastShownAt;
    // Future timestamps (clock changes) are invalid, not "fresh forever".
    return elapsed >= 0 && elapsed < STARTUP_SPLASH_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/** Record that the splash was shown. Never throws; a failed write only means
 *  the splash may repeat on the next load. */
export function markStartupSplashShown(
  now: number = Date.now(),
  storage: SplashCooldownStorage | null = resolveStorage()
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STARTUP_SPLASH_LAST_SHOWN_KEY, String(now));
  } catch {
    // Storage denied/full — fall back silently.
  }
}

// Runs synchronously (parser-blocking) before the page paints and before React
// hydrates, so the show/skip decision — including the cooldown read — happens
// before the overlay could ever be seen: no flash-then-hide. It records the
// decision on <html data-load-screen>; the stamp is written here, exactly once
// per hard load, and only when the decision is "show" (a skipped splash never
// refreshes its own cooldown). The script must stay self-contained, so it
// mirrors the helpers above with the same key/TTL interpolated in.
export const loadScreenInitScript = `
(() => {
  var show = false;
  try {
    var paths = ${JSON.stringify(LOAD_SCREEN_PATHS)};
    show = paths.indexOf(window.location.pathname) !== -1;
    if (show) {
      try {
        var storage = window.localStorage;
        var raw = storage.getItem(${JSON.stringify(STARTUP_SPLASH_LAST_SHOWN_KEY)});
        var last = raw === null || raw === "" ? NaN : Number(raw);
        var now = Date.now();
        if (Number.isFinite(last) && now - last >= 0 && now - last < ${STARTUP_SPLASH_COOLDOWN_MS}) {
          show = false;
        } else {
          storage.setItem(${JSON.stringify(STARTUP_SPLASH_LAST_SHOWN_KEY)}, String(now));
        }
      } catch (storageError) {
        // Storage unavailable (private mode, denial): fall back to showing.
      }
    }
  } catch (error) {
    show = false;
  }
  try {
    document.documentElement.dataset.loadScreen = show ? "show" : "hide";
  } catch (innerError) {}
})();
`;
