"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { LoadScreen } from "@/components/load-screen";
import {
  LOAD_SCREEN_COOLDOWN_MS,
  LOAD_SCREEN_LAST_SHOWN_KEY,
  isLoadScreenPath,
  shouldShowLoadScreen
} from "@/lib/load-screen";

// Re-exported so existing tests keep importing from this module.
export { LOAD_SCREEN_COOLDOWN_MS, shouldShowLoadScreen };

// useLayoutEffect runs before paint on the client (so a cooldown "hide" unmounts
// the loader before its heavy Three.js effect ever fires), but warns during SSR.
// Falling back to useEffect on the server keeps render clean and warning-free.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function PublicLoadScreen() {
  const pathname = usePathname();

  // Initial state is derived purely from the pathname so the server and the first
  // client render agree (no hydration mismatch). On load-screen paths the loader
  // is therefore part of the initial HTML and covers the page from the first
  // paint — landing content can never flash in front of it.
  const [showLoadScreen, setShowLoadScreen] = useState(() => isLoadScreenPath(pathname));
  const hasReconciledRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    if (!isLoadScreenPath(pathname)) {
      hasReconciledRef.current = true;
      setShowLoadScreen(false);
      return;
    }

    // First client pass: trust the synchronous boot script, which already applied
    // the cooldown and recorded the timestamp. Re-deriving it here would either
    // double-count the cooldown or hide a loader that should stay visible.
    if (!hasReconciledRef.current) {
      hasReconciledRef.current = true;
      setShowLoadScreen(document.documentElement.dataset.loadScreen === "show");
      return;
    }

    // Subsequent in-app navigations between load-screen paths: the boot script
    // only runs on a full document load, so re-evaluate the cooldown ourselves.
    try {
      const now = Date.now();
      const lastShownAt = window.localStorage.getItem(LOAD_SCREEN_LAST_SHOWN_KEY);

      if (shouldShowLoadScreen(lastShownAt, now)) {
        window.localStorage.setItem(LOAD_SCREEN_LAST_SHOWN_KEY, String(now));
        document.documentElement.dataset.loadScreen = "show";
        setShowLoadScreen(true);
      } else {
        document.documentElement.dataset.loadScreen = "hide";
        setShowLoadScreen(false);
      }
    } catch {
      setShowLoadScreen(false);
    }
  }, [pathname]);

  if (!showLoadScreen) {
    return null;
  }

  return <LoadScreen />;
}
