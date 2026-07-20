"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  CircleHelp,
  Compass,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon
} from "lucide-react";

import { HelpReportDialog } from "@/components/incident/help-report-dialog";
import type { ManualConfig, ManualHelpMenuIcon } from "@/components/manual/manualTypes";
import { useManual } from "@/components/manual/ManualProvider";
import styles from "@/components/manual/manual.module.css";

// Stable machine context for where a manual report was opened, so admin triage
// can tell which dashboard's help menu produced it. Admin sub-pages share one
// context; the captured pathname distinguishes them.
const GUIDE_CONTEXT_BY_ID: Record<string, string> = {
  workspace: "overview_guide_menu",
  "discover-list": "discover_guide_menu",
  "discover-detail": "discover_guide_menu",
  finder: "finder_guide_menu",
  imports: "imports_guide_menu",
  templates: "templates_guide_menu",
  campaigns: "sequences_guide_menu",
  "campaign-detail": "sequence_detail_guide_menu",
  admin: "admin_guide_menu"
};

const HELP_MENU_ICONS: Record<ManualHelpMenuIcon, LucideIcon> = {
  overview: LayoutDashboard,
  controls: SlidersHorizontal,
  stats: BarChart3,
  activity: Activity,
  setup: Settings2,
  help: MessageSquare
};

function guideContextForManual(manual: ManualConfig): string {
  return GUIDE_CONTEXT_BY_ID[manual.id] ?? `${manual.id.replace(/-/g, "_")}_guide_menu`;
}

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
  const customHelpItems = manual.helpMenuItems ?? [];
  const hasCustomHelpMenu = customHelpItems.length > 0;
  const customInfoItems = customHelpItems.filter((item) => item.action !== "report");
  const customReportItem = customHelpItems.find((item) => item.action === "report");
  const CustomReportIcon = customReportItem ? HELP_MENU_ICONS[customReportItem.icon] : MessageSquare;
  // Manuals whose "page" changes by internal state rather than the URL (the
  // Templates library vs. its create/edit wizard steps) opt into `contextualStages`
  // so the menu's guide actions target whatever surface is on screen. The stage is
  // read from the live DOM as the menu renders; every other manual keeps its fixed
  // quick/full stages untouched.
  const resolveContextStage = (fallbackStage: string) =>
    manual.contextualStages && manual.resolveStage ? manual.resolveStage() ?? fallbackStage : fallbackStage;
  const quickStartStage = resolveContextStage(manual.quickStartStage ?? "starter");
  const fullTourStage = resolveContextStage(manual.fullTourStage ?? "full");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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

  const openReport = useCallback(() => {
    closeMenu(false);
    setReportOpen(true);
  }, [closeMenu]);

  const closeReport = useCallback(() => {
    setReportOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <div className={styles.overviewHelpRoot}>
      {menuOpen ? (
        <div
          ref={menuRef}
          className={styles.overviewMenu}
          role={hasCustomHelpMenu ? "dialog" : "menu"}
          aria-label={hasCustomHelpMenu ? tooltip : `${tooltip} options`}
          data-tour-help-menu="true"
        >
          <p className={styles.overviewMenuTitle}>{tooltip}</p>
          {hasCustomHelpMenu ? (
            <>
              {customInfoItems.map((item) => {
                const Icon = HELP_MENU_ICONS[item.icon];

                return (
                  <div className={`${styles.overviewMenuItem} ${styles.overviewMenuInfo}`} key={item.title}>
                    <Icon aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                  </div>
                );
              })}
              {customReportItem ? (
                <>
                  <div className={styles.overviewMenuDivider} role="separator" aria-hidden="true" />
                  <button
                    className={styles.overviewMenuItem}
                    type="button"
                    onClick={openReport}
                    data-tour-report-issue="true"
                  >
                    <CustomReportIcon aria-hidden="true" />
                    <span>
                      <strong>{customReportItem.title}</strong>
                      <small>{customReportItem.description}</small>
                    </span>
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <>
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
              <div className={styles.overviewMenuDivider} role="separator" aria-hidden="true" />
              <button
                className={styles.overviewMenuItem}
                type="button"
                role="menuitem"
                onClick={openReport}
                data-tour-report-issue="true"
              >
                <MessageSquare aria-hidden="true" />
                <span>
                  <strong>Report issue</strong>
                  <small>Tell us what went wrong on this page</small>
                </span>
              </button>
            </>
          )}
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
        aria-haspopup={hasCustomHelpMenu ? "dialog" : "menu"}
        aria-expanded={menuOpen}
        data-manual-help-button="true"
        data-open={menuOpen ? "true" : "false"}
      >
        <span className={styles.overviewHelpIcon}>
          <CircleHelp aria-hidden="true" />
        </span>
        <span className={styles.overviewHelpLabel}>{tooltip}</span>
      </button>

      <HelpReportDialog
        open={reportOpen}
        onClose={closeReport}
        pageLabel={manual.routeLabel}
        guideContext={guideContextForManual(manual)}
      />
    </div>
  );
}
