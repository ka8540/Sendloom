// Tiny client helpers for the recovery UI. We only ever derive COARSE families
// (e.g. "Chrome", "macOS") — never the full user-agent string — so nothing
// fingerprintable is collected, and the CSRF token is read straight from the
// double-submit cookie so reporting also works inside the providerless
// global-error boundary (where the global fetch patch isn't mounted).

const CSRF_COOKIE_NAME = "sendloom_csrf";

export function detectBrowserFamily(): string | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) {
    return "Edge";
  }
  if (/OPR\//.test(ua) || /Opera/.test(ua)) {
    return "Opera";
  }
  if (/Firefox\//.test(ua)) {
    return "Firefox";
  }
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) {
    return "Chrome";
  }
  if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    return "Safari";
  }
  return "Other";
}

export function detectPlatform(): string | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) {
    return "Windows";
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    return "macOS";
  }
  if (/Android/.test(ua)) {
    return "Android";
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    return "iOS";
  }
  if (/Linux/.test(ua)) {
    return "Linux";
  }
  return "Other";
}

export function readCsrfToken(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${CSRF_COOKIE_NAME}=`));
  if (!entry) {
    return null;
  }
  return decodeURIComponent(entry.slice(CSRF_COOKIE_NAME.length + 1));
}

export function generateIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Build the Gmail reconnect URL, returning to the current page afterward. */
export function gmailReconnectHref(): string {
  const next = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/workspace";
  return `/api/auth/google/connect?next=${encodeURIComponent(next)}`;
}
