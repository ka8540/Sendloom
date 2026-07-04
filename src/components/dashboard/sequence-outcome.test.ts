import { describe, expect, it } from "vitest";

import { buildSequenceOutcomePresentation } from "@/components/dashboard/sequence-outcome";

describe("Overview recent sequence outcome", () => {
  it("shows invalid recipients as a neutral Skipped metric and footer", () => {
    const outcome = buildSequenceOutcomePresentation({ skipped: 28, needsAttention: 0 });

    expect(outcome.metric).toMatchObject({ key: "skipped", label: "Skipped", count: 28 });
    expect(outcome.metric.tone).toBeUndefined();
    expect(outcome.health).toMatchObject({ label: "28 skipped", tone: "skipped" });
    expect(outcome.health.ariaLabel).toContain("require no action");
  });

  it("keeps genuine action-required failures in Needs attention with warning tone", () => {
    const outcome = buildSequenceOutcomePresentation({ skipped: 0, needsAttention: 2 });

    expect(outcome.metric).toMatchObject({ label: "Needs attention", count: 2, tone: "issues" });
    expect(outcome.health).toMatchObject({ label: "2 need attention", tone: "issues" });
  });

  it("keeps skipped and actionable mixed counts separate", () => {
    const outcome = buildSequenceOutcomePresentation({ skipped: 20, needsAttention: 8 });

    expect(outcome.metric).toMatchObject({ label: "Needs attention", count: 8, tone: "issues" });
    expect(outcome.health).toMatchObject({ label: "20 skipped", tone: "skipped" });
  });
});
