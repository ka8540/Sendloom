import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

// Discover uses a two-page master/detail flow, so its contextual help is split
// into two tour configurations:
//   - discoverListManual  → /prospects (Search History + actions)
//   - discoverDetailManual → /prospects/[searchId] (one search workspace)
// Both reuse the shared floating Help button + overlay. Stages are resolved from
// DOM markers (data-discover-tour / data-discover-detail-stage) so a manual Help
// click always replays the guide for the current page state.

export type DiscoverListStage = "starter" | "list";
export type DiscoverDetailStage = "ready" | "draft" | "processing" | "failed";

function sel(target: string): string {
  return `[data-discover-tour="${target}"]`;
}

// ---------------------------------------------------------------------------
// List page (/prospects)
// ---------------------------------------------------------------------------

function listIntroStep(): ManualStep {
  return {
    id: "page-intro",
    title: "Welcome to Discover",
    body: "Find professionals by company, role, and location, then prepare their inferred work contacts for review, export, or Imports.",
    selector: sel("page-intro"),
    placement: "bottom"
  };
}

function listQuotaStep(options: { unlimited: boolean }): ManualStep {
  return {
    id: "quota",
    title: "Your Discover allowance",
    body: options.unlimited
      ? "Your account has unlimited Discover access. Each request still follows the configured result batch size."
      : "Each search returns up to 10 people. Your remaining daily searches are shown here.",
    selector: sel("quota"),
    placement: "bottom",
    optional: true
  };
}

function listRefreshStep(): ManualStep {
  return {
    id: "refresh",
    title: "Refresh Discover",
    body: "Refresh updates search statuses, usage information, and completed results without creating another search.",
    selector: sel("refresh"),
    placement: "bottom",
    optional: true
  };
}

function listNewSearchStep(): ManualStep {
  return {
    id: "new-search",
    title: "Create a search",
    body: "Choose a company, one or more job roles, and a location. Discover creates a draft before processing the people search.",
    selector: sel("new-search"),
    placement: "bottom"
  };
}

/** Stage 1 — first-time / empty list. Ends on the empty state. */
export function discoverStarterSteps(options: { unlimited: boolean }): ManualStep[] {
  return [
    listIntroStep(),
    listQuotaStep(options),
    listRefreshStep(),
    listNewSearchStep(),
    {
      id: "empty-state",
      title: "Your searches will appear here",
      body: "After creating a search, it will appear in Search History where you can process it and open its results.",
      selector: sel("empty-state"),
      placement: "top"
    }
  ];
}

/** Stage 2 — populated list. Explains Search History, status, opening, paging. */
export function discoverPopulatedListSteps(options: { unlimited: boolean }): ManualStep[] {
  return [
    listIntroStep(),
    listQuotaStep(options),
    listRefreshStep(),
    listNewSearchStep(),
    {
      id: "search-history",
      title: "Your Discover searches",
      body: "Search History shows the company, requested roles, location, people count, status, and creation date for each search.",
      selector: sel("search-history"),
      placement: "top"
    },
    {
      id: "search-status",
      title: "Follow search progress",
      body: "Draft searches have not started. Processing searches are collecting people. Ready searches can be opened and reviewed. Failed searches need attention.",
      selector: sel("search-status"),
      placement: "top",
      optional: true
    },
    {
      id: "search-row",
      title: "Open a search",
      body: "Select a Search History row to open its dedicated results page, where you can review the company, people, email format, and available actions.",
      selector: sel("search-row"),
      placement: "top"
    },
    {
      id: "history-pagination",
      title: "Browse older searches",
      body: "Discover displays 10 searches per page. Use the arrow controls to browse older searches.",
      selector: sel("history-pagination"),
      placement: "top",
      optional: true
    }
  ];
}

export function resolveDiscoverListStage(flags: { hasSearches: boolean }): DiscoverListStage {
  return flags.hasSearches ? "list" : "starter";
}

export function discoverListStepsForStage(stage: string | null, options: { unlimited: boolean }): ManualStep[] {
  if (stage === "list") {
    return discoverPopulatedListSteps(options);
  }
  return discoverStarterSteps(options);
}

// ---------------------------------------------------------------------------
// Detail page (/prospects/[searchId])
// ---------------------------------------------------------------------------

function detailHeaderStep(): ManualStep {
  return {
    id: "detail-header",
    title: "This search workspace",
    body: "Review one company, its search filters, current status, people count, and available actions on this dedicated page.",
    selector: sel("detail-header"),
    placement: "bottom"
  };
}

/** Stage — a READY search. The full results workspace. */
export function discoverReadySteps(): ManualStep[] {
  return [
    detailHeaderStep(),
    {
      id: "company-summary",
      title: "Selected company",
      body: "Shows the resolved company and public website for this search.",
      selector: sel("company-summary"),
      placement: "bottom"
    },
    {
      id: "people-summary",
      title: "People found",
      body: "Shows the total people currently attached to this search and their role groups.",
      selector: sel("people-summary"),
      placement: "bottom"
    },
    {
      id: "email-format-summary",
      title: "Company email format",
      body: "Shows the work email domain and naming pattern used to generate inferred email addresses.",
      selector: sel("email-format-summary"),
      placement: "bottom"
    },
    {
      id: "status-summary",
      title: "Search status",
      body: "Shows whether this search is ready, processing, still a draft, or needs attention.",
      selector: sel("status-summary"),
      placement: "bottom"
    },
    {
      id: "company-details",
      title: "Review company details",
      body: "Review the website, work email domain, email pattern, confidence levels, people count, and professional-profile link.",
      selector: sel("company-details"),
      placement: "top"
    },
    {
      id: "email-evidence",
      title: "Email-format evidence",
      body: "Shows the public evidence used to select the company's work email domain and naming pattern.",
      selector: sel("email-evidence"),
      placement: "top",
      optional: true
    },
    {
      id: "refresh-ai",
      title: "Refresh public evidence",
      body: "Search public sources again when the company email domain or pattern may be unavailable or outdated.",
      selector: sel("refresh-ai"),
      placement: "top",
      optional: true
    },
    {
      id: "source-url",
      title: "Use a public source",
      body: "Provide a trusted public company email-format page that Discover should evaluate.",
      selector: sel("source-url"),
      placement: "top",
      optional: true
    },
    {
      id: "manual-format",
      title: "Correct the email format",
      body: "Set a known work email domain and pattern when automated evidence is unavailable or incorrect. The generated addresses remain inferred.",
      selector: sel("manual-format"),
      placement: "top",
      optional: true
    },
    {
      id: "add-more-people",
      title: "Add more unique people",
      body: "Request up to 10 additional people for this exact search. Existing people will not be repeated, and the request uses one daily Discover search.",
      selector: sel("add-more-people"),
      placement: "bottom",
      optional: true
    },
    {
      id: "role-filters",
      title: "Filter by role group",
      body: "Review all people or narrow the table to a specific profession found in this search.",
      selector: sel("role-filters"),
      placement: "bottom"
    },
    {
      id: "inferred-warning",
      title: "Inferred is not verified",
      body: "Email addresses are generated from the selected company domain and naming pattern. Review or verify them before outreach.",
      selector: sel("inferred-warning"),
      placement: "bottom"
    },
    {
      id: "people-filter",
      title: "Filter visible results",
      body: "Filter the currently displayed people by name, role, or inferred email.",
      selector: sel("people-filter"),
      placement: "bottom",
      optional: true
    },
    {
      id: "people-table",
      title: "Review discovered people",
      body: "Each row shows the person, role, location, inferred work email, confidence, and professional-profile link.",
      selector: sel("people-table"),
      placement: "top"
    },
    {
      id: "people-selection",
      title: "Select people",
      body: "Select individual people or use the header checkbox to select the 10 visible rows on this page.",
      selector: sel("people-selection"),
      placement: "right",
      optional: true
    },
    {
      id: "copy-email",
      title: "Copy an inferred email",
      body: "Copy an available inferred address. Copying does not create a sequence or send an email.",
      selector: sel("copy-email"),
      placement: "left",
      optional: true
    },
    {
      id: "profile-link",
      title: "Review the public profile",
      body: "Open the person's public professional profile in a new tab before using the contact.",
      selector: sel("profile-link"),
      placement: "left",
      optional: true
    },
    {
      id: "bulk-actions",
      title: "Use selected contacts",
      body: "Download selected eligible contacts as an Excel file, add them to Imports, or clear the current selection.",
      selector: sel("bulk-actions"),
      placement: "bottom",
      optional: true
    },
    {
      id: "people-pagination",
      title: "Move through people",
      body: "Discover displays 10 people per page. Use the arrow controls to move through additional results.",
      selector: sel("people-pagination"),
      placement: "top"
    },
    {
      id: "delete-search",
      title: "Delete this search",
      body: "Deletes this Discover search and its user-owned results. It does not remove Imports or sequences created separately.",
      selector: sel("delete-search"),
      placement: "left",
      optional: true
    }
  ];
}

/** Stage — a DRAFT search. No result-specific steps before people exist. */
export function discoverDraftSteps(options: { unlimited: boolean }): ManualStep[] {
  return [
    detailHeaderStep(),
    {
      id: "status-summary",
      title: "Draft status",
      body: "This search is a draft. It has not started collecting people yet.",
      selector: sel("status-summary"),
      placement: "bottom"
    },
    {
      id: "process-action",
      title: "Process this search",
      body: "Processing starts the people search and uses one daily Discover search. Retrying the same processing request does not use another slot.",
      selector: sel("process-action"),
      placement: "top",
      optional: true
    },
    {
      id: "quota",
      title: "Your Discover allowance",
      body: options.unlimited
        ? "Your account has unlimited Discover access."
        : "Each search returns up to 10 people. Your remaining daily searches are shown here.",
      selector: sel("quota"),
      placement: "bottom",
      optional: true
    }
  ];
}

/** Stage — a PROCESSING search. Explains the wait; no result controls. */
export function discoverProcessingSteps(): ManualStep[] {
  return [
    detailHeaderStep(),
    {
      id: "status-summary",
      title: "Search in progress",
      body: "Discover is collecting and preparing people for this search. You can leave the page and return later; Refresh updates the current status.",
      selector: sel("status-summary"),
      placement: "bottom"
    }
  ];
}

/** Stage — a FAILED search. Status, safe retry, back. No provider details. */
export function discoverFailedSteps(): ManualStep[] {
  return [
    detailHeaderStep(),
    {
      id: "status-summary",
      title: "Search needs attention",
      body: "This search did not complete. The status summary shows a safe explanation of what to do next.",
      selector: sel("status-summary"),
      placement: "bottom"
    },
    {
      id: "process-action",
      title: "Retry processing",
      body: "Retry the search when you are ready. Retrying the same search does not use another daily slot.",
      selector: sel("process-action"),
      placement: "top",
      optional: true
    }
  ];
}

export function discoverDetailStepsForStage(stage: string | null): ManualStep[] {
  if (stage === "ready") {
    return discoverReadySteps();
  }
  if (stage === "draft") {
    return discoverDraftSteps({ unlimited: isUnlimitedFromDom() });
  }
  if (stage === "processing") {
    return discoverProcessingSteps();
  }
  if (stage === "failed") {
    return discoverFailedSteps();
  }
  // Unknown / canceled: a minimal safe guide that never references absent results.
  return [
    detailHeaderStep(),
    {
      id: "status-summary",
      title: "Search status",
      body: "Shows whether this search is ready, processing, still a draft, or needs attention.",
      selector: sel("status-summary"),
      placement: "bottom"
    }
  ];
}

// ---------------------------------------------------------------------------
// DOM stage resolution (used for manual Help clicks)
// ---------------------------------------------------------------------------

function hasTarget(target: string): boolean {
  return typeof document !== "undefined" && document.querySelector(sel(target)) !== null;
}

function isUnlimitedFromDom(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.querySelector(sel("quota"))?.getAttribute("data-discover-quota") === "unlimited";
}

function resolveListStageFromDom(): DiscoverListStage {
  return resolveDiscoverListStage({ hasSearches: hasTarget("search-history") });
}

function resolveDetailStageFromDom(): DiscoverDetailStage | null {
  if (typeof document === "undefined") {
    return null;
  }
  const stage = document.querySelector("[data-discover-detail-stage]")?.getAttribute("data-discover-detail-stage");
  if (stage === "ready" || stage === "draft" || stage === "processing" || stage === "failed") {
    return stage;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Manual configs
// ---------------------------------------------------------------------------

export const discoverListManual: ManualConfig = {
  id: "discover-list",
  routeLabel: "Discover",
  helpLabel: "Help with Discover",
  helpTooltip: "Discover guide",
  autoOpen: false,
  version: "v2",
  steps: discoverStarterSteps({ unlimited: false }),
  resolveStage: () => resolveListStageFromDom(),
  resolveSteps: (stage) => discoverListStepsForStage(stage, { unlimited: isUnlimitedFromDom() })
};

export const discoverDetailManual: ManualConfig = {
  id: "discover-detail",
  routeLabel: "Discover",
  helpLabel: "Help with Discover",
  helpTooltip: "Discover guide",
  autoOpen: false,
  version: "v2",
  steps: discoverReadySteps(),
  resolveStage: () => resolveDetailStageFromDom(),
  resolveSteps: (stage) => discoverDetailStepsForStage(stage)
};
