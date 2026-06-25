"use client";

import { useEffect, useRef } from "react";

import { useManual } from "@/components/manual/ManualProvider";
import {
  getEligibleOverviewStages,
  resolveOverviewChangedStage,
  type OverviewTourState
} from "@/manuals/workspaceManual";

const AUTO_OPEN_DELAY_MS = 700;

/**
 * Drives the Overview's progressive, one-time onboarding. It renders nothing —
 * it reads the already-loaded dashboard state (passed as props, so the tour
 * makes no extra backend requests) and, once per visit, auto-opens the single
 * highest-priority phase the user has not yet completed. It also publishes a
 * marker the floating Help menu reads to offer "Learn what changed".
 *
 * Guards: it never opens while a tour/menu is already on screen, waits for the
 * layout to settle, and only ever fires one phase per mount so returning users
 * are not walked through several tours back-to-back.
 */
export function OverviewTourLauncher({ state }: { state: OverviewTourState }) {
  const { manual, isOpen, openManualStage, isStageComplete } = useManual();
  const launchedRef = useRef(false);

  // Publish the most relevant "what changed" phase for the Help menu.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    const changed = resolveOverviewChangedStage(state);
    if (changed) {
      root.dataset.tourChangedStage = changed;
    } else {
      delete root.dataset.tourChangedStage;
    }
    return () => {
      delete document.documentElement.dataset.tourChangedStage;
    };
  }, [state]);

  // Auto-open the first eligible, not-yet-seen phase once per visit.
  useEffect(() => {
    if (!manual || isOpen || launchedRef.current) {
      return;
    }

    const next = getEligibleOverviewStages(state).find((stage) => !isStageComplete(stage));
    if (!next) {
      return;
    }

    launchedRef.current = true;
    const timer = window.setTimeout(() => {
      // A tour or the Help menu may have opened during the settle delay; if so,
      // stay out of the way rather than stacking another tour on top.
      const tourOpen = document.querySelector("[data-manual-popover='true']");
      const menuOpen = document.querySelector("[data-tour-help-menu='true']");
      if (!tourOpen && !menuOpen) {
        openManualStage(next);
      }
    }, AUTO_OPEN_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [manual, isOpen, state, openManualStage, isStageComplete]);

  return null;
}
