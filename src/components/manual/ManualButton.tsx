"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp, Compass, GraduationCap, Sparkles } from "lucide-react";

import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

export function ManualButton() {
  const { isOpen, manual, openManual } = useManual();

  if (!manual || isOpen) {
    return null;
  }

  const label = manual.helpLabel ?? "Help";
  const tooltip = manual.helpTooltip ?? "Help";

  if (manual.helpVariant === "overview") {
    return <OverviewHelpButton label={label} tooltip={tooltip} />;
  }

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

/**
 * Premium Overview-only variant: a compact glass icon button that expands into a
 * "Overview guide" pill on hover/focus and opens a small guide menu on click.
 * The expansion is purely visual (the button is fixed-position, so nothing on
 * the page shifts), and a restrained breathing accent runs only until the
 * beginner guide has been completed. All decorative motion is disabled under
 * `prefers-reduced-motion` via the stylesheet.
 */
function OverviewHelpButton({ label, tooltip }: { label: string; tooltip: string }) {
  const { openManual, openManualStage, isStageComplete } = useManual();
  const [menuOpen, setMenuOpen] = useState(false);
  const [changedStage, setChangedStage] = useState<string | null>(null);
  // Read completion only after mount so SSR and the first client render agree
  // (localStorage is unavailable on the server). The button remounts whenever a
  // tour closes, so this re-reads after the beginner guide is finished.
  const [beginnerComplete, setBeginnerComplete] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBeginnerComplete(isStageComplete("starter"));
  }, [isStageComplete]);

  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((open) => {
      if (open) {
        return false;
      }
      // Read the "what changed" marker the Overview page publishes so the menu
      // can offer a replay of the newly relevant contextual guide when present.
      const marker =
        typeof document === "undefined" ? "" : document.documentElement.dataset.overviewChangedStage ?? "";
      setChangedStage(marker ? marker : null);
      return true;
    });
  }, []);

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
    (stage: string | null) => {
      closeMenu(false);
      if (stage) {
        openManualStage(stage);
      } else {
        openManual();
      }
    },
    [closeMenu, openManual, openManualStage]
  );

  return (
    <div className={styles.overviewHelpRoot}>
      {menuOpen ? (
        <div
          ref={menuRef}
          className={styles.overviewMenu}
          role="menu"
          aria-label="Overview guide options"
          data-overview-help-menu="true"
        >
          <p className={styles.overviewMenuTitle}>Overview guide</p>
          <button
            className={styles.overviewMenuItem}
            type="button"
            role="menuitem"
            onClick={() => startStage(null)}
          >
            <Compass aria-hidden="true" />
            <span>
              <strong>Start full tour</strong>
              <small>Walk every visible card and control</small>
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
                <strong>Learn what changed</strong>
                <small>See the newly relevant sections</small>
              </span>
            </button>
          ) : null}
          <button
            className={styles.overviewMenuItem}
            type="button"
            role="menuitem"
            onClick={() => startStage("starter")}
          >
            <GraduationCap aria-hidden="true" />
            <span>
              <strong>Restart beginner tips</strong>
              <small>Replay the new-user walkthrough</small>
            </span>
          </button>
        </div>
      ) : null}

      <button
        ref={triggerRef}
        className={`${styles.overviewHelpButton}${
          beginnerComplete ? "" : ` ${styles.overviewHelpButtonAttention}`
        }`}
        type="button"
        onClick={toggleMenu}
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
