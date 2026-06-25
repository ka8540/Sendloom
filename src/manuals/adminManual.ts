import type { ManualConfig, ManualStep } from "@/components/manual/manualTypes";

// One adaptive guide shared by every admin route. Each admin page renders a
// different section under a stable `data-admin-tour="<section>"` root, so every
// step is `optional` and the shared overlay keeps only the steps whose target is
// actually on the current page. resolveStage reports the current section so the
// first-time guide auto-opens once per admin route (not once globally).
//
// Admin help may be more technical than user help, but never names credentials,
// tokens, secret keys, raw connection strings, or stack traces.

export type AdminSection = "overview" | "users" | "restrictions" | "system-health" | "activity";

const ROUTE_SECTIONS: AdminSection[] = ["overview", "users", "restrictions", "system-health", "activity"];

function adminSel(target: string): string {
  return `[data-admin-tour="${target}"]`;
}

function ariaSel(label: string): string {
  return `[aria-label="${label}"]`;
}

export const adminSteps: ManualStep[] = [
  // ---- Overview (/admin) ----
  {
    id: "overview",
    title: "Admin overview",
    body: "This is the operations summary for the whole workspace: how many accounts exist, who is active, what is restricted, and whether core systems are healthy.",
    selector: adminSel("overview"),
    placement: "bottom",
    optional: true
  },
  {
    id: "metrics",
    title: "Key metrics",
    body: "These cards show total users, who is signed in now, restricted accounts, and connected Gmail senders across the workspace.",
    selector: adminSel("metrics"),
    placement: "bottom",
    optional: true
  },
  {
    id: "footprint",
    title: "Status and footprint",
    body: "The status mix and workspace footprint summarize account health and how many imports, templates, sequences, and senders exist in total.",
    selector: ariaSel("Account status and workspace footprint"),
    placement: "top",
    optional: true
  },
  // ---- Users (/admin/users) ----
  {
    id: "users",
    title: "User directory",
    body: "Browse and search every account. Select a user to review their workspace footprint, connection state, and account status in the detail panel.",
    selector: adminSel("users"),
    placement: "bottom",
    optional: true
  },
  {
    id: "users-pagination",
    title: "Page through users",
    body: "Use the arrow controls to move through additional pages of accounts when the directory is longer than one page.",
    selector: ariaSel("Next user page"),
    placement: "top",
    optional: true
  },
  // ---- Restrictions (/admin/restrictions) ----
  {
    id: "restrictions",
    title: "Account restrictions",
    body: "Pick an account, then enable or lift restrictions on what it can do. Changes apply to that account only and take effect on its next actions.",
    selector: adminSel("restrictions"),
    placement: "bottom",
    optional: true
  },
  // ---- System health (/admin/system-health) ----
  {
    id: "system-health",
    title: "Runtime checks",
    body: "Each tile reports whether a core dependency is responding — database, cache, storage, Google sign-in, mail delivery, and the scheduled job runner. Green means healthy.",
    selector: adminSel("system-health"),
    placement: "bottom",
    optional: true
  },
  {
    id: "system-health-recheck",
    title: "Re-run the checks",
    body: "Refresh the runtime checks on demand to confirm a dependency has recovered, without leaving the page.",
    selector: ariaSel("Recheck system health"),
    placement: "left",
    optional: true
  },
  // ---- Activity (/admin/activity) ----
  {
    id: "activity",
    title: "Activity console",
    body: "Review a timeline of workspace events — sign-ins, imports, template and sequence changes, sending activity, and security-relevant actions — for auditing and support.",
    selector: adminSel("activity"),
    placement: "bottom",
    optional: true
  },
  {
    id: "activity-user-search",
    title: "Find an account",
    body: "Search by email or account ID to focus the timeline on a single user before reviewing their events.",
    selector: ariaSel("Search users by email or ID"),
    placement: "right",
    optional: true
  },
  {
    id: "activity-filters",
    title: "Filter the timeline",
    body: "Narrow events by category, object type, and severity to isolate the activity you need to investigate.",
    selector: ariaSel("Filter by category"),
    placement: "bottom",
    optional: true
  },
  {
    id: "activity-daterange",
    title: "Choose a date range",
    body: "Limit the timeline to a specific window so older or unrelated events do not get in the way.",
    selector: ariaSel("Date range"),
    placement: "bottom",
    optional: true
  },
  {
    id: "activity-event-search",
    title: "Search within events",
    body: "Filter the visible events by keyword to quickly locate a specific action in the timeline.",
    selector: ariaSel("Search within events"),
    placement: "bottom",
    optional: true
  },
  {
    id: "activity-refresh",
    title: "Refresh the timeline",
    body: "Reload the most recent events without changing your current filters or selection.",
    selector: ariaSel("Refresh timeline"),
    placement: "left",
    optional: true
  }
];

export function resolveAdminSectionFromDom(): AdminSection | null {
  if (typeof document === "undefined") {
    return null;
  }
  for (const section of ROUTE_SECTIONS) {
    if (document.querySelector(adminSel(section))) {
      return section;
    }
  }
  return null;
}

export const adminManual: ManualConfig = {
  id: "admin",
  routeLabel: "Admin",
  helpLabel: "Help with Admin",
  helpTooltip: "Admin guide",
  helpVariant: "premium",
  version: "v1",
  steps: adminSteps,
  // Report the current admin section so the first-time guide auto-opens once per
  // admin route; the steps themselves are filtered to the visible section.
  resolveStage: () => resolveAdminSectionFromDom(),
  resolveSteps: () => adminSteps
};
