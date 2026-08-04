import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import type { ManualStep } from "@/components/manual/manualTypes";
import { getManualForPathname } from "@/manuals";
import {
  getEligibleOverviewStages,
  overviewAttentionSteps,
  overviewFirstSequenceSteps,
  overviewFoundationsSteps,
  overviewFullSteps,
  overviewSelector,
  overviewStarterSteps,
  overviewStepsForStage,
  resolveOverviewChangedStage,
  workspaceManual,
  type OverviewTourState
} from "@/manuals/workspaceManual";

// Source-text assertions (node test env has no DOM), matching the existing
// manual test style. Behavioural step logic is exercised through the exported
// pure builders + filterAvailableManualSteps.
const MANUAL_SOURCE = readFileSync("src/manuals/workspaceManual.ts", "utf8");
const BUTTON_SOURCE = readFileSync("src/components/manual/ManualButton.tsx", "utf8");
const CSS_SOURCE = readFileSync("src/components/manual/manual.module.css", "utf8");
const PROVIDER_SOURCE = readFileSync("src/components/manual/ManualProvider.tsx", "utf8");
const OVERLAY_SOURCE = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
const POSITION_SOURCE = readFileSync("src/components/manual/overlayPosition.ts", "utf8");
const LAUNCHER_SOURCE = readFileSync("src/components/dashboard/overview-tour-launcher.tsx", "utf8");
const CENTER_SOURCE = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const SEND_WINDOW_SOURCE = readFileSync("src/components/dashboard/overview-send-window.tsx", "utf8");
const PANEL_SOURCE = readFileSync("src/components/dashboard/sequence-panel.tsx", "utf8");
const ROW_SOURCE = readFileSync("src/components/dashboard/sequence-row.tsx", "utf8");
const ACTIVITY_SOURCE = readFileSync("src/components/dashboard/activity-feed.tsx", "utf8");

function ids(steps: ManualStep[]): string[] {
  return steps.map((step) => step.id);
}

const EMPTY_STATE: OverviewTourState = {
  hasImports: false,
  hasTemplates: false,
  hasSequences: false,
  hasActiveSequences: false,
  hasRecentSequences: false,
  hasActivity: false,
  hasAttentionItems: false,
  hasGmailSenders: false,
  hasMultipleSequencePages: false
};

const FOUNDATIONS_STATE: OverviewTourState = { ...EMPTY_STATE, hasImports: true, hasTemplates: true };
const DRAFT_SEQUENCE_STATE: OverviewTourState = {
  ...EMPTY_STATE,
  hasImports: true,
  hasTemplates: true,
  hasSequences: true,
  hasRecentSequences: true
};
const ACTIVE_SEQUENCE_STATE: OverviewTourState = {
  ...DRAFT_SEQUENCE_STATE,
  hasActiveSequences: true,
  hasActivity: true,
  hasGmailSenders: true
};
const COMPLETED_SEQUENCE_STATE: OverviewTourState = { ...ACTIVE_SEQUENCE_STATE, hasActiveSequences: false };
const ATTENTION_STATE: OverviewTourState = { ...ACTIVE_SEQUENCE_STATE, hasAttentionItems: true };
const GMAIL_WARNING_STATE: OverviewTourState = { ...COMPLETED_SEQUENCE_STATE, hasAttentionItems: true };

/** The six targets the redesigned Overview actually renders. */
const ALL_TARGETS = new Set<string>(
  ["summary", "quick-actions", "sequence-search", "sequence-actions", "gmail-send-window", "recent-activity"].map(
    (target) => overviewSelector(target)
  )
);

/** A brand-new workspace: no sequence rows exist, so no row action group. */
const EMPTY_DASHBOARD_TARGETS = new Set<string>(
  ["summary", "quick-actions", "sequence-search", "gmail-send-window", "recent-activity"].map((target) =>
    overviewSelector(target)
  )
);

function present(targets: Set<string>) {
  return (selector: string) => targets.has(selector);
}

// ---------------------------------------------------------------------------

describe("Overview manual registration + Help button (#1, #31)", () => {
  it("registers the guide for /workspace and leaves other routes alone", () => {
    expect(getManualForPathname("/workspace")).toBe(workspaceManual);
    expect(getManualForPathname("/finder")?.id).toBe("finder");
    expect(getManualForPathname("/imports")?.id).toBe("imports");
    expect(getManualForPathname("/templates")?.id).toBe("templates");
    expect(getManualForPathname("/campaigns")?.id).toBe("campaigns");
    expect(getManualForPathname("/prospects")?.id).toBe("discover-list");
    expect(getManualForPathname("/prospects/abc")?.id).toBe("discover-detail");
    expect(getManualForPathname("/unknown")).toBeNull();
  });

  it("keeps the Overview label, tooltip, premium variant, and re-versions the key", () => {
    expect(workspaceManual.helpLabel).toBe("Help with Overview");
    expect(workspaceManual.helpTooltip).toBe("Overview guide");
    expect(workspaceManual.helpVariant).toBe("premium");
    expect(workspaceManual.helpQuickStart).toBe(true);
    expect(workspaceManual.autoOpen).toBe(false);
    // Rewritten content must not be suppressed by a completed older version.
    expect(workspaceManual.version).toBe("v5");
  });

  it("ends on Done without changing the label for any other guide (#25, #31)", () => {
    expect(workspaceManual.finishLabel).toBe("Done");
    // The shared overlay only overrides the default when a manual opts in.
    expect(OVERLAY_SOURCE).toContain('{manual.finishLabel ?? "Finish"}');
    for (const path of ["/finder", "/imports", "/templates", "/campaigns", "/prospects"]) {
      expect(getManualForPathname(path)?.finishLabel).toBeUndefined();
    }
  });

  it("renders the shared premium dashboard Help button unchanged", () => {
    expect(BUTTON_SOURCE).toContain("DashboardHelpButton");
    expect(BUTTON_SOURCE).toContain('manual.helpVariant === "simple"');
    expect(BUTTON_SOURCE).toContain("aria-label={label}");
    expect(BUTTON_SOURCE).toContain('data-manual-help-button="true"');
    expect(CENTER_SOURCE).not.toContain("helpButton");
    expect(SEND_WINDOW_SOURCE).not.toContain("CircleHelp");
  });
});

describe("The tour is exactly the six approved Overview steps (#1, #26)", () => {
  it("has six steps, in the approved order", () => {
    expect(ids(overviewFullSteps())).toEqual([
      "summary",
      "quick-actions",
      "sequence-search",
      "sequence-actions",
      "gmail-send-window",
      "recent-activity"
    ]);
    expect(overviewFullSteps().length).toBeLessThanOrEqual(6);
  });

  it("uses the approved titles and bodies", () => {
    const byId = Object.fromEntries(overviewFullSteps().map((step) => [step.id, step]));

    expect(byId.summary.title).toBe("Overview at a glance");
    expect(byId.summary.body).toBe(
      "See what is running, how many emails were sent in the last 24 hours, what needs attention, and how many lists are ready to launch."
    );

    expect(byId["quick-actions"].title).toBe("Start something quickly");
    expect(byId["quick-actions"].body).toBe(
      "Create a sequence, import a contact list, or create a template without leaving the Overview page."
    );

    expect(byId["sequence-search"].title).toBe("Find a recent sequence");
    expect(byId["sequence-search"].body).toBe(
      "Search recent sequences by sequence name, list, template, or sender."
    );

    expect(byId["sequence-actions"].title).toBe("Manage a sequence");
    expect(byId["sequence-actions"].body).toBe(
      "Use these controls to view, pause, resume or relaunch, delete, or open a sequence. Available actions depend on the sequence status."
    );

    expect(byId["gmail-send-window"].title).toBe("Check your sending capacity");
    expect(byId["gmail-send-window"].body).toBe(
      "See how many emails were sent in the rolling 24-hour window, how many remain, and when capacity resets for the connected Gmail sender."
    );

    expect(byId["recent-activity"].title).toBe("See what changed recently");
    expect(byId["recent-activity"].body).toBe(
      "Review the latest sequence updates, imports, Discover searches, and other recent work. The Overview shows only the newest activity items."
    );
  });

  it("drops every removed component and its stale copy (#2, #9)", () => {
    // The user-visible tour text — titles + bodies — must carry none of the
    // wording from the components the redesign removed.
    const tourText = overviewFullSteps()
      .flatMap((step) => [step.title, step.body])
      .join(" ")
      .toLowerCase();
    for (const banned of [
      "read the operating signals",
      "operating signals",
      "command center",
      "template inventory",
      "analytics",
      "sequence health",
      "system log",
      "delivery success",
      "success rate",
      "health check"
    ]) {
      expect(tourText).not.toContain(banned);
    }
    // The removed steps and their targets are gone for good.
    for (const removed of [
      "sequence-health",
      "templates-live",
      "delivery-issues",
      "recent-sequences-pagination",
      "activity-row",
      "gmail-progress",
      "sender-breakdown",
      "page-intro",
      "workspace-health",
      "live-system"
    ]) {
      expect(ids(overviewFullSteps())).not.toContain(removed);
      expect(MANUAL_SOURCE).not.toContain(`"${removed}"`);
    }
  });

  it("describes only real, current behaviour (#5, #6, #8)", () => {
    const byId = Object.fromEntries(overviewFullSteps().map((step) => [step.id, step]));
    // Search really does match name + the "list · template · sender" summary.
    expect(PANEL_SOURCE).toContain("row.name.toLowerCase().includes(normalizedQuery)");
    expect(PANEL_SOURCE).toContain("row.summary.toLowerCase().includes(normalizedQuery)");
    expect(CENTER_SOURCE).toContain(
      "summary: `${campaign.import.fileName} · ${campaign.template.name} · ${campaign.senderProfile.name}`"
    );
    // Every action the step names is one the row can actually render.
    for (const action of ["view", "pause", "resume", "relaunch", "delete", "open"]) {
      expect(byId["sequence-actions"].body.toLowerCase()).toContain(action);
    }
    // Activity copy promises only the newest items, matching the 4-row cap.
    expect(ACTIVITY_SOURCE).toContain("const OVERVIEW_ACTIVITY_LIMIT = 4;");
    expect(byId["recent-activity"].body).toMatch(/only the newest/i);
    expect(byId["recent-activity"].body).not.toMatch(/all|every|system log/i);
  });
});

describe("Targets are stable data attributes on the real components (#19)", () => {
  it("every step targets a data-overview-tour attribute", () => {
    for (const step of overviewFullSteps()) {
      expect(step.selector).toMatch(/^\[data-overview-tour="[a-z-]+"\]$/);
    }
  });

  it("each target is rendered by the component the step describes", () => {
    expect(CENTER_SOURCE).toContain('data-overview-tour="summary"');
    expect(CENTER_SOURCE).toContain('data-overview-tour="quick-actions"');
    expect(PANEL_SOURCE).toContain('data-overview-tour="sequence-search"');
    expect(SEND_WINDOW_SOURCE).toContain('data-overview-tour="gmail-send-window"');
    expect(ACTIVITY_SOURCE).toContain('data-overview-tour="recent-activity"');
    // The highlight covers the whole action area, not one icon, and only the
    // first row is stamped so the spotlight has a single unambiguous target.
    expect(ROW_SOURCE).toContain(
      'className={styles.sequenceActions} data-overview-tour={tourTarget ? "sequence-actions" : undefined}'
    );
  });

  it("stamps exactly the six targets — no orphans left behind", () => {
    const sources = [CENTER_SOURCE, PANEL_SOURCE, ROW_SOURCE, SEND_WINDOW_SOURCE, ACTIVITY_SOURCE].join("\n");
    const stamped = new Set([...sources.matchAll(/data-overview-tour=(?:"|\{tourTarget \? ")([a-z-]+)"/g)].map((m) => m[1]));
    expect([...stamped].sort()).toEqual([
      "gmail-send-window",
      "quick-actions",
      "recent-activity",
      "sequence-actions",
      "sequence-search",
      "summary"
    ]);
  });
});

describe("State-aware auto-open phases (#9, #10)", () => {
  it("a brand-new workspace is eligible only for the beginner guide", () => {
    expect(getEligibleOverviewStages(EMPTY_STATE)).toEqual(["starter"]);
  });

  it("imports/templates without sequences unlock the foundations phase", () => {
    expect(getEligibleOverviewStages(FOUNDATIONS_STATE)).toEqual(["foundations"]);
    expect(getEligibleOverviewStages({ ...EMPTY_STATE, hasImports: true })).toEqual(["foundations"]);
  });

  it("the first sequence unlocks the sequence phase, not foundations", () => {
    expect(getEligibleOverviewStages(DRAFT_SEQUENCE_STATE)).toEqual(["first-sequence"]);
    expect(getEligibleOverviewStages(ACTIVE_SEQUENCE_STATE)).toEqual(["first-sequence"]);
  });

  it("attention data adds the attention phase after the sequence phase", () => {
    expect(getEligibleOverviewStages(ATTENTION_STATE)).toEqual(["first-sequence", "attention"]);
    expect(getEligibleOverviewStages(GMAIL_WARNING_STATE)).toEqual(["first-sequence", "attention"]);
  });

  it("every phase is a subset of the six steps, so none can go stale", () => {
    const allowed = new Set(ids(overviewFullSteps()));
    for (const builder of [
      overviewStarterSteps,
      overviewFoundationsSteps,
      overviewFirstSequenceSteps,
      overviewAttentionSteps
    ]) {
      const stepIds = ids(builder());
      expect(stepIds.length).toBeGreaterThan(0);
      expect(stepIds.length).toBeLessThanOrEqual(6);
      for (const id of stepIds) {
        expect(allowed.has(id)).toBe(true);
      }
    }
  });

  it("opens one phase per visit and persists dismissal", () => {
    expect(LAUNCHER_SOURCE).toContain("getEligibleOverviewStages(state)");
    expect(LAUNCHER_SOURCE).toMatch(/find\(\(stage\)\s*=>\s*!isStageComplete\(stage\)\)/);
    expect(LAUNCHER_SOURCE).toContain("launchedRef");
    expect(PROVIDER_SOURCE).toMatch(/skipManual[\s\S]{0,160}markManualComplete/);
    expect(PROVIDER_SOURCE).toMatch(/versionSuffix/);
  });
});

describe("Optional targets are filtered safely (#11, #12)", () => {
  it("a manual Help click resolves to the complete tour", () => {
    expect(workspaceManual.resolveStage?.()).toBe("full");
    expect(ids(overviewStepsForStage("full"))).toEqual(ids(overviewFullSteps()));
    expect(BUTTON_SOURCE).toContain("Full page tour");
  });

  it("drops the row-action step on a dashboard with no sequences", () => {
    const filtered = ids(filterAvailableManualSteps(overviewFullSteps(), present(EMPTY_DASHBOARD_TARGETS)));
    expect(filtered).not.toContain("sequence-actions");
    // Everything always-present survives.
    expect(filtered).toEqual(["summary", "quick-actions", "sequence-search", "gmail-send-window", "recent-activity"]);
  });

  it("includes every step once the dashboard is populated", () => {
    expect(ids(filterAvailableManualSteps(overviewFullSteps(), present(ALL_TARGETS)))).toEqual(ids(overviewFullSteps()));
  });

  it("never crashes on empty / partial / unknown stage state", () => {
    expect(() => overviewStepsForStage(null)).not.toThrow();
    expect(ids(overviewStepsForStage("nonsense"))).toEqual(ids(overviewFullSteps()));
    expect(filterAvailableManualSteps(overviewFullSteps(), () => false).length).toBeGreaterThan(0);
    expect(resolveOverviewChangedStage(EMPTY_STATE)).toBeNull();
    expect(resolveOverviewChangedStage(FOUNDATIONS_STATE)).toBe("foundations");
    expect(resolveOverviewChangedStage(ACTIVE_SEQUENCE_STATE)).toBe("first-sequence");
  });
});

describe("Tooltip is fully readable and stays on screen (#10–#18)", () => {
  it("is responsive, never fixed-height, and never clips or clamps its copy", () => {
    const popover = CSS_SOURCE.slice(CSS_SOURCE.indexOf(".popover {"), CSS_SOURCE.indexOf(".popoverTop"));
    // ~400px desktop, always shrinking to fit the viewport.
    expect(popover).toContain("width: min(25rem, calc(100vw - 40px))");
    expect(popover).toContain("max-width: calc(100vw - 40px)");
    expect(popover).not.toMatch(/(^|[^-])height:\s*\d/);
    // Copy wraps naturally; nothing is clamped or ellipsised.
    expect(CSS_SOURCE).not.toMatch(/line-clamp/);
    expect(CSS_SOURCE).toMatch(/\.copy h2 \{[^}]*white-space: normal/s);
    expect(CSS_SOURCE).toMatch(/\.copy h2 \{[^}]*overflow-wrap: break-word/s);
    expect(CSS_SOURCE).toMatch(/\.copy p \{[^}]*white-space: normal/s);
    expect(CSS_SOURCE).toMatch(/\.copy p \{[^}]*overflow-wrap: break-word/s);
    // Only the body may scroll, so header + footer controls stay visible.
    expect(CSS_SOURCE).toMatch(/\.copy \{[^}]*overflow-y: auto/s);
    expect(CSS_SOURCE).toMatch(/\.popoverFooter \{[^}]*flex-shrink: 0/s);
    expect(CSS_SOURCE).toMatch(/\.popoverTop \{[^}]*flex-shrink: 0/s);
  });

  it("flips, shifts, and keeps a viewport gutter instead of hardcoding a spot", () => {
    expect(POSITION_SOURCE).toContain("export const VIEWPORT_GUTTER = 20");
    expect(POSITION_SOURCE).toContain("getPlacementOrder");
    expect(POSITION_SOURCE).toContain("resolvePlacement");
    expect(POSITION_SOURCE).toContain("detachedFallback");
    expect(POSITION_SOURCE).toMatch(/clamp\(left, safeLeft, maxLeft\)/);
    expect(POSITION_SOURCE).toMatch(/clamp\(top, VIEWPORT_GUTTER, maxTop\)/);
  });

  it("recalculates on scroll, resize, and sidebar collapse, and scrolls the target in", () => {
    expect(OVERLAY_SOURCE).toMatch(/addEventListener\("resize"/);
    expect(OVERLAY_SOURCE).toMatch(/addEventListener\("scroll"/);
    expect(OVERLAY_SOURCE).toContain("ResizeObserver");
    expect(OVERLAY_SOURCE).toContain("scrollIntoView");
    // The usable left edge is read from the live sidebar rect, never hardcoded.
    expect(OVERLAY_SOURCE).toContain('document.querySelector("aside.sidebar")');
    expect(OVERLAY_SOURCE).toContain("getBoundingClientRect()");
    expect(OVERLAY_SOURCE).not.toMatch(/292px|92px/);
    expect(OVERLAY_SOURCE).toContain("document.documentElement.clientWidth");
  });
});

describe("No backend work + no other guide changed (#31, #32)", () => {
  it("opening any guide triggers no backend mutations", () => {
    for (const source of [MANUAL_SOURCE, LAUNCHER_SOURCE, BUTTON_SOURCE]) {
      expect(source).not.toMatch(/fetch\(|graphql|prisma|useMutation|MUTATION|apify|openai/i);
    }
    expect(LAUNCHER_SOURCE).toMatch(/return null;/);
  });

  it("leaves Overview data calculations untouched — only data-* targets changed", () => {
    for (const fn of ["buildActivityItems", "summarizeOverviewRun", "buildSequenceOutcomePresentation"]) {
      expect(CENTER_SOURCE).toContain(fn);
    }
  });

  it("does not introduce Overview targets into unrelated manuals", () => {
    for (const path of ["/finder", "/imports", "/templates", "/campaigns", "/prospects"]) {
      const manual = getManualForPathname(path);
      expect(manual?.id).not.toBe("workspace");
      expect(manual?.helpVariant).not.toBe("simple");
      for (const step of manual?.steps ?? []) {
        expect(step.selector ?? "").not.toContain("data-overview-tour");
      }
    }
  });
});
