import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterAvailableManualSteps } from "@/components/manual/manualSteps";
import { getPopoverStyle, VIEWPORT_GUTTER, type HighlightRect } from "@/components/manual/overlayPosition";
import type { ManualStep } from "@/components/manual/manualTypes";
import { getManualForPathname } from "@/manuals";
import {
  finderChangedSteps,
  finderFullSteps,
  finderManual,
  finderQuickSteps
} from "@/manuals/finderManual";
import {
  discoverDetailManual,
  discoverDetailQuickSteps,
  discoverDetailStepsForStage,
  discoverListManual,
  discoverListQuickSteps,
  discoverListStepsForStage
} from "@/manuals/discoverManual";

const FINDER_SOURCE = readFileSync("src/manuals/finderManual.ts", "utf8");
const HUNTER_SOURCE = readFileSync("src/components/hunter-dashboard.tsx", "utf8");

function ids(steps: ManualStep[]): string[] {
  return steps.map((step) => step.id);
}

function allText(steps: ManualStep[]): string {
  return steps.map((step) => `${step.title} ${step.body}`).join(" ");
}

function rect(left: number, top: number, width: number, height: number): HighlightRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// ---------------------------------------------------------------------------
// Finder
// ---------------------------------------------------------------------------

describe("Finder uses the full Overview-style guide system (#1, #2, #3, #4)", () => {
  it("has the premium button, quick/full stages, and re-versioned persistence", () => {
    expect(finderManual.helpVariant).toBe("premium");
    expect(finderManual.helpQuickStart).toBe(true);
    expect(finderManual.quickStartStage).toBe("starter");
    expect(finderManual.fullTourStage).toBe("full");
    expect(finderManual.version).toBe("v2");
    expect(finderManual.helpLabel).toBe("Help with Finder");
    expect(finderManual.helpTooltip).toBe("Finder guide");
  });

  it("Quick start is short and Full page tour is longer and distinct (#3, #4)", () => {
    const quick = finderManual.resolveSteps?.("starter") ?? [];
    const full = finderManual.resolveSteps?.("full") ?? [];
    expect(quick.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(quick.length);
    expect(ids(finderQuickSteps())).toEqual(["page-intro", "mode-tabs", "full-name", "domain", "submit", "results"]);
  });
});

describe("Finder full tour covers every visible control (#6)", () => {
  it("includes intro, settings, tabs, fields, submit, results, and history", () => {
    const full = ids(finderFullSteps());
    for (const id of [
      "page-intro",
      "settings",
      "status",
      "mode-tabs",
      "find-email-tab",
      "domain-search-tab",
      "full-name",
      "domain",
      "submit",
      "results",
      "history"
    ]) {
      expect(full).toContain(id);
    }
  });

  it("the Finder page declares every stable target the guide points at", () => {
    for (const target of [
      "page-intro",
      "status",
      "settings",
      "mode-tabs",
      "find-email-tab",
      "domain-search-tab",
      "full-name",
      "domain",
      "submit",
      "results",
      "result-card",
      "copy",
      "history"
    ]) {
      // Targets may be static (data-finder-tour="x") or dynamic ({i===0 ? "x" :
      // undefined}); assert the quoted value appears either way.
      expect(HUNTER_SOURCE).toContain(`"${target}"`);
    }
  });
});

describe("Finder copy is product-safe (#7, #8, #9)", () => {
  it("never shows the old internal step or any implementation detail", () => {
    const text = allText([...finderQuickSteps(), ...finderFullSteps(), ...finderChangedSteps()]);
    expect(text).not.toMatch(/API key lives server-side/i);
    expect(text).not.toMatch(/api[ -]?key/i);
    expect(text).not.toMatch(/encrypt/i);
    expect(text).not.toMatch(/server-?side/i);
    expect(text).not.toMatch(/backend|proxy|hunter|provider|graphql|redis|token/i);
  });

  it("explains setup via Settings only, with safe wording (#10)", () => {
    const setupText = allText([...finderQuickSteps(), ...finderFullSteps()]).toLowerCase();
    expect(FINDER_SOURCE).toContain("Complete Finder setup");
    expect(setupText).toContain("settings");
    // The setup guidance never leaks how the connection is stored or proxied.
    expect(setupText).not.toMatch(/encrypt|server-side|backend|proxy|api key/);
  });
});

describe("Finder result steps are state-aware (#15, #16, #17)", () => {
  it("result + copy steps are optional, so they appear only once a result exists", () => {
    const resultCard = finderFullSteps().find((step) => step.id === "result-card");
    const copy = finderFullSteps().find((step) => step.id === "copy");
    expect(resultCard?.optional).toBe(true);
    expect(copy?.optional).toBe(true);
  });

  it("an empty Finder (no result targets) keeps the form steps and drops result steps", () => {
    const present = new Set(
      ['page-intro', 'settings', 'status', 'mode-tabs', 'find-email-tab', 'domain-search-tab', 'full-name', 'domain', 'submit', 'results'].map(
        (t) => `[data-finder-tour="${t}"]`
      )
    );
    const shown = ids(filterAvailableManualSteps(finderFullSteps(), (selector) => present.has(selector)));
    expect(shown).toContain("submit");
    expect(shown).toContain("results");
    expect(shown).not.toContain("result-card");
    expect(shown).not.toContain("copy");
  });

  it("the page publishes the 'what changed' marker once results exist (#13)", () => {
    expect(HUNTER_SOURCE).toContain("dataset.tourChangedStage");
    expect(HUNTER_SOURCE).toMatch(/results\.length > 0/);
  });
});

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

describe("Discover uses the same full guide menu, not just a pill (#1, #2, #3, #4)", () => {
  it("both Discover guides expose quick + full menu stages", () => {
    for (const manual of [discoverListManual, discoverDetailManual]) {
      expect(manual.helpVariant).toBe("premium");
      expect(manual.helpQuickStart).toBe(true);
      expect(manual.quickStartStage).toBe("quick");
      expect(manual.fullTourStage).toBe("full");
    }
    expect(getManualForPathname("/prospects")).toBe(discoverListManual);
    expect(getManualForPathname("/prospects/abc")).toBe(discoverDetailManual);
  });

  it("Quick start is shorter than the Full page tour on both Discover pages", () => {
    const listQuick = discoverListQuickSteps({ unlimited: false });
    const listFull = discoverListStepsForStage("full", { unlimited: false });
    expect(listQuick.length).toBeGreaterThan(0);
    expect(listFull.length).toBeGreaterThanOrEqual(listQuick.length);

    const detailQuick = discoverDetailQuickSteps();
    const detailFull = discoverDetailStepsForStage("ready");
    expect(detailQuick.length).toBeGreaterThan(0);
    expect(detailFull.length).toBeGreaterThan(detailQuick.length);
  });

  it("the list full tour still explains history, status, opening a row, and paging (#6, #7)", () => {
    const full = ids(discoverListStepsForStage("list", { unlimited: false }));
    expect(full).toEqual(expect.arrayContaining(["search-history", "search-status", "search-row", "history-pagination"]));
  });

  it("the detail full tour explains the People table and contact actions (#8, #9)", () => {
    const full = ids(discoverDetailStepsForStage("ready"));
    expect(full).toEqual(expect.arrayContaining(["people-table", "bulk-actions", "inferred-warning"]));
  });
});

// ---------------------------------------------------------------------------
// Shared placement: heading + sidebar safety
// ---------------------------------------------------------------------------

describe("Shared placement keeps the coachmark off the sidebar and on screen (#11, #12, #13, #14)", () => {
  const vp = { width: 1440, height: 900 };
  const pop = { width: 400, height: 320 };
  const SIDEBAR = 300;

  it("never places the coachmark over the sidebar when content space exists", () => {
    const targets: HighlightRect[] = [
      rect(330, 90, 520, 60), // a heading at the top of the content
      rect(330, 400, 200, 120), // a left-edge control (would prefer left → over sidebar)
      rect(1300, 300, 90, 120) // a right-edge control
    ];
    for (const placement of ["bottom", "left", "right", "top"] as const) {
      for (const target of targets) {
        const pos = getPopoverStyle(target, placement, vp, pop, SIDEBAR);
        expect(pos.left).toBeGreaterThanOrEqual(SIDEBAR - 0.5);
        expect(pos.left + pop.width).toBeLessThanOrEqual(vp.width - VIEWPORT_GUTTER + 0.5);
        expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER - 0.5);
        expect(pos.top + pop.height).toBeLessThanOrEqual(vp.height - VIEWPORT_GUTTER + 0.5);
      }
    }
  });

  it("the overlay measures the sidebar and scrolls with a safe top margin", () => {
    const overlay = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
    expect(overlay).toContain("getContentLeft");
    expect(overlay).toContain('querySelector("aside.sidebar")');
    expect(overlay).toContain('manual?.scrollBlock ?? "nearest"');
    const globals = readFileSync("src/app/globals.css", "utf8");
    expect(globals).toMatch(/\[data-finder-tour\][\s\S]*scroll-margin-top/);
  });
});
