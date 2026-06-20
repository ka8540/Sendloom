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
  /** When false, the provider never auto-opens this manual (a host page drives it). */
  autoOpen?: boolean;
  /** Appended to the completion storage key so the manual can be re-versioned. */
  version?: string;
  /** Resolve the current stage id from page state (e.g. reading the DOM). */
  resolveStage?: () => string | null;
  /** Return the steps for a stage. Falls back to `steps` when omitted. */
  resolveSteps?: (stage: string | null) => ManualStep[];
};
