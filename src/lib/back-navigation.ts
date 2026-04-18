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

export function canUseBrowserBack(args: {
  currentOrigin: string;
  currentPathname: string;
  historyLength: number;
  referrer: string;
}) {
  const { currentOrigin, currentPathname, historyLength, referrer } = args;

  if (historyLength <= 1 || !referrer) {
    return false;
  }

  try {
    const referrerUrl = new URL(referrer);

    if (referrerUrl.origin !== currentOrigin || referrerUrl.pathname === currentPathname) {
      return false;
    }

    if (isAppPath(currentPathname)) {
      return isAppPath(referrerUrl.pathname);
    }

    return true;
  } catch {
    return false;
  }
}
