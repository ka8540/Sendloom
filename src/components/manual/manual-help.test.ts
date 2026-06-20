import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import type { ManualStep } from "@/components/manual/manualTypes";

const BUTTON_SOURCE = readFileSync("src/components/manual/ManualButton.tsx", "utf8");
const OVERLAY_SOURCE = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
const PROVIDER_SOURCE = readFileSync("src/components/manual/ManualProvider.tsx", "utf8");
const CSS_SOURCE = readFileSync("src/components/manual/manual.module.css", "utf8");
const DASHBOARD_SOURCE = readFileSync("src/components/prospects/prospects-dashboard.tsx", "utf8");

function step(id: string, overrides: Partial<ManualStep> = {}): ManualStep {
  return { id, title: id, body: id, selector: `[data-x="${id}"]`, ...overrides };
}

describe("filterAvailableManualSteps", () => {
  it("keeps non-optional steps even when their target is missing", () => {
    const steps = [step("a"), step("b", { optional: false })];
    expect(filterAvailableManualSteps(steps, () => false).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("drops optional steps whose target is absent and keeps present ones", () => {
    const steps = [step("keep", { optional: true }), step("drop", { optional: true })];
    const filtered = filterAvailableManualSteps(steps, (selector) => selector === '[data-x="keep"]');
    expect(filtered.map((s) => s.id)).toEqual(["keep"]);
  });

  it("falls back to the full list rather than opening an empty tour", () => {
    const steps = [step("only", { optional: true })];
    expect(filterAvailableManualSteps(steps, () => false)).toHaveLength(1);
  });
});

describe("Help button reuses the shared control (#1, #2, #18)", () => {
  it("derives its accessible label and tooltip from the manual config", () => {
    expect(BUTTON_SOURCE).toContain("manual.helpLabel ?? \"Help\"");
    expect(BUTTON_SOURCE).toContain("manual.helpTooltip ?? \"Help\"");
    expect(BUTTON_SOURCE).toContain("aria-label={label}");
    expect(BUTTON_SOURCE).toContain('data-manual-help-button="true"');
  });

  it("is the single global help control — the dashboard adds no competing button", () => {
    expect(DASHBOARD_SOURCE).not.toContain("CircleHelp");
    expect(DASHBOARD_SOURCE).not.toContain("helpButton");
  });

  it("is fixed-position so the sidebar state never hides it (#16, #17)", () => {
    expect(CSS_SOURCE).toMatch(/\.helpButton\s*\{[^}]*position:\s*fixed/);
    expect(CSS_SOURCE).toMatch(/z-index:\s*72/);
  });
});

describe("Tour accessibility (#19, #20)", () => {
  it("closes on Escape", () => {
    expect(OVERLAY_SOURCE).toContain('event.key === "Escape"');
    expect(OVERLAY_SOURCE).toMatch(/Escape[\s\S]{0,120}skipManual\(\)/);
  });

  it("moves focus into the popover and returns it to the help button", () => {
    expect(OVERLAY_SOURCE).toContain("popoverRef.current?.focus()");
    expect(PROVIDER_SOURCE).toContain('[data-manual-help-button=\'true\']');
    expect(PROVIDER_SOURCE).toMatch(/button\.focus\(\)/);
  });

  it("renders the dialog role and keeps Skip/Next/Finish controls", () => {
    expect(OVERLAY_SOURCE).toContain('role="dialog"');
    expect(OVERLAY_SOURCE).toMatch(/Skip/);
    expect(OVERLAY_SOURCE).toMatch(/Finish/);
    expect(OVERLAY_SOURCE).toMatch(/Next/);
  });
});

describe("Provider persistence + opt-in behavior (#4, #5)", () => {
  it("persists completion with a stage- and version-scoped localStorage key", () => {
    expect(PROVIDER_SOURCE).toContain("window.localStorage");
    expect(PROVIDER_SOURCE).toMatch(/stageSuffix/);
    expect(PROVIDER_SOURCE).toMatch(/versionSuffix/);
  });

  it("lets a manual opt out of the generic auto-open and exposes stage controls", () => {
    expect(PROVIDER_SOURCE).toContain("manual.autoOpen === false");
    expect(PROVIDER_SOURCE).toContain("openManualStage");
    expect(PROVIDER_SOURCE).toContain("isStageComplete");
  });

  it("stores only completion booleans (no results/quota/email/token data)", () => {
    expect(PROVIDER_SOURCE).not.toMatch(/setItem\([^)]*(?:email|token|people|quota|results)/i);
  });
});

describe("Dashboard onboarding wiring (#3, #6, #8, #10)", () => {
  it("drives stage-aware auto-open through the shared manual context", () => {
    expect(DASHBOARD_SOURCE).toContain('from "@/components/manual/ManualProvider"');
    expect(DASHBOARD_SOURCE).toContain("useManual()");
    expect(DASHBOARD_SOURCE).toContain("openManualStage(stage)");
    expect(DASHBOARD_SOURCE).toContain("isStageComplete(stage)");
  });

  it("gates auto-open on state and never launches over a modal or in-flight process", () => {
    expect(DASHBOARD_SOURCE).toMatch(/pageState === "empty"/);
    expect(DASHBOARD_SOURCE).toMatch(/selectedView === "ready"/);
    expect(DASHBOARD_SOURCE).toMatch(/selectedSearch\?\.status === "DRAFT"/);
    expect(DASHBOARD_SOURCE).toMatch(/showNewSearch \|\| reviewOpen \|\| processingId/);
  });
});

describe("Stable tour targets exist on the dashboard", () => {
  const requiredTargets = [
    "page-intro",
    "quota",
    "refresh",
    "new-search",
    "search-history",
    "search-status",
    "company-summary",
    "people-summary",
    "email-format-summary",
    "company-details",
    "email-evidence",
    "refresh-ai",
    "source-url",
    "manual-format",
    "role-filters",
    "inferred-warning",
    "people-filter",
    "people-table",
    "people-pagination",
    "process-action",
    "copy-email",
    "profile-link",
    "selection",
    "bulk-actions",
    "delete"
  ];

  it.each(requiredTargets)("declares data-discover-tour=%s", (target) => {
    expect(DASHBOARD_SOURCE).toContain(`data-discover-tour="${target}"`);
  });

  it("marks the quota indicator with an unlimited/limited flag for stage copy", () => {
    expect(DASHBOARD_SOURCE).toContain('data-discover-quota="unlimited"');
    expect(DASHBOARD_SOURCE).toContain('data-discover-quota="limited"');
  });
});

describe("Existing Discover functionality is unchanged (#21, #22, #23)", () => {
  it("keeps the New search action and quota indicator", () => {
    expect(DASHBOARD_SOURCE).toContain("New search");
    expect(DASHBOARD_SOURCE).toContain("QuotaIndicator");
  });

  it("keeps the New search modal fields (help hooks only add small hints)", () => {
    expect(DASHBOARD_SOURCE).toContain("Company name");
    expect(DASHBOARD_SOURCE).toContain("Job titles");
    expect(DASHBOARD_SOURCE).toContain("Locations");
    expect(DASHBOARD_SOURCE).toContain("Create draft search");
    // The removed Max results input is not reintroduced.
    expect(DASHBOARD_SOURCE).not.toContain("Max results");
  });
});
