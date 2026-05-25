"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { LoadScreen } from "@/components/load-screen";

const LOAD_SCREEN_PATHS = new Set(["/", "/login", "/signup"]);
const LOAD_SCREEN_LAST_SHOWN_KEY = "sendloom.loadScreen.lastShownAt";
export const LOAD_SCREEN_COOLDOWN_MS = 30 * 60 * 1000;

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

export function PublicLoadScreen() {
  const pathname = usePathname();
  const [showLoadScreen, setShowLoadScreen] = useState(false);

  useEffect(() => {
    if (!pathname || !LOAD_SCREEN_PATHS.has(pathname)) {
      setShowLoadScreen(false);
      return;
    }

    try {
      const now = Date.now();
      const lastShownAt = window.localStorage.getItem(LOAD_SCREEN_LAST_SHOWN_KEY);

      if (shouldShowLoadScreen(lastShownAt, now)) {
        window.localStorage.setItem(LOAD_SCREEN_LAST_SHOWN_KEY, String(now));
        setShowLoadScreen(true);
      } else {
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
