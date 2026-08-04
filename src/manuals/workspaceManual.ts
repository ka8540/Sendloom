import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

// The authenticated Overview dashboard (/workspace) uses the shared floating
// Help button + overlay. Its guide is state-aware: a brand-new workspace is
// onboarded with a focused beginner tour, and short one-time contextual tours
// introduce newly relevant cards as imports, templates, sequences, activity and
// attention items appear. A manual Help click always replays the complete guide
// for whatever is currently rendered.
//
// Every step targets a stable `data-overview-tour="..."` attribute (or, for the
// untouched app sidebar, an existing semantic selector). State-dependent steps
// are marked `optional` so the shared overlay drops them when their target is
// absent — the tour never points at an empty or missing component.

// ---------------------------------------------------------------------------
// Targets + state
// ---------------------------------------------------------------------------

export function overviewSelector(target: string): string {
  return `[data-overview-tour="${target}"]`;
}

const sel = overviewSelector;

// The app sidebar must not be modified, so its tour step reuses the existing
// semantic navigation landmark rather than adding an attribute to that file.
const SIDEBAR_SELECTOR = "nav[aria-label='Main navigation']";

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
// Reusable step builders (one per Overview surface)
// ---------------------------------------------------------------------------

function sidebarStep(): ManualStep {
  return {
    id: "sidebar",
    title: "Move through your workspace",
    body: "Use the sidebar to discover contacts, import people, create templates, build sequences, and return here to monitor everything in one place.",
    selector: SIDEBAR_SELECTOR,
    placement: "right",
    optional: true
  };
}

function workspaceHealthStep(): ManualStep {
  return {
    id: "workspace-health",
    title: "Your workspace at a glance",
    body: "This summary strip shows the current state of your workspace — active sequences, recent send volume, anything that needs attention, and lists ready to launch. Empty or zero values are normal until you create your first list, template, or sequence.",
    selector: sel("workspace-health"),
    placement: "bottom"
  };
}

function activeSequencesStep(): ManualStep {
  return {
    id: "active-sequences",
    title: "Active sequences",
    body: "Shows how many sequences are currently running or queued, so you can tell live sending apart from everything else. Opening the section takes you to the full Sequences page.",
    selector: sel("active-sequences"),
    placement: "bottom"
  };
}

function listsReadyStep(): ManualStep {
  return {
    id: "lists-ready",
    title: "Lists ready",
    body: "Shows how many processed imports already have a field mapping and are ready to use in a sequence. Opening the section takes you to Imports — this figure is a summary, not the editor.",
    selector: sel("lists-ready"),
    placement: "bottom"
  };
}

function quickActionsStep(): ManualStep {
  return {
    id: "quick-actions",
    title: "Start something new",
    body: "Quick actions are shortcuts to the three main workflows: create a sequence, import a list, or create a template. Each opens the matching workspace page.",
    selector: sel("quick-actions"),
    placement: "bottom"
  };
}

function gmailSendWindowStep(): ManualStep {
  return {
    id: "gmail-send-window",
    title: "Gmail sending capacity",
    body: "Shows how much sending capacity has been used in the rolling 24-hour safety window for your connected Gmail senders, plus the remaining capacity and when it resets. Sendloom uses this to pace outreach and reduce provider throttling.",
    selector: sel("gmail-send-window"),
    placement: "bottom"
  };
}

function gmailProgressStep(): ManualStep {
  return {
    id: "gmail-progress",
    title: "Capacity used and remaining",
    body: "The progress bar fills as sends are recorded in the rolling window. The figures beside it show how much capacity remains and when the earliest counted sends age out, easing the window back open.",
    selector: sel("gmail-progress"),
    placement: "bottom",
    optional: true
  };
}

function senderBreakdownStep(): ManualStep {
  return {
    id: "sender-breakdown",
    title: "Connected senders",
    body: "Summarizes the Gmail sender behind this window. When more than one sender is connected, the badge shows how many additional senders share your workspace capacity.",
    selector: sel("sender-breakdown"),
    placement: "top",
    optional: true
  };
}

function recentSequencesStep(): ManualStep {
  return {
    id: "recent-sequences",
    title: "Track recently changed sequences",
    body: "Recent Sequences previews the three workflows that changed most recently. Use the search field to find a sequence by name, list, template, or sender, or open View all sequences for the complete list.",
    selector: sel("recent-sequences"),
    placement: "top"
  };
}

function recentSequenceCardStep(): ManualStep {
  return {
    id: "recent-sequence-card",
    title: "Read a sequence at a glance",
    body: "Each row shows the sequence name, its list, template, and sender, the current status, and the last update time. The action buttons let you view, pause, resume, relaunch, or delete the sequence. Open the row for full recipient and delivery details.",
    selector: sel("recent-sequence-card"),
    placement: "top",
    optional: true
  };
}

function viewAllSequencesStep(): ManualStep {
  return {
    id: "view-all-sequences",
    title: "Open all sequences",
    body: "Use this action when you need to search, filter, edit, relaunch, or inspect sequences beyond the recent items shown here. It opens the full Sequences page.",
    selector: sel("view-all-sequences"),
    placement: "bottom"
  };
}

function liveSystemStep(): ManualStep {
  return {
    id: "live-system",
    title: "Watch workspace activity",
    body: "This section shows recent workspace events — imports, template updates, sequence launches, and sending progress — as they occur, so you can confirm changes were saved and follow what the workspace is doing.",
    selector: sel("live-system"),
    placement: "left"
  };
}

function activityRowStep(): ManualStep {
  return {
    id: "activity-row",
    title: "Read an activity entry",
    body: "Each entry pairs an icon and tone with a short description and a timestamp. Failures and attention events stand out so issues are easy to spot. Select an entry to open the related sequence, import, or template.",
    selector: sel("activity-row"),
    placement: "left",
    optional: true
  };
}

function needsAttentionStep(): ManualStep {
  return {
    id: "needs-attention",
    title: "Items that need attention",
    body: "This highlights Gmail authorization, retryable delivery, queue, server, configuration, paused, or other review-required problems. Retryable failures may be attempted again; action-required problems may need your review, and not every retry will succeed. Permanent invalid addresses, unsubscribed, and suppressed recipients are safely skipped instead. When it reads zero, nothing currently needs your review.",
    selector: sel("needs-attention"),
    placement: "bottom"
  };
}

// ---------------------------------------------------------------------------
// Preserved original Overview steps (must remain intact — extended, not replaced)
// ---------------------------------------------------------------------------

/**
 * The three original Workspace overview steps, unchanged. Every state-aware
 * guide and the full manual tour build on top of these rather than replacing
 * them, so existing explanations are never lost.
 */
export const preservedOverviewSteps: ManualStep[] = [
  {
    id: "command-center",
    title: "Command center",
    body: "Use this page as the live operating surface. It rolls up active sequences, recent send volume, validation posture, and anything that needs attention.",
    selector: "main.content > div:not(.content-toolbar)",
    placement: "right"
  },
  {
    id: "metrics",
    title: "Read the operating signals",
    body: "The top metrics show whether the workspace is moving: active workflows, usable lists, and template inventory. Treat them as quick health checks before launching more sends.",
    selector:
      "main.content a[href='/campaigns']:not(.button), main.content a[href='/imports']:not(.button), main.content a[href='/templates']:not(.button)",
    placement: "bottom"
  },
  {
    id: "sequence-entry",
    title: "Jump into live work",
    body: "Recent sequence rows are entry points into the campaigns that changed most recently. Open one to review setup, delivery state, replies, and controls.",
    selector: "main.content a[href^='/sequences/'], main.content a[href='/campaigns']",
    placement: "top"
  }
];

// ---------------------------------------------------------------------------
// Stage step builders
// ---------------------------------------------------------------------------

/**
 * Phase 1 — brand-new, empty workspace. A focused beginner walk-through of the
 * page, navigation, summary cards, and the empty Recent Sequences / Live System
 * sections, ending on a "what to do next" prompt.
 */
export function overviewStarterSteps(): ManualStep[] {
  return [
    {
      id: "page-intro",
      title: "Welcome to your Sendloom Overview",
      body: "This page gives you a live summary of your outreach workspace. As you create lists, templates, and sequences, the cards and activity sections here update automatically.",
      selector: sel("page-intro"),
      placement: "bottom"
    },
    sidebarStep(),
    workspaceHealthStep(),
    activeSequencesStep(),
    listsReadyStep(),
    quickActionsStep(),
    gmailSendWindowStep(),
    {
      id: "recent-sequences",
      title: "Your recent sequences will appear here",
      body: "After you create or launch a sequence, this section gives you a quick view of its status and progress. Open a sequence when you need full recipient and delivery details.",
      selector: sel("recent-sequences"),
      placement: "top"
    },
    {
      id: "live-system",
      title: "Watch workspace activity",
      body: "This section shows recent workspace events such as imports, template updates, sequence activity, and sending progress as they occur.",
      selector: sel("live-system"),
      placement: "left"
    },
    {
      id: "build-first-workflow",
      title: "Build your first workflow",
      body: "Start by preparing a contact list, creating a template, and building a sequence. Return to Overview to monitor its progress.",
      placement: "center"
    }
  ];
}

/**
 * Phase 2 — first imports or templates exist, but no sequences yet. A short
 * contextual note on the newly meaningful Lists and Templates cards and the
 * activity they produced. Not a replay of the beginner tour.
 */
export function overviewFoundationsSteps(): ManualStep[] {
  return [
    {
      id: "lists-ready",
      title: "Your lists are taking shape",
      body: "The Lists ready count reflects processed imports that already have a field mapping and can launch. Opening the section takes you to Imports — this figure is a summary, not the full editor.",
      selector: sel("lists-ready"),
      placement: "bottom"
    },
    {
      id: "quick-actions",
      title: "Templates and sequences start here",
      body: "Use Quick actions to create a template or build a sequence from the lists you imported. Each shortcut opens the matching workspace page.",
      selector: sel("quick-actions"),
      placement: "bottom"
    },
    {
      id: "live-system",
      title: "Changes show up in activity",
      body: "New imports and templates appear in Recent Activity so you can quickly confirm that workspace changes were saved.",
      selector: sel("live-system"),
      placement: "left"
    }
  ];
}

/**
 * Phase 3 — the first sequence now exists and is visible on Overview. Explains
 * how it is tracked across Active Sequences, Sequence health, the Recent
 * Sequences card, Live System, and the Gmail send window.
 */
export function overviewFirstSequenceSteps(): ManualStep[] {
  return [
    {
      id: "active-sequences",
      title: "Your sequence is now tracked here",
      body: "The main number shows sequences that are currently running or queued. The status badge on each recent sequence row explains paused, ready, completed, or review states.",
      selector: sel("active-sequences"),
      placement: "bottom"
    },
    recentSequencesStep(),
    recentSequenceCardStep(),
    viewAllSequencesStep(),
    {
      id: "live-system",
      title: "Follow sequence activity",
      body: "Launches, sends, status changes, retries, and related sequence events appear here so you can understand what the workspace is doing.",
      selector: sel("live-system"),
      placement: "left"
    },
    {
      id: "gmail-send-window",
      title: "Sending updates the capacity window",
      body: "Launching a sequence may update the send-window usage gradually as messages go out — not all recipients send at once. Watch the remaining capacity here as sending progresses.",
      selector: sel("gmail-send-window"),
      placement: "bottom"
    }
  ];
}

/**
 * Phase 4 — attention-related data has appeared (operational failures,
 * paused work, or Gmail capacity pressure). Explains the attention surfaces and
 * what retryable versus action-required means, without overpromising.
 */
export function overviewAttentionSteps(): ManualStep[] {
  return [
    needsAttentionStep(),
    {
      id: "gmail-send-window",
      title: "Gmail safety status",
      body: "When the send window is near capacity, Sendloom may delay queued sends until capacity becomes available. The queue stays attached to the sequence and continues when the sending window allows it.",
      selector: sel("gmail-send-window"),
      placement: "bottom",
      optional: true
    },
    {
      id: "view-all-sequences",
      title: "Open sequences to resolve issues",
      body: "This opens the full Sequences page, where you can review a flagged sequence, retry or fix recipients, and relaunch. It navigates there — it does not change anything on its own.",
      selector: sel("view-all-sequences"),
      placement: "bottom"
    }
  ];
}

/**
 * The complete manual tour for a Help click — the preserved original steps
 * followed by every detailed Overview step, grouped from navigation through to
 * attention. Optional steps are dropped by the overlay when their target is not
 * currently rendered, so this single list adapts to whatever Overview shows.
 */
export function overviewFullSteps(): ManualStep[] {
  return [
    ...preservedOverviewSteps,
    // Workspace navigation
    sidebarStep(),
    // Core workspace summary
    workspaceHealthStep(),
    activeSequencesStep(),
    // Imports and quick actions
    listsReadyStep(),
    quickActionsStep(),
    // Gmail sending capacity
    gmailSendWindowStep(),
    gmailProgressStep(),
    senderBreakdownStep(),
    // Recent sequences
    recentSequencesStep(),
    recentSequenceCardStep(),
    viewAllSequencesStep(),
    // Recent activity
    liveSystemStep(),
    activityRowStep(),
    // Attention and recovery
    needsAttentionStep()
  ];
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
  // default "center", so highlighting an in-hero visual like Sequence health
  // never re-centres the page into a stretched-looking reframe.
  scrollBlock: "nearest",
  // The Overview page drives the progressive auto-open phases itself (so it can
  // wait for data + a settled layout), so the generic provider auto-open is off.
  autoOpen: false,
  version: "v4",
  steps: overviewFullSteps(),
  // A manual Help click always resolves to the complete current-state tour.
  resolveStage: () => "full",
  resolveSteps: (stage) => overviewStepsForStage(stage)
};
