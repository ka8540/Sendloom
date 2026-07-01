import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import type { ManualStep } from "@/components/manual/manualTypes";

const BUTTON_SOURCE = readFileSync("src/components/manual/ManualButton.tsx", "utf8");
const OVERLAY_SOURCE = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
const PROVIDER_SOURCE = readFileSync("src/components/manual/ManualProvider.tsx", "utf8");
const CSS_SOURCE = readFileSync("src/components/manual/manual.module.css", "utf8");
const LIST_SOURCE = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
const DETAIL_SOURCE = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
const SHARED_SOURCE = readFileSync("src/components/prospects/prospects-shared.tsx", "utf8");
const ALL_DISCOVER_SOURCE = `${LIST_SOURCE}\n${DETAIL_SOURCE}\n${SHARED_SOURCE}`;

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

describe("Help button reuses the shared control (#1, #2)", () => {
  it("derives its accessible label and tooltip from the manual config", () => {
    expect(BUTTON_SOURCE).toContain("manual.helpLabel ?? \"Help\"");
    expect(BUTTON_SOURCE).toContain("manual.helpTooltip ?? \"Help\"");
    expect(BUTTON_SOURCE).toContain("aria-label={label}");
    expect(BUTTON_SOURCE).toContain('data-manual-help-button="true"');
  });

  it("is the single global help control — neither Discover page adds a competing button (#17)", () => {
    expect(ALL_DISCOVER_SOURCE).not.toContain("CircleHelp");
    expect(ALL_DISCOVER_SOURCE).not.toContain("helpButton");
  });

  it("is fixed-position so the sidebar state never hides it (#17)", () => {
    expect(CSS_SOURCE).toMatch(/\.helpButton\s*\{[^}]*position:\s*fixed/);
    expect(CSS_SOURCE).toMatch(/z-index:\s*72/);
  });
});

describe("Tour accessibility (#15, #16)", () => {
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

describe("Provider persistence + opt-in behavior (#13, #14)", () => {
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

describe("Discover onboarding wiring is split across list + detail (#3, #4)", () => {
  it("the list page drives starter/list auto-open through the shared manual context", () => {
    expect(LIST_SOURCE).toContain('from "@/components/manual/ManualProvider"');
    expect(LIST_SOURCE).toContain("useManual()");
    expect(LIST_SOURCE).toContain("openManualStage(stage)");
    expect(LIST_SOURCE).toContain("isStageComplete(stage)");
    expect(LIST_SOURCE).toMatch(/pageState === "empty"/);
    expect(LIST_SOURCE).toMatch(/"starter"/);
  });

  it("the detail page drives ready/draft/processing/failed auto-open and never over a modal/mutation", () => {
    expect(DETAIL_SOURCE).toContain("useManual()");
    expect(DETAIL_SOURCE).toContain("openManualStage(stage)");
    expect(DETAIL_SOURCE).toContain("resolveDetailStage(search)");
    expect(DETAIL_SOURCE).toMatch(/searchLoading \|\| notFound \|\| reviewOpen \|\| showAddMoreDialog \|\| processing/);
  });
});

describe("Stable tour targets exist on the correct Discover page", () => {
  // Targets may be set statically (data-discover-tour="x") or dynamically
  // ({cond ? "x" : undefined}); assert the quoted value appears in the source.
  const listSource = `${LIST_SOURCE}\n${SHARED_SOURCE}`;
  const listTargets = [
    "page-intro",
    "quota",
    "refresh",
    "new-search",
    "empty-state",
    "search-history",
    "search-status",
    "search-row",
    "history-pagination"
  ];

  it.each(listTargets)("list page declares the %s target", (target) => {
    expect(listSource).toContain(`"${target}"`);
  });

  const detailSource = `${DETAIL_SOURCE}\n${SHARED_SOURCE}`;
  const detailTargets = [
    "detail-header",
    "quality-summary",
    "quality-breakdown",
    "status-summary",
    "company-details",
    "email-evidence",
    "refresh-ai",
    "source-url",
    "manual-format",
    "add-more-people",
    "role-filters",
    "inferred-warning",
    "people-filter",
    "people-table",
    "people-selection",
    "copy-email",
    "profile-link",
    "bulk-actions",
    "people-pagination",
    "delete-search",
    "process-action"
  ];

  it.each(detailTargets)("detail page declares the %s target", (target) => {
    expect(detailSource).toContain(`"${target}"`);
  });

  it("the list page never exposes detail-only result targets", () => {
    expect(LIST_SOURCE).not.toContain('"people-table"');
    expect(LIST_SOURCE).not.toContain('"company-details"');
    expect(LIST_SOURCE).not.toContain('"add-more-people"');
  });

  it("marks the quota indicator with an unlimited/limited flag for stage copy", () => {
    expect(SHARED_SOURCE).toContain('data-discover-quota="unlimited"');
    expect(SHARED_SOURCE).toContain('data-discover-quota="limited"');
  });
});

describe("Existing Discover functionality is preserved on the right page", () => {
  it("keeps the New search action + quota on the list page", () => {
    expect(LIST_SOURCE).toContain("New search");
    expect(LIST_SOURCE).toContain("QuotaIndicator");
  });

  it("keeps the New search modal fields on the list page", () => {
    expect(LIST_SOURCE).toContain("Company name");
    expect(LIST_SOURCE).toContain("Job titles");
    expect(LIST_SOURCE).toContain("Locations");
    expect(LIST_SOURCE).toContain("Create draft search");
    expect(LIST_SOURCE).not.toContain("Max results");
  });

  it("keeps export, imports, delete, and add-more on the detail page", () => {
    expect(DETAIL_SOURCE).toContain("Download Excel");
    expect(DETAIL_SOURCE).toContain("Add to Imports");
    expect(DETAIL_SOURCE).toContain("PREPARE_PROSPECT_EXPORT_MUTATION");
    expect(DETAIL_SOURCE).toContain("CREATE_PROSPECT_IMPORT_MUTATION");
    expect(DETAIL_SOURCE).toContain("DELETE_COMPANY_MUTATION");
    expect(DETAIL_SOURCE).toContain("ADD_MORE_DISCOVER_PEOPLE_MUTATION");
  });
});
