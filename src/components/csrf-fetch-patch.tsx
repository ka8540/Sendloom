"use client";

import { useEffect } from "react";

const CSRF_COOKIE = "sendloom_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

declare global {
  interface Window {
    __sendloomFetchPatched?: boolean;
  }
}

function readCsrfCookie() {
  if (typeof document === "undefined") {
    return "";
  }

  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : "";
}

async function ensureCsrfCookie(originalFetch: typeof fetch) {
  if (readCsrfCookie()) {
    return readCsrfCookie();
  }

  try {
    await originalFetch("/api/csrf", { credentials: "same-origin" });
  } catch {
    // Network failure here is non-fatal; the actual request will surface the error.
  }

  return readCsrfCookie();
}

function isSameOriginUrl(url: string) {
  if (url.startsWith("/")) {
    return true;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function CsrfFetchPatch() {
  useEffect(() => {
    if (typeof window === "undefined" || window.__sendloomFetchPatched) {
      return;
    }

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      let url: string;
      let intrinsicMethod = "GET";
      let intrinsicHeaders: HeadersInit | undefined;

      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
        intrinsicMethod = input.method;
        intrinsicHeaders = input.headers;
      }

      const requestMethod = (init?.method ?? intrinsicMethod ?? "GET").toUpperCase();
      if (SAFE_METHODS.has(requestMethod) || !isSameOriginUrl(url)) {
        return originalFetch(input, init);
      }

      const headers = new Headers(init?.headers ?? intrinsicHeaders ?? undefined);
      if (!headers.has(CSRF_HEADER)) {
        const token = await ensureCsrfCookie(originalFetch);
        if (token) {
          headers.set(CSRF_HEADER, token);
        }
      }

      return originalFetch(input, { ...(init ?? {}), headers });
    };

    window.__sendloomFetchPatched = true;
  }, []);

  return null;
}
