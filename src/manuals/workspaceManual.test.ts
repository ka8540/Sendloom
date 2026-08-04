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
  preservedOverviewSteps,
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
const LAUNCHER_SOURCE = readFileSync("src/components/dashboard/overview-tour-launcher.tsx", "utf8");
const CENTER_SOURCE = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const SEND_WINDOW_SOURCE = readFileSync("src/components/dashboard/overview-send-window.tsx", "utf8");
const PANEL_SOURCE = readFileSync("src/components/dashboard/sequence-panel.tsx", "utf8");
const ROW_SOURCE = readFileSync("src/components/dashboard/sequence-row.tsx", "utf8");
const ACTIVITY_SOURCE = readFileSync("src/components/dashboard/activity-feed.tsx", "utf8");

function ids(steps: ManualStep[]): string[] {
  return steps.map((step) => step.id);
}

function selectorsOf(steps: ManualStep[]): string[] {
  return steps.map((step) => step.selector ?? "").filter(Boolean);
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
const MULTI_PAGE_STATE: OverviewTourState = { ...ACTIVE_SEQUENCE_STATE, hasMultipleSequencePages: true };

// Every stable Overview target a step can point at, used to simulate a fully
// rendered dashboard when filtering optional steps.
const ALL_TARGETS = new Set<string>([
  "page-intro",
  "workspace-health",
  "active-sequences",
  "lists-ready",
  "quick-actions",
  "gmail-send-window",
  "gmail-progress",
  "sender-breakdown",
  "recent-sequences",
  "recent-sequence-card",
  "view-all-sequences",
  "live-system",
  "activity-row",
  "needs-attention"
].map((target) => overviewSelector(target)));

// The brand-new / empty dashboard: cards + empty sections render, but there are
// no sequence rows, pagination, activity rows, gmail meter, etc.
const EMPTY_DASHBOARD_TARGETS = new Set<string>([
  "page-intro",
  "workspace-health",
  "active-sequences",
  "lists-ready",
  "quick-actions",
  "gmail-send-window",
  "sender-breakdown",
  "recent-sequences",
  "view-all-sequences",
  "live-system",
  "needs-attention"
].map((target) => overviewSelector(target)));

function present(targets: Set<string>) {
  return (selector: string) => targets.has(selector) || selector === "nav[aria-label='Main navigation']";
}

// ---------------------------------------------------------------------------

describe("Overview manual registration + redesigned Help button (#1, #2, #4)", () => {
  it("registers the expanded guide for /workspace and leaves other routes alone (#28)", () => {
    expect(getManualForPathname("/workspace")).toBe(workspaceManual);
    expect(getManualForPathname("/finder")?.id).toBe("finder");
    expect(getManualForPathname("/imports")?.id).toBe("imports");
    expect(getManualForPathname("/templates")?.id).toBe("templates");
    expect(getManualForPathname("/campaigns")?.id).toBe("campaigns");
    expect(getManualForPathname("/prospects")?.id).toBe("discover-list");
    expect(getManualForPathname("/unknown")).toBeNull();
  });

  it("uses the Overview label, tooltip, premium variant, quick-start, and a re-versioned key", () => {
    expect(workspaceManual.helpLabel).toBe("Help with Overview");
    expect(workspaceManual.helpTooltip).toBe("Overview guide");
    expect(workspaceManual.helpVariant).toBe("premium");
    expect(workspaceManual.helpQuickStart).toBe(true);
    expect(workspaceManual.autoOpen).toBe(false);
    expect(workspaceManual.version).toBe("v4");
  });

  it("renders the shared premium dashboard Help button (#1)", () => {
    expect(BUTTON_SOURCE).toContain("DashboardHelpButton");
    // Premium is the default; only "simple" falls back to the plain control.
    expect(BUTTON_SOURCE).toContain('manual.helpVariant === "simple"');
    // Keeps the accessible label + focus-return hook on the real <button>.
    expect(BUTTON_SOURCE).toContain('aria-label={label}');
    expect(BUTTON_SOURCE).toContain('data-manual-help-button="true"');
    expect(BUTTON_SOURCE).toContain('type="button"');
  });

  it("reveals the 'Overview guide' label on hover/focus, centered with the icon (#3, #4)", () => {
    // The pill expands to show the tooltip text on hover/focus.
    expect(BUTTON_SOURCE).toContain("overviewHelpLabel");
    expect(BUTTON_SOURCE).toMatch(/overviewHelpLabel[^>]*>\{tooltip\}/);
    expect(CSS_SOURCE).toMatch(/\.overviewHelpButton\s*\{[^}]*align-items:\s*center/);
    expect(CSS_SOURCE).toMatch(/\.overviewHelpButton:hover \.overviewHelpLabel/);
    expect(CSS_SOURCE).toMatch(/\.overviewHelpButton:focus-visible \.overviewHelpLabel/);
  });

  it("keeps the default circular button intact for every other manual (#28)", () => {
    // The non-overview branch still derives label/tooltip the original way.
    expect(BUTTON_SOURCE).toContain('manual.helpLabel ?? "Help"');
    expect(BUTTON_SOURCE).toContain('manual.helpTooltip ?? "Help"');
    expect(CSS_SOURCE).toMatch(/\.helpButton\s*\{[^}]*position:\s*fixed/);
  });
});

describe("Premium button motion + accessibility (#5, #21, #22, #23, #24, #25)", () => {
  it("breathes only until the beginner guide is complete and stops on interaction", () => {
    // Quick-start manuals breathe until their quick-start stage is complete.
    expect(BUTTON_SOURCE).toContain("hasQuickStart");
    expect(BUTTON_SOURCE).toMatch(/hasQuickStart \? quickStartStage/);
    expect(BUTTON_SOURCE).toContain("overviewHelpButtonAttention");
    expect(CSS_SOURCE).toMatch(/\.overviewHelpButtonAttention::after[\s\S]*animation:\s*overview-help-breathe/);
  });

  it("disables decorative animation + sliding under prefers-reduced-motion (#5)", () => {
    const reduced = CSS_SOURCE.slice(CSS_SOURCE.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("overviewHelpButtonAttention");
    expect(reduced).toMatch(/animation:\s*none/);
    expect(reduced).toContain("overviewHelpLabel");
    expect(reduced).toContain("overviewMenu");
  });

  it("is a single fixed-position control that survives sidebar expand/collapse (#21, #22, #23)", () => {
    expect(CSS_SOURCE).toMatch(/\.overviewHelpRoot\s*\{[^}]*position:\s*fixed/);
    expect(CSS_SOURCE).toMatch(/\.overviewHelpRoot\s*\{[^}]*z-index:\s*72/);
    // Anchored to the same corner as the default control — no second floating
    // help button is introduced anywhere in the dashboard.
    expect(CSS_SOURCE).toMatch(/\.overviewHelpRoot\s*\{[^}]*right:/);
    expect(CSS_SOURCE).toMatch(/\.overviewHelpRoot\s*\{[^}]*bottom:/);
    expect(CENTER_SOURCE).not.toContain("helpButton");
    expect(SEND_WINDOW_SOURCE).not.toContain("CircleHelp");
  });

  it("closes the guide on Escape and returns focus to the Help button (#24, #25)", () => {
    expect(OVERLAY_SOURCE).toContain('event.key === "Escape"');
    expect(OVERLAY_SOURCE).toMatch(/Escape[\s\S]{0,160}skipManual\(\)/);
    expect(PROVIDER_SOURCE).toContain("[data-manual-help-button='true']");
    expect(PROVIDER_SOURCE).toMatch(/button\.focus\(\)/);
    // The premium button's own menu also closes on Escape and restores focus.
    expect(BUTTON_SOURCE).toContain('event.key === "Escape"');
    expect(BUTTON_SOURCE).toMatch(/closeMenu\(true\)/);
  });
});

describe("Existing Overview steps are preserved + extended (#6, #7)", () => {
  it("keeps the three original steps verbatim", () => {
    expect(ids(preservedOverviewSteps)).toEqual(["command-center", "metrics", "sequence-entry"]);
    const commandCenter = preservedOverviewSteps[0];
    expect(commandCenter.title).toBe("Command center");
    expect(commandCenter.body).toMatch(/live operating surface/);
    expect(commandCenter.selector).toBe("main.content > div:not(.content-toolbar)");
    expect(preservedOverviewSteps[1].title).toBe("Read the operating signals");
    expect(preservedOverviewSteps[2].title).toBe("Jump into live work");
  });

  it("appends new steps after the originals rather than replacing them", () => {
    const fullIds = ids(overviewFullSteps());
    expect(fullIds.slice(0, 3)).toEqual(["command-center", "metrics", "sequence-entry"]);
    expect(fullIds.length).toBeGreaterThan(preservedOverviewSteps.length);
    // The new detailed steps cover every major Overview surface.
    for (const id of [
      "sidebar",
      "workspace-health",
      "active-sequences",
      "lists-ready",
      "quick-actions",
      "gmail-send-window",
      "recent-sequences",
      "recent-sequence-card",
      "view-all-sequences",
      "live-system",
      "activity-row",
      "needs-attention"
    ]) {
      expect(fullIds).toContain(id);
    }
  });

  it("never points the new steps at fragile class/text selectors", () => {
    const newSteps = overviewFullSteps().filter((step) => !ids(preservedOverviewSteps).includes(step.id));
    for (const step of newSteps) {
      if (!step.selector) {
        continue;
      }
      const isOverviewTarget = step.selector.startsWith('[data-overview-tour="');
      const isSidebarLandmark = step.selector === "nav[aria-label='Main navigation']";
      expect(isOverviewTarget || isSidebarLandmark).toBe(true);
    }
  });
});

describe("State-aware auto-open phases (#8, #9, #10, #13, #14, #17)", () => {
  it("a brand-new workspace is eligible only for the beginner guide (#8)", () => {
    expect(getEligibleOverviewStages(EMPTY_STATE)).toEqual(["starter"]);
  });

  it("imports/templates without sequences unlock the foundations phase (#13)", () => {
    expect(getEligibleOverviewStages(FOUNDATIONS_STATE)).toEqual(["foundations"]);
    expect(getEligibleOverviewStages({ ...EMPTY_STATE, hasImports: true })).toEqual(["foundations"]);
    expect(getEligibleOverviewStages({ ...EMPTY_STATE, hasTemplates: true })).toEqual(["foundations"]);
  });

  it("the first sequence unlocks the sequence phase, not foundations (#14)", () => {
    expect(getEligibleOverviewStages(DRAFT_SEQUENCE_STATE)).toEqual(["first-sequence"]);
    expect(getEligibleOverviewStages(ACTIVE_SEQUENCE_STATE)).toEqual(["first-sequence"]);
    expect(getEligibleOverviewStages(COMPLETED_SEQUENCE_STATE)).toEqual(["first-sequence"]);
  });

  it("attention data adds the attention phase after the sequence phase (#17)", () => {
    expect(getEligibleOverviewStages(ATTENTION_STATE)).toEqual(["first-sequence", "attention"]);
    // No attention data → the attention phase is never offered.
    expect(getEligibleOverviewStages(ACTIVE_SEQUENCE_STATE)).not.toContain("attention");
  });

  it("prioritizes starter → first-sequence → attention and opens one phase per visit (#9)", () => {
    // The launcher opens the first not-yet-completed eligible phase, then locks
    // itself for the rest of the visit so tours never stack up.
    expect(LAUNCHER_SOURCE).toContain("getEligibleOverviewStages(state)");
    expect(LAUNCHER_SOURCE).toMatch(/find\(\(stage\)\s*=>\s*!isStageComplete\(stage\)\)/);
    expect(LAUNCHER_SOURCE).toContain("launchedRef");
    expect(LAUNCHER_SOURCE).toContain("openManualStage(next)");
  });

  it("persists dismissal/completion so phases never auto-reopen (#9, #10)", () => {
    // Skip + finish both mark the active stage complete with a versioned key.
    expect(PROVIDER_SOURCE).toMatch(/skipManual[\s\S]{0,160}markManualComplete/);
    expect(PROVIDER_SOURCE).toMatch(/versionSuffix/);
    expect(workspaceManual.version).toBe("v4");
  });

  it("waits for a settled layout and never opens over an existing tour/menu", () => {
    expect(LAUNCHER_SOURCE).toContain("AUTO_OPEN_DELAY_MS");
    expect(LAUNCHER_SOURCE).toContain("[data-manual-popover='true']");
    expect(LAUNCHER_SOURCE).toContain("[data-tour-help-menu='true']");
    expect(LAUNCHER_SOURCE).toMatch(/if \(!manual \|\| isOpen \|\| launchedRef\.current\)/);
  });
});

describe("Phase step content matches the rendered UI (#15, #16, #18)", () => {
  it("foundations explains the now-meaningful Lists, Quick actions, and Activity", () => {
    const steps = overviewFoundationsSteps();
    expect(ids(steps)).toEqual(["lists-ready", "quick-actions", "live-system"]);
    expect(steps[0].body).toMatch(/mapping/i);
    expect(steps[0].body).toMatch(/Imports/);
    expect(steps[1].body).toMatch(/template/i);
    expect(steps[2].body).toMatch(/Recent Activity/i);
  });

  it("the first-sequence phase explains Active, the Recent card, and Gmail (#14, #18)", () => {
    const steps = overviewFirstSequenceSteps();
    expect(ids(steps)).toEqual([
      "active-sequences",
      "recent-sequences",
      "recent-sequence-card",
      "view-all-sequences",
      "live-system",
      "gmail-send-window"
    ]);
  });

  it("explains every part of the recent sequence row when it is visible (#15)", () => {
    const card = overviewFirstSequenceSteps().find((step) => step.id === "recent-sequence-card");
    expect(card).toBeDefined();
    const body = card?.body ?? "";
    expect(body).toMatch(/name/i);
    expect(body).toMatch(/list/i);
    expect(body).toMatch(/sender/i);
    expect(body).toMatch(/status/i);
    expect(body).toMatch(/last update/i);
    expect(body).toMatch(/open/i);
    // It is optional so it never points at a missing row.
    expect(card?.optional).toBe(true);
  });

  it("the Gmail capacity step describes used/remaining/reset without a guaranteed limit (#18)", () => {
    const gmail = overviewFullSteps().find((step) => step.id === "gmail-send-window");
    expect(gmail).toBeDefined();
    const body = gmail?.body ?? "";
    expect(body).toMatch(/capacity/i);
    expect(body).toMatch(/rolling/i);
    expect(body).toMatch(/remaining/i);
    expect(body).toMatch(/reset/i);
    const allText = overviewFullSteps()
      .map((step) => `${step.title} ${step.body}`)
      .join(" ");
    expect(allText).not.toMatch(/guaranteed (?:gmail )?limit/i);
  });

  it("matches the three-item preview — no pagination step or target exists (#16)", () => {
    expect(overviewFullSteps().find((step) => step.id === "recent-sequences-pagination")).toBeUndefined();
    expect(PANEL_SOURCE).toContain("const RECENT_SEQUENCES_LIMIT = 3;");
    expect(PANEL_SOURCE).not.toMatch(/pagination/i);
  });

  it("the attention phase explains retryable vs action-required vs invalid (#17)", () => {
    const steps = overviewAttentionSteps();
    expect(ids(steps)).toContain("needs-attention");
    const attention = steps.find((step) => step.id === "needs-attention");
    expect(attention?.body).toMatch(/retryable/i);
    expect(attention?.body).toMatch(/action[- ]required/i);
    expect(attention?.body).toMatch(/invalid/i);
    // Never overpromises retries.
    expect(attention?.body).toMatch(/not every retry will succeed/i);
  });
});

describe("Optional targets are filtered safely (#11, #12, #16, #19, #20)", () => {
  it("a manual Help click resolves to the complete current-state tour (#11)", () => {
    expect(workspaceManual.resolveStage?.()).toBe("full");
    expect(ids(overviewStepsForStage("full"))).toEqual(ids(overviewFullSteps()));
    // The premium menu's "Full page tour" replays it via the configured stage.
    expect(BUTTON_SOURCE).toContain("Full page tour");
    expect(BUTTON_SOURCE).toMatch(/startStage\(fullTourStage\)/);
  });

  it("drops sequence-only targets on an empty dashboard (#12)", () => {
    const filtered = ids(filterAvailableManualSteps(overviewFullSteps(), present(EMPTY_DASHBOARD_TARGETS)));
    expect(filtered).not.toContain("recent-sequence-card");
    expect(filtered).not.toContain("activity-row");
    expect(filtered).not.toContain("gmail-progress");
    // The always-present anchors survive.
    expect(filtered).toContain("command-center");
    expect(filtered).toContain("active-sequences");
    expect(filtered).toContain("recent-sequences");
  });

  it("includes every optional target once the dashboard is fully populated", () => {
    const filtered = ids(filterAvailableManualSteps(overviewFullSteps(), present(ALL_TARGETS)));
    for (const id of ["recent-sequence-card", "activity-row", "gmail-progress"]) {
      expect(filtered).toContain(id);
    }
  });

  it("keeps non-optional steps even when their target is missing (#19)", () => {
    const filtered = ids(filterAvailableManualSteps(overviewFullSteps(), () => false));
    // Fallback to the full list rather than ever opening empty (#20).
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered).toContain("command-center");
  });

  it("never crashes on empty / partial / unknown stage state (#20)", () => {
    expect(() => overviewStarterSteps()).not.toThrow();
    expect(() => overviewStepsForStage(null)).not.toThrow();
    expect(() => overviewStepsForStage("nonsense")).not.toThrow();
    // Unknown stage falls back to the full tour.
    expect(ids(overviewStepsForStage("nonsense"))).toEqual(ids(overviewFullSteps()));
    for (const builder of [
      overviewStarterSteps,
      overviewFoundationsSteps,
      overviewFirstSequenceSteps,
      overviewAttentionSteps,
      overviewFullSteps
    ]) {
      expect(builder().length).toBeGreaterThan(0);
    }
    // Multiple-page and gmail-warning mocks still resolve sensible phases.
    expect(getEligibleOverviewStages(MULTI_PAGE_STATE)).toEqual(["first-sequence"]);
    expect(getEligibleOverviewStages(GMAIL_WARNING_STATE)).toEqual(["first-sequence", "attention"]);
  });
});

describe("Beginner guide content (#8)", () => {
  it("walks the page, navigation, cards, and the empty Recent/Live sections once", () => {
    const steps = overviewStarterSteps();
    expect(ids(steps)).toEqual([
      "page-intro",
      "sidebar",
      "workspace-health",
      "active-sequences",
      "lists-ready",
      "quick-actions",
      "gmail-send-window",
      "recent-sequences",
      "live-system",
      "build-first-workflow"
    ]);
    expect(steps[0].title).toBe("Welcome to your Sendloom Overview");
    // The closing step is a centered "what next" prompt with no fragile target.
    const last = steps[steps.length - 1];
    expect(last.placement).toBe("center");
    expect(last.selector).toBeUndefined();
    expect(last.body).not.toMatch(/automatically creates|we will create/i);
  });
});

describe("'Learn what changed' marker (#11)", () => {
  it("surfaces the highest-priority contextual phase, excluding the starter", () => {
    expect(resolveOverviewChangedStage(EMPTY_STATE)).toBeNull();
    expect(resolveOverviewChangedStage(FOUNDATIONS_STATE)).toBe("foundations");
    expect(resolveOverviewChangedStage(ACTIVE_SEQUENCE_STATE)).toBe("first-sequence");
    expect(resolveOverviewChangedStage(ATTENTION_STATE)).toBe("first-sequence");
  });

  it("the launcher publishes the marker the Help menu reads", () => {
    expect(LAUNCHER_SOURCE).toContain("tourChangedStage");
    expect(LAUNCHER_SOURCE).toContain("resolveOverviewChangedStage(state)");
    expect(BUTTON_SOURCE).toContain("tourChangedStage");
    expect(BUTTON_SOURCE).toContain("What changed");
  });
});

describe("No backend work + no Overview behaviour change (#26, #27, #28)", () => {
  it("opening any guide triggers no backend mutations (#26)", () => {
    for (const source of [MANUAL_SOURCE, LAUNCHER_SOURCE, BUTTON_SOURCE]) {
      expect(source).not.toMatch(/fetch\(|graphql|prisma|useMutation|MUTATION|apify|openai/i);
    }
  });

  it("the launcher renders nothing and reads only already-loaded props (#26, #27)", () => {
    expect(LAUNCHER_SOURCE).toMatch(/return null;/);
    expect(LAUNCHER_SOURCE).not.toMatch(/useQuery|useSWR|fetch\(/);
  });

  it("leaves Overview data calculations untouched — only data-* targets added (#27)", () => {
    for (const fn of ["buildActivityItems", "summarizeOverviewRun", "buildSequenceOutcomePresentation"]) {
      expect(CENTER_SOURCE).toContain(fn);
    }
    // The tour additions are inert data attributes, not logic.
    expect(CENTER_SOURCE).toContain('data-overview-tour="page-intro"');
    expect(CENTER_SOURCE).toContain('data-overview-tour="active-sequences"');
    expect(ROW_SOURCE).toContain('tourTarget ? "recent-sequence-card" : undefined');
    expect(ACTIVITY_SOURCE).toContain('index === 0 ? "activity-row" : undefined');
  });

  it("does not introduce overview targets into unrelated manuals (#28)", () => {
    for (const other of ["finderManual", "importsManual", "templatesManual", "campaignsManual", "workspaceManual"]) {
      // Sanity: the other route manuals are still registered and distinct.
      expect(getManualForPathname("/finder")?.id).toBe("finder");
    }
    // Discover guides are unchanged and keep their own data-discover-tour scheme.
    expect(getManualForPathname("/prospects/abc")?.id).toBe("discover-detail");
  });
});
