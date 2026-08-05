import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getManualForPathname } from "@/manuals";
import { analysisFullSteps, analysisManual, analysisSelector } from "@/manuals/analysisManual";

const WORKSPACE_SOURCE = readFileSync("src/components/analysis/analysis-workspace.tsx", "utf8");
const OVERLAY_SOURCE = readFileSync("src/components/manual/ManualOverlay.tsx", "utf8");
const GLOBALS_SOURCE = readFileSync("src/app/globals.css", "utf8");

const ANALYSIS_ROUTES = [
  "/analysis",
  "/analysis/engagement",
  "/analysis/sequences",
  "/analysis/reliability",
  "/analysis/senders"
];

const EXPECTED_TITLES = [
  "Understand your outreach",
  "Start with Summary",
  "Review Engagement",
  "Compare Sequences",
  "Check Reliability",
  "Monitor Senders"
];

const EXPECTED_TARGETS = [
  "analysis-header",
  "analysis-tab-summary",
  "analysis-tab-engagement",
  "analysis-tab-sequences",
  "analysis-tab-reliability",
  "analysis-tab-senders"
];

describe("Analysis guide is registered on every Analysis route", () => {
  it.each(ANALYSIS_ROUTES)("resolves the analysis manual for %s", (path) => {
    const manual = getManualForPathname(path);
    expect(manual).toBe(analysisManual);
    expect(manual?.id).toBe("analysis");
    expect(manual?.helpLabel).toBe("Help with Analysis");
    expect(manual?.helpTooltip).toBe("Analysis guide");
    expect(manual?.helpVariant).not.toBe("simple");
  });

  it("never attaches the Analysis guide to unrelated routes", () => {
    expect(getManualForPathname("/workspace")?.id).toBe("workspace");
    expect(getManualForPathname("/analysis-preview")).toBeNull();
    expect(getManualForPathname("/unknown")).toBeNull();
  });
});

describe("The tour is exactly the six approved Analysis steps", () => {
  const steps = analysisFullSteps();

  it("contains exactly six steps in reading order", () => {
    expect(steps.map((step) => step.id)).toEqual([
      "analysis-introduction",
      "analysis-summary",
      "analysis-engagement",
      "analysis-sequences",
      "analysis-reliability",
      "analysis-senders"
    ]);
    expect(steps.map((step) => step.title)).toEqual(EXPECTED_TITLES);
  });

  it("every step targets a stable data-tour attribute with bottom placement", () => {
    expect(steps.map((step) => step.selector)).toEqual(EXPECTED_TARGETS.map((target) => analysisSelector(target)));
    for (const step of steps) {
      expect(step.selector).toMatch(/^\[data-tour="analysis-[a-z-]+"\]$/);
      expect(step.placement).toBe("bottom");
      expect(step.optional).toBeUndefined();
    }
  });

  it("every target exists in the Analysis workspace markup", () => {
    for (const target of EXPECTED_TARGETS) {
      expect(WORKSPACE_SOURCE).toContain(`"${target}"`);
    }
    expect(GLOBALS_SOURCE).toContain('[data-tour^="analysis-"]');
  });

  it("the full tour and a manual Help click resolve to the same six steps", () => {
    expect(analysisManual.steps.map((step) => step.id)).toEqual(steps.map((step) => step.id));
    expect(analysisManual.resolveStage?.()).toBe("full");
  });
});

describe("Analysis tour copy rules", () => {
  const steps = analysisFullSteps();
  const tourText = steps.map((step) => `${step.title} ${step.body}`).join(" ");

  it("introduces the workspace and briefly covers the date range and Export", () => {
    const intro = steps[0];
    expect(intro.body).toMatch(/outreach performance/i);
    expect(intro.body).toMatch(/date selector/i);
    expect(intro.body).toMatch(/last 7 or 30 days/);
    expect(intro.body).toMatch(/Export/);
  });

  it("explains each page rather than individual charts", () => {
    expect(steps[1].body).toMatch(/^Summary gives you a quick view of overall outreach performance/);
    expect(steps[2].body).toMatch(/^Engagement shows how recipients interact with your outreach/);
    expect(steps[3].body).toMatch(/^Sequences helps you compare outreach runs and templates/);
    expect(steps[4].body).toMatch(/^Reliability explains operational problems/);
    expect(steps[5].body).toMatch(/^Senders compares connected Gmail accounts/);
  });

  it("keeps every body short and uses the approved wording", () => {
    for (const step of steps) {
      const words = step.body.split(/\s+/).filter(Boolean);
      expect(words.length).toBeLessThanOrEqual(55);
    }
    // "confirmed sends", never "delivered"; "Gmail sender", never "mailbox profile".
    expect(tourText).toMatch(/confirmed sends/);
    expect(tourText).toMatch(/Gmail sender health/);
    expect(tourText).not.toMatch(/\bdelivered\b/i);
    expect(tourText).not.toMatch(/mailbox profile/i);
  });

  it("carries no stale or chart-level copy", () => {
    const banned = [
      "Analytics Pulse",
      "Sequence Health",
      "Command Center",
      "Template inventory",
      "System log",
      "operating signals",
      "Jump into live work",
      "Read the operating signals"
    ];
    for (const phrase of banned) {
      expect(tourText).not.toContain(phrase);
    }
    // No internal database fields or raw system-log language.
    expect(tourText).not.toMatch(/sender_profile|profile_id|created_at|updated_at|NULL|stack trace/i);
  });
});

describe("Analysis tour controls and behavior", () => {
  it("ends on Done and keeps the shared Skip + Next controls unchanged", () => {
    expect(analysisManual.finishLabel).toBe("Done");
    // No extra controls: the overlay renders only Skip and Next/Done.
    expect(OVERLAY_SOURCE).toContain("skipManual");
    expect(OVERLAY_SOURCE).toContain("nextStep");
    expect(OVERLAY_SOURCE).not.toContain("prevStep");
    expect(OVERLAY_SOURCE).not.toMatch(/>\s*Back\s*</);
    // Escape still closes the tour and the progress indicator is preserved.
    expect(OVERLAY_SOURCE).toContain('event.key === "Escape"');
    expect(OVERLAY_SOURCE).toContain("progressDot");
  });
});
