import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

// Finder (/finder) guided help. Three menu modes share one config:
//   - "starter" → a short Quick start (purpose + first lookup)
//   - "full"    → the complete page tour, adapted to the visible state
//   - "changed" → a contextual tour of the result controls, offered once a
//                 lookup has produced results
//
// Every step targets a stable `data-finder-tour="..."` attribute, and
// state-dependent steps are `optional` so the overlay drops them when absent.
// Copy is product-facing only — it never mentions API keys, encryption,
// server-side storage, or any backend/provider implementation detail.

function sel(target: string): string {
  return `[data-finder-tour="${target}"]`;
}

function finderNeedsSetup(): boolean {
  return typeof document !== "undefined" && document.querySelector(sel("setup-callout")) !== null;
}

function finderHasResults(): boolean {
  return typeof document !== "undefined" && document.querySelector(sel("result-card")) !== null;
}

// ---- Reusable steps --------------------------------------------------------

function introStep(): ManualStep {
  const needsSetup = finderNeedsSetup();
  return needsSetup
    ? {
        id: "page-intro",
        title: "Complete Finder setup",
        body: "Finder helps you discover professional email addresses. Open Settings and complete the Finder setup before running a search.",
        selector: sel("page-intro"),
        placement: "bottom"
      }
    : {
        id: "page-intro",
        title: "Finder is ready",
        body: "Use Find Email for one professional or Domain Search to review company-level results. Enter the required details, then run the search.",
        selector: sel("page-intro"),
        placement: "bottom"
      };
}

function modeTabsStep(): ManualStep {
  return {
    id: "mode-tabs",
    title: "Choose how to search",
    body: "Find Email looks up one person at a company. Domain Search returns the contacts found for a whole company domain.",
    selector: sel("mode-tabs"),
    placement: "bottom"
  };
}

function fullNameStep(): ManualStep {
  return {
    id: "full-name",
    title: "Who are you looking for?",
    body: "Enter the person's full name. Finder matches it against the company domain to suggest their most likely address.",
    selector: sel("full-name"),
    placement: "right",
    optional: true
  };
}

function domainStep(): ManualStep {
  return {
    id: "domain",
    title: "Which company?",
    body: "Enter the company domain (for example, the part after @ in a work email). Finder uses it to find or build the address.",
    selector: sel("domain"),
    placement: "right",
    optional: true
  };
}

function submitStep(): ManualStep {
  return {
    id: "submit",
    title: "Run the search",
    body: "Start the lookup. Results appear in the Results panel beside the form within a few moments.",
    selector: sel("submit"),
    placement: "right",
    optional: true
  };
}

function resultsStep(): ManualStep {
  return {
    id: "results",
    title: "Your results appear here",
    body: "Run a lookup to view results here. Each result shows the contact, the discovered email, and a confidence score so you can judge how reliable it is.",
    selector: sel("results"),
    placement: "left"
  };
}

function resultCardStep(): ManualStep {
  return {
    id: "result-card",
    title: "Read a result",
    body: "Each card shows the contact name, the discovered email, and its confidence. Higher confidence means the address is more likely to be correct.",
    selector: sel("result-card"),
    placement: "left",
    optional: true
  };
}

function copyStep(): ManualStep {
  return {
    id: "copy",
    title: "Use a result",
    body: "Copy an address to use it in your outreach. Copying does not send anything or create a sequence.",
    selector: sel("copy"),
    placement: "left",
    optional: true
  };
}

function historyStep(): ManualStep {
  return {
    id: "history",
    title: "Reuse past searches",
    body: "Recent company searches are saved here so you can reopen a company's results without running the lookup again.",
    selector: sel("history"),
    placement: "top",
    optional: true
  };
}

function settingsStep(): ManualStep {
  return {
    id: "settings",
    title: "Finder settings",
    body: "Open Settings to connect or update Finder. Complete this once and the connection status is shown here.",
    selector: sel("settings"),
    placement: "bottom"
  };
}

function setupCalloutStep(): ManualStep {
  return {
    id: "setup-callout",
    title: "Finder needs setup",
    body: "Complete the Finder setup in Settings before running searches. Until then, searches stay disabled.",
    selector: sel("setup-callout"),
    placement: "bottom",
    optional: true
  };
}

// ---- Stage builders --------------------------------------------------------

/** Quick start — purpose + the first lookup, kept short. */
export function finderQuickSteps(): ManualStep[] {
  return [introStep(), modeTabsStep(), fullNameStep(), domainStep(), submitStep(), resultsStep()];
}

/** Full tour — every visible control, adapted to setup/result state. */
export function finderFullSteps(): ManualStep[] {
  const steps: ManualStep[] = [introStep(), settingsStep()];
  if (finderNeedsSetup()) {
    steps.push(setupCalloutStep());
  }
  steps.push(
    {
      id: "status",
      title: "Connection status",
      body: "This shows whether Finder is connected and ready. When it is not, complete setup in Settings before searching.",
      selector: sel("status"),
      placement: "bottom",
      optional: true
    },
    modeTabsStep(),
    {
      id: "find-email-tab",
      title: "Find Email",
      body: "Look up one professional by full name and company domain.",
      selector: sel("find-email-tab"),
      placement: "bottom",
      optional: true
    },
    {
      id: "domain-search-tab",
      title: "Domain Search",
      body: "Review the contacts found for an entire company domain, grouped by department.",
      selector: sel("domain-search-tab"),
      placement: "bottom",
      optional: true
    },
    fullNameStep(),
    domainStep(),
    submitStep(),
    resultsStep(),
    resultCardStep(),
    copyStep(),
    historyStep()
  );
  return steps;
}

/** Contextual "what changed" — the result controls, shown once results exist. */
export function finderChangedSteps(): ManualStep[] {
  return [resultsStep(), resultCardStep(), copyStep(), historyStep()];
}

export function finderStepsForStage(stage: string | null): ManualStep[] {
  if (stage === "full") {
    return finderFullSteps();
  }
  if (stage === "changed") {
    return finderChangedSteps();
  }
  return finderQuickSteps();
}

export { finderHasResults };

export const finderManual: ManualConfig = {
  id: "finder",
  routeLabel: "Finder",
  helpLabel: "Help with Finder",
  helpTooltip: "Finder guide",
  helpVariant: "premium",
  helpQuickStart: true,
  quickStartStage: "starter",
  fullTourStage: "full",
  version: "v2",
  steps: finderQuickSteps(),
  // First-time auto-open shows the short quick start once.
  resolveStage: () => "starter",
  resolveSteps: (stage) => finderStepsForStage(stage)
};
