import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

// The Analysis workspace guide (/analysis and its five page tabs). It is a
// short, six-step walk-through: one introduction to the workspace (including
// what the date selector and Export do), then one step per Analysis page —
// Summary, Engagement, Sequences, Reliability, Senders. Individual charts are
// deliberately not explained: every chart already carries its own information
// tooltip, so the tour only covers what each page is for and when to use it.
//
// Every step targets a stable `data-tour="analysis-..."` attribute on the
// header or a tab link, so the tour never navigates between Analysis routes —
// it highlights each visible tab in place on the current page.

export function analysisSelector(target: string): string {
  return `[data-tour="${target}"]`;
}

const sel = analysisSelector;

function introductionStep(): ManualStep {
  return {
    id: "analysis-introduction",
    title: "Understand your outreach",
    body: "Analysis brings together outreach performance, engagement, sequence results, sending reliability, and Gmail sender health. Use the date selector to view the last 7 or 30 days, and use Export to download data from the current Analysis page.",
    selector: sel("analysis-header"),
    placement: "bottom"
  };
}

function summaryStep(): ManualStep {
  return {
    id: "analysis-summary",
    title: "Start with Summary",
    body: "Summary gives you a quick view of overall outreach performance, including confirmed sends, opens, replies, issues requiring attention, activity over time, and major outcome changes.",
    selector: sel("analysis-tab-summary"),
    placement: "bottom"
  };
}

function engagementStep(): ManualStep {
  return {
    id: "analysis-engagement",
    title: "Review Engagement",
    body: "Engagement shows how recipients interact with your outreach. Use it to review opens, unopened messages, replies, engagement trends, send windows, and performance by schedule type.",
    selector: sel("analysis-tab-engagement"),
    placement: "bottom"
  };
}

function sequencesStep(): ManualStep {
  return {
    id: "analysis-sequences",
    title: "Compare Sequences",
    body: "Sequences helps you compare outreach runs and templates. Use it to identify strong reply rates, understand the relationship between send volume and replies, and find sequences that need review.",
    selector: sel("analysis-tab-sequences"),
    placement: "bottom"
  };
}

function reliabilityStep(): ManualStep {
  return {
    id: "analysis-reliability",
    title: "Check Reliability",
    body: "Reliability explains operational problems such as permanent failures, retryable issues, Gmail safety pauses, pacing waits, and other sending conditions that may require action.",
    selector: sel("analysis-tab-reliability"),
    placement: "bottom"
  };
}

function sendersStep(): ManualStep {
  return {
    id: "analysis-senders",
    title: "Monitor Senders",
    body: "Senders compares connected Gmail accounts. Use it to review rolling sending capacity, reply rates, send volume, synchronization status, connection health, and recent sender changes.",
    selector: sel("analysis-tab-senders"),
    placement: "bottom"
  };
}

/** The complete Analysis guide, in reading order: header, then the five tabs. */
export function analysisFullSteps(): ManualStep[] {
  return [
    introductionStep(),
    summaryStep(),
    engagementStep(),
    sequencesStep(),
    reliabilityStep(),
    sendersStep()
  ];
}

export const analysisManual: ManualConfig = {
  id: "analysis",
  routeLabel: "Analysis",
  helpLabel: "Help with Analysis",
  helpTooltip: "Analysis guide",
  helpVariant: "premium",
  version: "v1",
  // Analysis ends its guide on "Done", matching the Overview guide.
  finishLabel: "Done",
  // The Analysis guide offers Back after the first step and drops Skip on the
  // final step; both flags default off so every other guide is unchanged.
  showBackButton: true,
  hideSkipOnFinalStep: true,
  steps: analysisFullSteps(),
  // A manual Help click always resolves to the complete six-step guide.
  resolveStage: () => "full"
};
