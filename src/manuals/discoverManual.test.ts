import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import { getManualForPathname } from "@/manuals";
import {
  discoverDraftSteps,
  discoverManual,
  discoverResultsSteps,
  discoverStarterSteps,
  discoverStepsForStage,
  resolveDiscoverStage
} from "@/manuals/discoverManual";

const DISCOVER_SOURCE = readFileSync("src/manuals/discoverManual.ts", "utf8");

function ids(steps: { id: string }[]): string[] {
  return steps.map((step) => step.id);
}

function selectors(steps: { selector?: string }[]): string[] {
  return steps.map((step) => step.selector ?? "").filter(Boolean);
}

describe("Discover manual registration (#1, #2)", () => {
  it("registers the Discover manual for the /prospects route", () => {
    expect(getManualForPathname("/prospects")).toBe(discoverManual);
  });

  it("uses the Discover-specific help label and tooltip", () => {
    expect(discoverManual.helpLabel).toBe("Help with Discover");
    expect(discoverManual.helpTooltip).toBe("Discover guide");
  });

  it("lets the dashboard drive auto-open and is versioned", () => {
    expect(discoverManual.autoOpen).toBe(false);
    expect(discoverManual.version).toBe("v1");
  });

  it("does not change other route manuals", () => {
    expect(getManualForPathname("/finder")?.id).toBe("finder");
    expect(getManualForPathname("/workspace")?.id).toBe("workspace");
    expect(getManualForPathname("/unknown-route")).toBeNull();
  });
});

describe("resolveDiscoverStage (#3, #8, #10)", () => {
  it("is the starter stage for a first-time empty dashboard", () => {
    expect(resolveDiscoverStage({ hasResults: false, hasSearches: false })).toBe("starter");
  });

  it("is the draft stage once searches exist but no results are open", () => {
    expect(resolveDiscoverStage({ hasResults: false, hasSearches: true })).toBe("draft");
  });

  it("is the results stage when a ready search is open", () => {
    expect(resolveDiscoverStage({ hasResults: true, hasSearches: true })).toBe("results");
  });
});

describe("starter steps (#7)", () => {
  it("explains the dashboard, New search, and Refresh", () => {
    const steps = discoverStarterSteps({ unlimited: false });
    expect(ids(steps)).toEqual(["page-intro", "quota", "new-search", "refresh", "starter-final"]);
    expect(selectors(steps)).toContain('[data-discover-tour="new-search"]');
    expect(selectors(steps)).toContain('[data-discover-tour="refresh"]');
    expect(steps[0].body).toMatch(/find professionals/i);
  });

  it("shows the ordinary daily allowance for limited accounts", () => {
    const quota = discoverStarterSteps({ unlimited: false }).find((step) => step.id === "quota");
    expect(quota?.body).toMatch(/up to 10 people/i);
    expect(quota?.body).toMatch(/4 Discover searches per day/i);
  });

  it("shows unlimited copy for exempt accounts without exposing limits", () => {
    const quota = discoverStarterSteps({ unlimited: true }).find((step) => step.id === "quota");
    expect(quota?.body).toMatch(/unlimited Discover access/i);
    expect(quota?.body).not.toMatch(/4 Discover searches per day/i);
  });

  it("never claims emails are verified or names providers", () => {
    const text = discoverStarterSteps({ unlimited: false })
      .map((step) => `${step.title} ${step.body}`)
      .join(" ");
    expect(text).not.toMatch(/verified/i);
    expect(text).not.toMatch(/apify|openai|graphql|scrap/i);
  });
});

describe("draft steps (#9)", () => {
  it("explains the draft, processing, and statuses", () => {
    const steps = discoverDraftSteps();
    expect(ids(steps)).toContain("draft-row");
    expect(ids(steps)).toContain("process");
    expect(ids(steps)).toContain("draft-status");
  });

  it("explains that processing consumes a daily search and retries do not", () => {
    const process = discoverDraftSteps().find((step) => step.id === "process");
    expect(process?.body).toMatch(/daily Discover searches/i);
    expect(process?.body).toMatch(/does not use another daily slot/i);
  });

  it("uses only real statuses and a safe cached-results note", () => {
    const status = discoverDraftSteps().find((step) => step.id === "draft-status");
    expect(status?.body).toMatch(/Draft/);
    expect(status?.body).toMatch(/Processing/);
    expect(status?.body).toMatch(/Ready/);
    expect(status?.body).toMatch(/Failed/);
    const cached = discoverDraftSteps().find((step) => step.id === "draft-cached");
    expect(cached?.body).not.toMatch(/cache|fingerprint|another user|provider/i);
  });
});

describe("results steps (#11, #12, #13)", () => {
  const steps = discoverResultsSteps();

  it("explains the summary cards", () => {
    expect(ids(steps)).toEqual(expect.arrayContaining(["company-summary", "people-summary", "email-format-summary", "results-status"]));
  });

  it("includes the inferred-not-verified warning", () => {
    const warning = steps.find((step) => step.id === "inferred-warning");
    expect(warning?.title).toMatch(/inferred/i);
    expect(warning?.body).toMatch(/verify them before using/i);
  });

  it("explains role filters and pagination", () => {
    expect(ids(steps)).toContain("role-filters");
    expect(ids(steps)).toContain("people-pagination");
  });

  it("marks state-dependent controls optional so they are skipped when absent (#14, #15)", () => {
    const optionalIds = steps.filter((step) => step.optional).map((step) => step.id);
    for (const id of ["refresh-ai", "source-url", "manual-format", "copy-email", "profile-link", "selection", "bulk-actions"]) {
      expect(optionalIds).toContain(id);
    }
    // Core review steps are always present (rendered centered if a target is missing).
    const requiredIds = steps.filter((step) => !step.optional).map((step) => step.id);
    expect(requiredIds).toEqual(expect.arrayContaining(["company-summary", "inferred-warning", "people-table"]));
  });
});

describe("discoverStepsForStage routing", () => {
  it("maps stage ids to the matching builders, defaulting to starter", () => {
    expect(ids(discoverStepsForStage("results", { unlimited: false }))).toEqual(ids(discoverResultsSteps()));
    expect(ids(discoverStepsForStage("draft", { unlimited: false }))).toEqual(ids(discoverDraftSteps()));
    expect(ids(discoverStepsForStage(null, { unlimited: false }))).toEqual(ids(discoverStarterSteps({ unlimited: false })));
  });
});

describe("availability filtering (#14, #15)", () => {
  it("skips optional steps whose targets are absent without throwing", () => {
    const steps = discoverResultsSteps();
    // Simulate a ready search with NO people rows and no optional buttons.
    const present = new Set(['[data-discover-tour="company-summary"]', '[data-discover-tour="people-table"]', '[data-discover-tour="inferred-warning"]']);
    const filtered = filterAvailableManualSteps(steps, (selector) => present.has(selector));
    const filteredIds = filtered.map((step) => step.id);
    expect(filteredIds).toContain("people-table");
    expect(filteredIds).toContain("inferred-warning");
    expect(filteredIds).not.toContain("copy-email");
    expect(filteredIds).not.toContain("bulk-actions");
  });

  it("keeps optional steps when their targets are present", () => {
    const steps = discoverResultsSteps();
    const filtered = filterAvailableManualSteps(steps, () => true);
    expect(filtered.map((step) => step.id)).toContain("copy-email");
  });

  it("never returns an empty tour", () => {
    expect(filterAvailableManualSteps(discoverStarterSteps({ unlimited: false }), () => false).length).toBeGreaterThan(0);
  });
});

describe("privacy + safety (#24)", () => {
  it("opening the tour triggers no backend calls", () => {
    expect(DISCOVER_SOURCE).not.toMatch(/fetch\(|prospectGraphql|graphql|apify|openai/i);
  });
});
