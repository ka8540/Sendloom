import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

export type DiscoverTourStage = "starter" | "draft" | "results";

function sel(target: string): string {
  return `[data-discover-tour="${target}"]`;
}

/**
 * Stage 1 — first-time / empty dashboard. Explains what Discover is, the daily
 * allowance, and the two primary actions. Copy never claims inferred emails are
 * verified and never names providers or internal mechanics.
 */
export function discoverStarterSteps(options: { unlimited: boolean }): ManualStep[] {
  return [
    {
      id: "page-intro",
      title: "Welcome to Discover",
      body: "Find professionals by company, role, and location. Discover prepares a reviewable list of inferred work contacts that you can later export or add to Imports.",
      selector: sel("page-intro"),
      placement: "bottom"
    },
    {
      id: "quota",
      title: "Your daily Discover allowance",
      body: options.unlimited
        ? "Your account has unlimited Discover access. Each search still follows the configured per-search result size."
        : "Each search returns up to 10 people. You can run up to 4 Discover searches per day, and your allowance resets automatically.",
      selector: sel("quota"),
      placement: "bottom",
      optional: true
    },
    {
      id: "new-search",
      title: "Start with a new search",
      body: "Choose a company, one or more job titles, and a location. Discover will create a draft before fetching people.",
      selector: sel("new-search"),
      placement: "bottom"
    },
    {
      id: "refresh",
      title: "Refresh this dashboard",
      body: "Refresh updates search statuses, usage information, and newly completed results without creating another search.",
      selector: sel("refresh"),
      placement: "bottom",
      optional: true
    },
    {
      id: "starter-final",
      title: "Ready to discover people",
      body: "Select New search, enter the company, roles, and location, then create your first draft.",
      placement: "center"
    }
  ];
}

/**
 * Stage 2 — a draft exists. Explains the draft, processing (and its quota cost),
 * and what each status means. No internal cache architecture is exposed.
 */
export function discoverDraftSteps(): ManualStep[] {
  return [
    {
      id: "draft-row",
      title: "Your search starts as a draft",
      body: "A draft saves your company, roles, and location without fetching people yet. Review the details, then process it when you are ready.",
      selector: sel("search-history"),
      placement: "bottom"
    },
    {
      id: "process",
      title: "Process the search",
      body: "Processing starts the people search and uses one of your daily Discover searches. Retrying the same search does not use another daily slot.",
      selector: sel("process-action"),
      placement: "top",
      optional: true
    },
    {
      id: "draft-status",
      title: "Follow the search status",
      body: "Draft means it has not started. Processing means Discover is collecting and preparing results. Ready means the results can be reviewed. Failed means the search needs attention or can be retried.",
      selector: sel("search-status"),
      placement: "top"
    },
    {
      id: "draft-cached",
      title: "Faster repeat searches",
      body: "Some matching searches may complete faster when recent results are already available.",
      placement: "center"
    }
  ];
}

/**
 * Stage 3 — a READY search is selected. Walks the summary cards, history,
 * company details/evidence, role filters, the people table and its actions, and
 * pagination. Optional steps are skipped when their controls are not present.
 */
export function discoverResultsSteps(): ManualStep[] {
  return [
    {
      id: "company-summary",
      title: "Selected company",
      body: "Shows the resolved company and its public website for the currently selected search.",
      selector: sel("company-summary"),
      placement: "bottom"
    },
    {
      id: "people-summary",
      title: "People found",
      body: "Shows how many people were found and how many role groups they were organized into.",
      selector: sel("people-summary"),
      placement: "bottom"
    },
    {
      id: "email-format-summary",
      title: "Work email format",
      body: "Shows the selected company email domain and naming pattern. Generated addresses are inferred from public evidence until they are verified.",
      selector: sel("email-format-summary"),
      placement: "bottom"
    },
    {
      id: "results-status",
      title: "Search status",
      body: "Shows whether the selected search is ready, processing, still a draft, or needs attention.",
      selector: sel("search-status"),
      placement: "bottom"
    },
    {
      id: "search-history",
      title: "Switch between searches",
      body: "Search History contains your previous Discover searches. Select a row to load that company and its people without losing the other records. Use the arrow controls to move through older searches.",
      selector: sel("search-history"),
      placement: "top"
    },
    {
      id: "company-details",
      title: "Review company and email evidence",
      body: "Review the website, work email domain, email pattern, confidence, and public evidence used to prepare inferred addresses.",
      selector: sel("company-details"),
      placement: "top"
    },
    {
      id: "refresh-ai",
      title: "Refresh email evidence",
      body: "Search public evidence again when the company email domain or pattern appears outdated or unavailable.",
      selector: sel("refresh-ai"),
      placement: "top",
      optional: true
    },
    {
      id: "source-url",
      title: "Use a public source",
      body: "Provide a public company email-format page when you have a trusted source that Discover should evaluate.",
      selector: sel("source-url"),
      placement: "top",
      optional: true
    },
    {
      id: "manual-format",
      title: "Correct the format manually",
      body: "Set a known work email domain and pattern when automated evidence is unavailable or incorrect. Manually generated addresses remain inferred.",
      selector: sel("manual-format"),
      placement: "top",
      optional: true
    },
    {
      id: "delete",
      title: "Delete this search",
      body: "Removes this search and its user-owned results from your Discover history. This action does not remove Imports or sequences created separately.",
      selector: sel("delete"),
      placement: "left",
      optional: true
    },
    {
      id: "role-filters",
      title: "Filter people by role group",
      body: "Choose All people or a specific profession to review only the people assigned to that role group.",
      selector: sel("role-filters"),
      placement: "bottom",
      optional: true
    },
    {
      id: "inferred-warning",
      title: "Inferred does not mean verified",
      body: "Work emails are generated from the company's selected domain and naming pattern. Review or verify them before using them for outreach.",
      selector: sel("inferred-warning"),
      placement: "bottom"
    },
    {
      id: "people-filter",
      title: "Filter the current results",
      body: "Filter the currently loaded people by name, title, or email.",
      selector: sel("people-filter"),
      placement: "bottom",
      optional: true
    },
    {
      id: "people-table",
      title: "Review discovered people",
      body: "Each row shows the person, current role, location, inferred work email, confidence, and professional profile link.",
      selector: sel("people-table"),
      placement: "top"
    },
    {
      id: "copy-email",
      title: "Copy an email",
      body: "Copy an available inferred email. The copy action does not send a message or create a sequence.",
      selector: sel("copy-email"),
      placement: "left",
      optional: true
    },
    {
      id: "profile-link",
      title: "Open the professional profile",
      body: "Open the public professional profile in a new tab to review the person before using the contact.",
      selector: sel("profile-link"),
      placement: "left",
      optional: true
    },
    {
      id: "selection",
      title: "Select people",
      body: "Select individual people or use the header checkbox to select the 10 visible rows on this page.",
      selector: sel("selection"),
      placement: "right",
      optional: true
    },
    {
      id: "select-all",
      title: "Select an entire role group",
      body: "After selecting the visible page, you can extend the selection to everyone matching the current role filter.",
      selector: sel("select-all"),
      placement: "bottom",
      optional: true
    },
    {
      id: "bulk-actions",
      title: "Use selected contacts",
      body: "Download selected contacts as an Excel file, add eligible contacts to Imports, or clear the current selection.",
      selector: sel("bulk-actions"),
      placement: "bottom",
      optional: true
    },
    {
      id: "people-pagination",
      title: "Move through results",
      body: "Discover shows 10 people per page. Use the arrow controls to move between pages while keeping the selected role group.",
      selector: sel("people-pagination"),
      placement: "top",
      optional: true
    },
    {
      id: "results-final",
      title: "Your Discover results are ready",
      body: "Review the people and email confidence, select the contacts you need, then download them or add eligible contacts to Imports.",
      placement: "center"
    }
  ];
}

/** Pure stage resolution from page-state flags (DOM presence in practice). */
export function resolveDiscoverStage(flags: { hasResults: boolean; hasSearches: boolean }): DiscoverTourStage {
  if (flags.hasResults) {
    return "results";
  }
  if (flags.hasSearches) {
    return "draft";
  }
  return "starter";
}

/** Pure stage → steps mapping, used by the manual config and unit-tested. */
export function discoverStepsForStage(stage: string | null, options: { unlimited: boolean }): ManualStep[] {
  if (stage === "results") {
    return discoverResultsSteps();
  }
  if (stage === "draft") {
    return discoverDraftSteps();
  }
  return discoverStarterSteps(options);
}

function hasTarget(target: string): boolean {
  return typeof document !== "undefined" && document.querySelector(sel(target)) !== null;
}

function isUnlimitedFromDom(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.querySelector(sel("quota"))?.getAttribute("data-discover-quota") === "unlimited";
}

export const discoverManual: ManualConfig = {
  id: "discover",
  routeLabel: "Discover",
  helpLabel: "Help with Discover",
  helpTooltip: "Discover guide",
  // The Discover dashboard drives stage-specific auto-open (it knows the real
  // loading/search state), so the provider's generic auto-open is disabled here.
  autoOpen: false,
  version: "v1",
  steps: discoverStarterSteps({ unlimited: false }),
  resolveStage: () =>
    resolveDiscoverStage({
      hasResults: hasTarget("people-table") || hasTarget("company-details"),
      hasSearches: hasTarget("search-history")
    }),
  resolveSteps: (stage) => discoverStepsForStage(stage, { unlimited: isUnlimitedFromDom() })
};
