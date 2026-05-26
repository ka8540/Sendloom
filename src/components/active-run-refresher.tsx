"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

const RESUME_REFRESH_DELAY_MS = 250;

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function ActiveRunRefresher({
  active,
  intervalMs = 8_000
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  const lastRefreshAtRef = useRef(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!active) {
      return;
    }

    let resumeTimeoutId: number | null = null;

    function refreshIfVisible(force = false) {
      if (!isDocumentVisible()) {
        return;
      }

      const now = Date.now();
      if (!force && now - lastRefreshAtRef.current < intervalMs) {
        return;
      }

      lastRefreshAtRef.current = now;
      startTransition(() => {
        router.refresh();
      });
    }

    const interval = window.setInterval(() => {
      refreshIfVisible();
    }, intervalMs);

    function handleVisibilityChange() {
      if (!isDocumentVisible()) {
        return;
      }

      if (resumeTimeoutId !== null) {
        window.clearTimeout(resumeTimeoutId);
      }

      resumeTimeoutId = window.setTimeout(() => {
        resumeTimeoutId = null;
        refreshIfVisible(true);
      }, RESUME_REFRESH_DELAY_MS);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (resumeTimeoutId !== null) {
        window.clearTimeout(resumeTimeoutId);
      }
    };
  }, [active, intervalMs, router, startTransition]);

  return null;
}
