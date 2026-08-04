import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

// The authenticated Overview dashboard (/workspace) uses the shared floating
// Help button + overlay. The guide is a short, six-step walk-through of the
// redesigned page: the summary strip, quick actions, the recent-sequence search
// and row actions, the Gmail send window, and recent activity. It is
// state-aware only in that a brand-new workspace and a working one get the same
// steps filtered down to whatever is actually on screen.
//
// Every step targets a stable `data-overview-tour="..."` attribute. Steps whose
// component only exists once there is data are marked `optional`, so the shared
// overlay drops them rather than pointing at a missing element.

// ---------------------------------------------------------------------------
// Targets + state
// ---------------------------------------------------------------------------

export function overviewSelector(target: string): string {
  return `[data-overview-tour="${target}"]`;
}

const sel = overviewSelector;

/** Auto-opening progressive onboarding phases, in priority order. */
export type OverviewAutoStage = "starter" | "foundations" | "first-sequence" | "attention";

/** Every stage the manual can resolve (auto phases + the manual full tour). */
export type OverviewStage = OverviewAutoStage | "full";

/**
 * Snapshot of the currently rendered Overview, derived from data already loaded
 * for the dashboard (no extra backend work). Drives which contextual phase, if
 * any, is eligible to auto-open.
 */
export type OverviewTourState = {
  hasImports: boolean;
  hasTemplates: boolean;
  hasSequences: boolean;
  hasActiveSequences: boolean;
  hasRecentSequences: boolean;
  hasActivity: boolean;
  hasAttentionItems: boolean;
  hasGmailSenders: boolean;
  hasMultipleSequencePages: boolean;
};

/**
 * Eligible auto-open phases for the given state, in priority order. The host
 * page opens the first one the user has not already completed, so several newly
 * eligible phases never stack up in a single visit. starter and foundations are
 * mutually exclusive with the sequence/attention phases by definition (they
 * require an empty / sequence-free workspace), so the resulting order is always
 * starter → first-sequence → attention → foundations.
 */
export function getEligibleOverviewStages(state: OverviewTourState): OverviewAutoStage[] {
  const stages: OverviewAutoStage[] = [];
  const emptyWorkspace = !state.hasImports && !state.hasTemplates && !state.hasSequences;

  if (emptyWorkspace) {
    stages.push("starter");
  }
  if (state.hasSequences || state.hasRecentSequences) {
    stages.push("first-sequence");
  }
  if (state.hasAttentionItems) {
    stages.push("attention");
  }
  if ((state.hasImports || state.hasTemplates) && !state.hasSequences) {
    stages.push("foundations");
  }

  return stages;
}

/**
 * The most relevant contextual phase to offer as "Learn what changed" once the
 * brand-new tour is behind the user — i.e. the highest-priority eligible phase
 * that is not the empty-workspace starter. Null when nothing new is relevant.
 */
export function resolveOverviewChangedStage(state: OverviewTourState): Exclude<OverviewAutoStage, "starter"> | null {
  const contextual = getEligibleOverviewStages(state).filter(
    (stage): stage is Exclude<OverviewAutoStage, "starter"> => stage !== "starter"
  );
  return contextual[0] ?? null;
}

// ---------------------------------------------------------------------------
// The six Overview steps
// ---------------------------------------------------------------------------
//
// Each one describes a component that exists on the redesigned page, and the
// copy stays with what is literally visible on screen — no wording carried over
// from the charts, roll-ups and log framing the redesign removed.

function summaryStep(): ManualStep {
  return {
    id: "summary",
    title: "Overview at a glance",
    body: "See how many sequences are active, how many emails were sent in the last 24 hours, what needs attention, and how many lists are ready to launch.",
    selector: sel("summary"),
    placement: "bottom"
  };
}

function quickActionsStep(): ManualStep {
  return {
    id: "quick-actions",
    title: "Start something quickly",
    body: "Create a sequence, import a contact list, or create a template without leaving the Overview page.",
    selector: sel("quick-actions"),
    placement: "bottom"
  };
}

// Targets the Recent sequences section as a whole — heading, search controls
// and rows highlighted as one logical unit — rather than any single control.
function recentSequencesStep(): ManualStep {
  return {
    id: "recent-sequences",
    title: "Continue recent work",
    body: "Open one of your recent sequences to review its setup, status, sender, template, and available actions.",
    selector: sel("recent-sequences"),
    placement: "top"
  };
}

function sequenceActionsStep(): ManualStep {
  return {
    id: "sequence-actions",
    title: "Manage a sequence",
    body: "Use these controls to view, pause, resume or relaunch, delete, or open a sequence. Available actions depend on the sequence status.",
    selector: sel("sequence-actions"),
    placement: "top",
    optional: true
  };
}

function sendWindowStep(): ManualStep {
  return {
    id: "gmail-send-window",
    title: "Check your sending capacity",
    body: "See how many emails were sent in the rolling 24-hour window, how many remain, and when capacity resets for the connected Gmail sender.",
    selector: sel("gmail-send-window"),
    placement: "left"
  };
}

function recentActivityStep(): ManualStep {
  return {
    id: "recent-activity",
    title: "See what changed recently",
    body: "Review the latest sequence updates, imports, Discover searches, and other recent work. The Overview shows only the newest activity items.",
    selector: sel("recent-activity"),
    placement: "left"
  };
}

// ---------------------------------------------------------------------------
// Stage step builders
// ---------------------------------------------------------------------------
//
// Every stage is a subset of the same six steps, so no phase can ever describe a
// component the redesigned Overview does not render.

/**
 * The complete Overview guide, in reading order: the summary strip, then the
 * left column top-to-bottom, then the right column top-to-bottom.
 */
export function overviewFullSteps(): ManualStep[] {
  return [
    summaryStep(),
    quickActionsStep(),
    recentSequencesStep(),
    sequenceActionsStep(),
    sendWindowStep(),
    recentActivityStep()
  ];
}

/**
 * Phase 1 — brand-new, empty workspace. The same short guide; the optional
 * sequence-action step drops out automatically while there are no rows.
 */
export function overviewStarterSteps(): ManualStep[] {
  return overviewFullSteps();
}

/**
 * Phase 2 — first imports or templates exist, but no sequences yet. Points at
 * what is now meaningful without replaying the whole guide.
 */
export function overviewFoundationsSteps(): ManualStep[] {
  return [summaryStep(), quickActionsStep(), recentActivityStep()];
}

/**
 * Phase 3 — the first sequence now exists and is visible on Overview.
 */
export function overviewFirstSequenceSteps(): ManualStep[] {
  return [summaryStep(), recentSequencesStep(), sequenceActionsStep(), sendWindowStep()];
}

/**
 * Phase 4 — something needs review, or Gmail capacity is under pressure.
 */
export function overviewAttentionSteps(): ManualStep[] {
  return [summaryStep(), sequenceActionsStep(), sendWindowStep()];
}

export function overviewStepsForStage(stage: string | null): ManualStep[] {
  switch (stage) {
    case "starter":
      return overviewStarterSteps();
    case "foundations":
      return overviewFoundationsSteps();
    case "first-sequence":
      return overviewFirstSequenceSteps();
    case "attention":
      return overviewAttentionSteps();
    case "full":
    default:
      return overviewFullSteps();
  }
}

// ---------------------------------------------------------------------------
// Manual config
// ---------------------------------------------------------------------------

export const workspaceManual: ManualConfig = {
  id: "workspace",
  routeLabel: "Overview",
  helpLabel: "Help with Overview",
  helpTooltip: "Overview guide",
  helpVariant: "premium",
  helpQuickStart: true,
  // Reveal targets with the minimum scroll (block: "nearest") instead of the
  // default "center", so highlighting a card never re-centres the page into a
  // stretched-looking reframe.
  scrollBlock: "nearest",
  // The Overview page drives the progressive auto-open phases itself (so it can
  // wait for data + a settled layout), so the generic provider auto-open is off.
  autoOpen: false,
  version: "v6",
  // Overview's guide ends on "Done"; every other guide keeps "Finish".
  finishLabel: "Done",
  // v6: the summary copy and the section-level Recent sequences step replaced
  // the earlier wording, so anyone who completed v5 is offered the new guide.
  steps: overviewFullSteps(),
  // A manual Help click always resolves to the complete current-state tour.
  resolveStage: () => "full",
  resolveSteps: (stage) => overviewStepsForStage(stage)
};
