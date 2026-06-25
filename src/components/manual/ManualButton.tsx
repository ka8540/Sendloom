"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp, Compass, GraduationCap, Sparkles } from "lucide-react";

import type { ManualConfig } from "@/components/manual/manualTypes";
import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

export function ManualButton() {
  const { isOpen, manual, openManual } = useManual();

  if (!manual || isOpen) {
    return null;
  }

  const label = manual.helpLabel ?? "Help";
  const tooltip = manual.helpTooltip ?? "Help";

  // Every dashboard route now uses the premium hover-expanding pill + menu; a
  // manual can opt back to the plain circular control with helpVariant "simple".
  if (manual.helpVariant === "simple") {
    return (
      <button
        className={styles.helpButton}
        type="button"
        onClick={openManual}
        aria-label={label}
        data-manual-help-button="true"
      >
        <CircleHelp aria-hidden="true" />
        <span className={styles.helpTooltip} aria-hidden="true">
          {tooltip}
        </span>
      </button>
    );
  }

  return <DashboardHelpButton label={label} tooltip={tooltip} manual={manual} />;
}

/**
 * Premium dashboard help button: a compact glass icon that expands into a
 * "<Page> guide" pill on hover/focus and opens a small guide menu on click (or
 * starts the full tour directly when no extra options apply). The expansion is
 * purely visual — the button is fixed-position, so nothing on the page shifts —
 * and a restrained breathing accent runs only until the page's first-time guide
 * has been completed. All decorative motion is disabled under
 * `prefers-reduced-motion` via the stylesheet. Reused on every authenticated
 * dashboard route; only the label/tooltip and available menu options change.
 */
function DashboardHelpButton({ label, tooltip, manual }: { label: string; tooltip: string; manual: ManualConfig }) {
  const { openManualStage, isStageComplete } = useManual();
  const hasQuickStart = Boolean(manual.helpQuickStart);
  const quickStartStage = manual.quickStartStage ?? "starter";
  const fullTourStage = manual.fullTourStage ?? "full";
  const [menuOpen, setMenuOpen] = useState(false);
  const [changedStage, setChangedStage] = useState<string | null>(null);
  // Read completion only after mount so SSR and the first client render agree
  // (localStorage is unavailable on the server). The button remounts whenever a
  // tour closes, so this re-reads after the first-time guide is finished.
  const [primaryComplete, setPrimaryComplete] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const primaryStage = hasQuickStart ? quickStartStage : manual.resolveStage ? manual.resolveStage() : null;
    setPrimaryComplete(isStageComplete(primaryStage));
  }, [hasQuickStart, isStageComplete, manual, quickStartStage]);

  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  // Read the "what changed" marker a page may publish so the menu can offer a
  // replay of the newly relevant contextual guide when present.
  const readChangedStage = useCallback(() => {
    const marker =
      typeof document === "undefined" ? "" : document.documentElement.dataset.tourChangedStage ?? "";
    return marker ? marker : null;
  }, []);

  // Clicking the button always opens the guide menu (Quick start / Full page
  // tour / What changed) — it never immediately starts a tour, so the
  // experience is identical on every dashboard.
  const handleTrigger = useCallback(() => {
    if (menuOpen) {
      closeMenu(false);
      return;
    }
    setChangedStage(readChangedStage());
    setMenuOpen(true);
  }, [closeMenu, menuOpen, readChangedStage]);

  // Close the menu on Escape or an outside pointer press while it is open.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        closeMenu(false);
      }
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("pointerdown", onPointerDown, { capture: true });

    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [menuOpen, closeMenu]);

  const startStage = useCallback(
    (stage: string) => {
      closeMenu(false);
      openManualStage(stage);
    },
    [closeMenu, openManualStage]
  );

  return (
    <div className={styles.overviewHelpRoot}>
      {menuOpen ? (
        <div
          ref={menuRef}
          className={styles.overviewMenu}
          role="menu"
          aria-label={`${tooltip} options`}
          data-tour-help-menu="true"
        >
          <p className={styles.overviewMenuTitle}>{tooltip}</p>
          {hasQuickStart ? (
            <button
              className={styles.overviewMenuItem}
              type="button"
              role="menuitem"
              onClick={() => startStage(quickStartStage)}
            >
              <GraduationCap aria-hidden="true" />
              <span>
                <strong>Quick start</strong>
                <small>Replay the first-time walkthrough</small>
              </span>
            </button>
          ) : null}
          <button
            className={styles.overviewMenuItem}
            type="button"
            role="menuitem"
            onClick={() => startStage(fullTourStage)}
          >
            <Compass aria-hidden="true" />
            <span>
              <strong>Full page tour</strong>
              <small>Walk every visible section and control</small>
            </span>
          </button>
          {changedStage ? (
            <button
              className={styles.overviewMenuItem}
              type="button"
              role="menuitem"
              onClick={() => startStage(changedStage)}
            >
              <Sparkles aria-hidden="true" />
              <span>
                <strong>What changed</strong>
                <small>See the newly relevant sections</small>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        ref={triggerRef}
        className={`${styles.overviewHelpButton}${
          primaryComplete ? "" : ` ${styles.overviewHelpButtonAttention}`
        }`}
        type="button"
        onClick={handleTrigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-manual-help-button="true"
        data-open={menuOpen ? "true" : "false"}
      >
        <span className={styles.overviewHelpIcon}>
          <CircleHelp aria-hidden="true" />
        </span>
        <span className={styles.overviewHelpLabel}>{tooltip}</span>
      </button>
    </div>
  );
}
