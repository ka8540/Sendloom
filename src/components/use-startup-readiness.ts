"use client";

import { useEffect, useState } from "react";

import {
  EXIT_MS,
  MAX_VISIBLE_MS,
  MIN_VISIBLE_MS,
  SPLASH_STAGES,
  STAGE_THRESHOLDS_MS,
  resolveStageIndex,
  type SplashPhase
} from "@/components/startup-splash-core";

export type StartupReadiness = {
  phase: SplashPhase;
  /** Index into SPLASH_STAGES for the current broad stage copy. */
  stage: number;
};

/**
 * Drives the startup splash lifecycle from *readiness + wall-clock time*, not
 * from any animation.
 *
 * The real (server-rendered) page is interactive as soon as this hook's effect
 * runs — that IS the app-ready signal. From there the only rule is: hold for a
 * brief, premium minimum, then exit. A hard safety ceiling guarantees the overlay
 * is always removed, so it can never get stuck.
 *
 * Hidden-tab safe by construction:
 *   • dismissal and stage advance use setTimeout + Date.now(), never
 *     requestAnimationFrame or animation callbacks (frozen in background tabs);
 *   • if time elapsed while the tab was hidden, returning to it reconciles the
 *     stage and dismisses immediately via visibilitychange / focus / pageshow;
 *   • it never resets, never re-mounts a second splash, never restarts a timer;
 *   • the max ceiling removes the overlay even if every timer is throttled.
 */
export function useStartupReadiness(): StartupReadiness {
  const [phase, setPhase] = useState<SplashPhase>("loading");
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const start = Date.now();
    let dismissed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let minTimer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;

    const elapsed = () => Date.now() - start;

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
      // Land on the final "ready" stage as the exit plays.
      setStage(SPLASH_STAGES.length - 1);
      setPhase("exiting");
      // Remove after the exit. Scheduled off a timer (NOT animationend) so a
      // hidden/throttled tab still unmounts the overlay and cannot get stuck.
      exitTimer = setTimeout(() => setPhase("done"), EXIT_MS);
    };

    // Evaluate the readiness rule now, or schedule the remainder of the minimum.
    const evaluate = () => {
      if (dismissed) {
        return;
      }
      if (elapsed() >= MIN_VISIBLE_MS) {
        dismiss();
      } else if (!minTimer) {
        minTimer = setTimeout(dismiss, MIN_VISIBLE_MS - elapsed());
      }
    };

    // Return-to-tab reconciliation: recompute the stage from wall-clock time and
    // dismiss immediately if the minimum already elapsed while hidden.
    const reconcile = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (!dismissed) {
        setStage(resolveStageIndex(elapsed()));
      }
      evaluate();
    };

    // Schedule the broad stage-copy advances (decorative; does not gate exit).
    for (let index = 1; index < STAGE_THRESHOLDS_MS.length; index += 1) {
      const at = STAGE_THRESHOLDS_MS[index];
      timers.push(
        setTimeout(() => {
          if (!dismissed) {
            setStage(index);
          }
        }, at)
      );
    }

    evaluate();
    // Absolute safety net — never outlive the ceiling, regardless of anything.
    maxTimer = setTimeout(dismiss, MAX_VISIBLE_MS);

    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
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

  return { phase, stage };
}
