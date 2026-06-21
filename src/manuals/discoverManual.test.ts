import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import type { ManualStep } from "@/components/manual/manualTypes";
import { getManualForPathname } from "@/manuals";
import {
  discoverDetailManual,
  discoverDetailStepsForStage,
  discoverDraftSteps,
  discoverFailedSteps,
  discoverListManual,
  discoverListStepsForStage,
  discoverPopulatedListSteps,
  discoverProcessingSteps,
  discoverReadySteps,
  discoverStarterSteps,
  resolveDiscoverListStage
} from "@/manuals/discoverManual";

const DISCOVER_SOURCE = readFileSync("src/manuals/discoverManual.ts", "utf8");

function ids(steps: ManualStep[]): string[] {
  return steps.map((step) => step.id);
}

function selectors(steps: ManualStep[]): string[] {
  return steps.map((step) => step.selector ?? "").filter(Boolean);
}

describe("Discover manual registration (list + detail)", () => {
  it("registers the list guide for /prospects and the detail guide for /prospects/[id]", () => {
    expect(getManualForPathname("/prospects")).toBe(discoverListManual);
    expect(getManualForPathname("/prospects/abc123")).toBe(discoverDetailManual);
    expect(getManualForPathname("/prospects/abc123/extra")).toBeNull();
  });

  it("uses the Discover help label/tooltip and bumps the version for the new structure", () => {
    for (const manual of [discoverListManual, discoverDetailManual]) {
      expect(manual.helpLabel).toBe("Help with Discover");
      expect(manual.helpTooltip).toBe("Discover guide");
      expect(manual.autoOpen).toBe(false);
      expect(manual.version).toBe("v2");
    }
    // The two guides are distinct persisted ids.
    expect(discoverListManual.id).toBe("discover-list");
    expect(discoverDetailManual.id).toBe("discover-detail");
  });

  it("does not change other route manuals", () => {
    expect(getManualForPathname("/finder")?.id).toBe("finder");
    expect(getManualForPathname("/campaigns")?.id).toBe("campaigns");
    expect(getManualForPathname("/campaigns/abc")?.id).toBe("campaign-detail");
    expect(getManualForPathname("/unknown")).toBeNull();
  });
});

describe("list stage resolution + steps", () => {
  it("is starter when there are no searches and list when there are", () => {
    expect(resolveDiscoverListStage({ hasSearches: false })).toBe("starter");
    expect(resolveDiscoverListStage({ hasSearches: true })).toBe("list");
  });

  it("starter steps cover intro, quota, new search, and the empty state", () => {
    const steps = discoverStarterSteps({ unlimited: false });
    expect(ids(steps)).toEqual(["page-intro", "quota", "refresh", "new-search", "empty-state"]);
    expect(selectors(steps)).toContain('[data-discover-tour="empty-state"]');
  });

  it("populated list steps explain Search History, status, opening a row, and paging", () => {
    const steps = discoverPopulatedListSteps({ unlimited: false });
    expect(ids(steps)).toEqual([
      "page-intro",
      "quota",
      "refresh",
      "new-search",
      "search-history",
      "search-status",
      "search-row",
      "history-pagination"
    ]);
    const open = steps.find((step) => step.id === "search-row");
    expect(open?.body).toMatch(/dedicated results page/i);
  });

  it("never references the People table on the list page", () => {
    const all = [...discoverStarterSteps({ unlimited: false }), ...discoverPopulatedListSteps({ unlimited: false })];
    expect(selectors(all)).not.toContain('[data-discover-tour="people-table"]');
    expect(selectors(all)).not.toContain('[data-discover-tour="company-details"]');
  });

  it("routes list stages to the matching builder", () => {
    expect(ids(discoverListStepsForStage("list", { unlimited: false }))).toEqual(ids(discoverPopulatedListSteps({ unlimited: false })));
    expect(ids(discoverListStepsForStage(null, { unlimited: false }))).toEqual(ids(discoverStarterSteps({ unlimited: false })));
  });

  it("shows unlimited quota copy without exposing limits", () => {
    const quota = discoverStarterSteps({ unlimited: true }).find((step) => step.id === "quota");
    expect(quota?.body).toMatch(/unlimited Discover access/i);
    expect(quota?.body).not.toMatch(/up to 10 people/i);
  });
});

describe("detail stage steps", () => {
  it("ready steps walk the workspace end to end", () => {
    const steps = discoverReadySteps();
    expect(ids(steps)).toEqual(
      expect.arrayContaining([
        "back-to-list",
        "detail-header",
        "company-summary",
        "people-summary",
        "email-format-summary",
        "status-summary",
        "company-details",
        "role-filters",
        "inferred-warning",
        "people-table",
        "people-pagination"
      ])
    );
  });

  it("marks state-dependent detail controls optional (#11 help)", () => {
    const optional = discoverReadySteps()
      .filter((step) => step.optional)
      .map((step) => step.id);
    for (const id of [
      "email-evidence",
      "refresh-ai",
      "source-url",
      "manual-format",
      "add-more-people",
      "people-filter",
      "people-selection",
      "copy-email",
      "profile-link",
      "bulk-actions",
      "delete-search"
    ]) {
      expect(optional).toContain(id);
    }
  });

  it("draft steps avoid result controls and explain processing cost", () => {
    const steps = discoverDraftSteps({ unlimited: false });
    expect(ids(steps)).toEqual(["back-to-list", "detail-header", "status-summary", "process-action", "quota"]);
    expect(selectors(steps)).not.toContain('[data-discover-tour="people-table"]');
    const process = steps.find((step) => step.id === "process-action");
    expect(process?.body).toMatch(/one daily Discover search/i);
    expect(process?.body).toMatch(/does not use another slot/i);
  });

  it("processing steps explain the wait without result controls", () => {
    const steps = discoverProcessingSteps();
    expect(ids(steps)).toEqual(["back-to-list", "detail-header", "status-summary"]);
    expect(steps.find((step) => step.id === "status-summary")?.body).toMatch(/collecting and preparing/i);
  });

  it("failed steps explain status and a safe retry, never provider details", () => {
    const steps = discoverFailedSteps();
    expect(ids(steps)).toContain("status-summary");
    const text = steps.map((step) => `${step.title} ${step.body}`).join(" ");
    expect(text).not.toMatch(/apify|openai|stack/i);
  });

  it("routes detail stages, defaulting unknown to a minimal safe guide", () => {
    expect(ids(discoverDetailStepsForStage("ready"))).toEqual(ids(discoverReadySteps()));
    expect(ids(discoverDetailStepsForStage("draft"))).toEqual(ids(discoverDraftSteps({ unlimited: false })));
    expect(ids(discoverDetailStepsForStage("processing"))).toEqual(ids(discoverProcessingSteps()));
    expect(ids(discoverDetailStepsForStage("failed"))).toEqual(ids(discoverFailedSteps()));
    expect(ids(discoverDetailStepsForStage(null))).toEqual(["back-to-list", "detail-header", "status-summary"]);
  });

  it("Add 10 More and bulk actions are explained only when their targets exist", () => {
    const steps = discoverReadySteps();
    // No add-more / bulk targets present → those optional steps are skipped.
    const present = new Set([
      '[data-discover-tour="back-to-list"]',
      '[data-discover-tour="detail-header"]',
      '[data-discover-tour="company-summary"]',
      '[data-discover-tour="people-summary"]',
      '[data-discover-tour="email-format-summary"]',
      '[data-discover-tour="status-summary"]',
      '[data-discover-tour="company-details"]',
      '[data-discover-tour="role-filters"]',
      '[data-discover-tour="inferred-warning"]',
      '[data-discover-tour="people-table"]',
      '[data-discover-tour="people-pagination"]'
    ]);
    const filtered = filterAvailableManualSteps(steps, (selector) => present.has(selector)).map((step) => step.id);
    expect(filtered).not.toContain("add-more-people");
    expect(filtered).not.toContain("bulk-actions");
    expect(filtered).toContain("people-table");
    // With every target present, the optional steps are included.
    const all = filterAvailableManualSteps(steps, () => true).map((step) => step.id);
    expect(all).toContain("add-more-people");
    expect(all).toContain("bulk-actions");
  });
});

describe("privacy + safety", () => {
  it("never names providers or claims inferred emails are verified", () => {
    const allSteps = [
      ...discoverStarterSteps({ unlimited: false }),
      ...discoverPopulatedListSteps({ unlimited: false }),
      ...discoverReadySteps(),
      ...discoverDraftSteps({ unlimited: false }),
      ...discoverProcessingSteps(),
      ...discoverFailedSteps()
    ];
    const text = allSteps.map((step) => `${step.title} ${step.body}`).join(" ");
    expect(text).not.toMatch(/apify|openai|graphql|scrap/i);
    // "inferred ... until verified" wording is fine; a bare "verified" claim is not.
    expect(text).not.toMatch(/\bare verified\b|\bis verified\b/i);
  });

  it("opening the tour triggers no backend calls", () => {
    expect(DISCOVER_SOURCE).not.toMatch(/fetch\(|prospectGraphql|graphql|apify|openai/i);
  });
});
