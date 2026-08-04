export type ManualPlacement = "top" | "right" | "bottom" | "left" | "center";

export type ManualStep = {
  id: string;
  title: string;
  body: string;
  selector?: string;
  placement?: ManualPlacement;
  /**
   * When true, the step is skipped if its target is not present/visible (used for
   * controls that only exist in some states). Steps without `optional` still
   * render — centered — when their target is missing, matching the default
   * manual behavior, so existing manuals are unaffected.
   */
  optional?: boolean;
};

export type ManualConfig = {
  id: string;
  routeLabel: string;
  steps: ManualStep[];
  /**
   * Optional state-aware extensions. All default to the existing single-stage,
   * static-steps, auto-open-once behavior so other route manuals are unchanged.
   */
  /** Accessible label for the floating help button (default "Help"). */
  helpLabel?: string;
  /** Tooltip text for the floating help button (default "Help"). */
  helpTooltip?: string;
  /**
   * Optional presentation override for the floating help button. Every
   * dashboard manual now uses the premium hover-expanding pill + guide menu by
   * default; set "simple" only to fall back to the plain circular control.
   * ("overview" is kept as a back-compat alias for the premium button.)
   */
  helpVariant?: "premium" | "overview" | "simple";
  /**
   * When true, the page provides a short first-time "quick start" guide, so the
   * help menu offers a "Quick start" entry and the button breathes until that
   * guide is completed/dismissed.
   */
  helpQuickStart?: boolean;
  /** Optional page-specific description beneath the shared Quick start action. */
  helpQuickStartDescription?: string;
  /** Stage the menu's "Quick start" opens (default "starter"). */
  quickStartStage?: string;
  /** Stage the menu's "Full page tour" opens (default "full"). */
  fullTourStage?: string;
  /**
   * `scrollIntoView` block alignment used when revealing a target. Defaults to
   * "center" (the original behavior) for every existing manual. The Overview
   * guide uses "nearest" so revealing a target inside the tall hero/analytics
   * card never yanks the page into a jarring, stretched-looking reframe.
   */
  scrollBlock?: ScrollLogicalPosition;
  /** When false, the provider never auto-opens this manual (a host page drives it). */
  autoOpen?: boolean;
  /**
   * When true, the guide-menu actions resolve their stage from `resolveStage()`
   * at click time instead of opening the fixed quick/full stages. Used by
   * same-route flows whose "page" changes by internal state, not the URL (the
   * Templates library vs. its create/edit wizard steps), so a single registered
   * manual can present context-specific guides. Other manuals omit this and keep
   * opening their static stages unchanged.
   */
  contextualStages?: boolean;
  /** Appended to the completion storage key so the manual can be re-versioned. */
  version?: string;
  /**
   * Label for the final step's confirm button. Defaults to "Finish", which every
   * existing guide keeps; the Overview guide opts into "Done".
   */
  finishLabel?: string;
  /** Resolve the current stage id from page state (e.g. reading the DOM). */
  resolveStage?: () => string | null;
  /** Return the steps for a stage. Falls back to `steps` when omitted. */
  resolveSteps?: (stage: string | null) => ManualStep[];
};
