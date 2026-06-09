export type AppFallbackHref = "/" | "/admin" | "/campaigns" | "/finder" | "/imports" | "/suppressions" | "/templates" | "/workspace";

const APP_PATH_PREFIXES = ["/admin", "/campaigns", "/finder", "/imports", "/sequences", "/suppressions", "/templates", "/workspace"] as const;

export function isAppPath(pathname: string) {
  return APP_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function getDefaultBackFallback(pathname: string): AppFallbackHref {
  if (pathname.startsWith("/admin")) {
    return "/admin";
  }

  if (isAppPath(pathname)) {
    return "/workspace";
  }

  return "/";
}

/**
 * Decide whether the in-app back button should call `router.back()` or fall back
 * to a safe in-app route.
 *
 * `document.referrer` cannot answer this: it only reflects the document-load
 * referrer and never changes during client-side (SPA) navigation, so it wrongly
 * rejected app-to-app moves and sent every back press to the dashboard. Instead
 * we rely on the count of in-app navigations performed since the app shell
 * mounted (`navigationDepth`). A positive depth means there is a real previous
 * in-app entry to return to; a depth of zero means the user landed directly on
 * this page (deep link / new tab / first page after login) and going back could
 * leave the app, so the caller should use the fallback.
 */
export function shouldUseBrowserBack(args: { alwaysUseFallback?: boolean; navigationDepth: number }) {
  if (args.alwaysUseFallback) {
    return false;
  }

  return args.navigationDepth > 0;
}
