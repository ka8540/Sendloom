"use client";

import { useEffect, useState } from "react";

import { EXIT_MS, MAX_VISIBLE_MS, MIN_VISIBLE_MS, type SplashPhase } from "@/components/startup-splash-core";

/**
 * Drives the startup splash lifecycle from *readiness*, not from any animation.
 *
 * The real (server-rendered) page is interactive as soon as this hook's effect
 * runs — that IS the app-ready signal. From there the only rule is: hold for a
 * brief, premium minimum, then fade out. A hard safety ceiling guarantees the
 * overlay is always removed, so it can never get stuck.
 *
 * Hidden-tab safe by construction:
 *   • dismissal uses setTimeout + a monotonic clock, never requestAnimationFrame
 *     or animation callbacks (which browsers freeze in background tabs);
 *   • if the minimum elapsed while the tab was hidden, returning to it dismisses
 *     immediately via visibilitychange / focus / pageshow reconciliation;
 *   • it never resets, never re-mounts a second splash, never restarts a timer;
 *   • the max ceiling removes the overlay even if every timer is throttled.
 */
export function useStartupReadiness(): SplashPhase {
  const [phase, setPhase] = useState<SplashPhase>("loading");

  useEffect(() => {
    const start = Date.now();
    let dismissed = false;
    let minTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;

    const dismiss = () => {
      if (dismissed) {
        return;
      }
      dismissed = true;
      if (minTimer) {
        clearTimeout(minTimer);
        minTimer = undefined;
      }
      if (maxTimer) {
        clearTimeout(maxTimer);
        maxTimer = undefined;
      }
      setPhase("exiting");
      // Remove after the fade. Scheduled off a timer (NOT transitionend) so a
      // hidden/throttled tab still unmounts the overlay and cannot get stuck.
      exitTimer = setTimeout(() => setPhase("done"), EXIT_MS);
    };

    // Evaluate the readiness rule now, or schedule the remainder of the minimum.
    const evaluate = () => {
      if (dismissed) {
        return;
      }
      const elapsed = Date.now() - start;
      if (elapsed >= MIN_VISIBLE_MS) {
        dismiss();
      } else if (!minTimer) {
        minTimer = setTimeout(dismiss, MIN_VISIBLE_MS - elapsed);
      }
    };

    // Return-to-tab reconciliation: if the minimum already elapsed while hidden,
    // dismiss immediately rather than waiting on a throttled background timer.
    const reconcile = () => {
      if (document.visibilityState === "visible") {
        evaluate();
      }
    };

    evaluate();
    // Absolute safety net — never outlive the ceiling, regardless of anything.
    maxTimer = setTimeout(dismiss, MAX_VISIBLE_MS);

    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);

    return () => {
      if (minTimer) {
        clearTimeout(minTimer);
      }
      if (maxTimer) {
        clearTimeout(maxTimer);
      }
      if (exitTimer) {
        clearTimeout(exitTimer);
      }
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
    };
  }, []);

  return phase;
}
