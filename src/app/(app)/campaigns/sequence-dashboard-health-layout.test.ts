import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSequenceAttentionItems, type SequenceListItem } from "@/lib/sequence-dashboard";

// Focused coverage for the Sequences dashboard overview band: the health
// panel must cap its visible issue rows so a busy workspace never stretches
// the compact metric cards next to it. Server component, so PAGE/CSS are
// asserted as source (not rendered) — the logic-level slicing/derivation is
// covered by executing the real buildSequenceAttentionItems.

const PAGE = readFileSync("src/app/(app)/campaigns/page.tsx", "utf8");
const PAGE_CSS = readFileSync("src/app/(app)/campaigns/page.module.css", "utf8");

function makeItem(overrides: Partial<SequenceListItem> = {}): SequenceListItem {
  return {
    id: "seq-1",
    name: "April founder outreach",
    campaignStatus: "COMPLETED",
    latestRunStatus: "COMPLETED",
    listName: "Founders list",
    templateName: "Founder intro",
    senderName: "Kush Ahir",
    senderEmail: "kush@example.com",
    enrolledCount: 30,
    healthPercent: 77,
    progressPercent: 100,
    failedCount: 0,
    invalidCount: 0,
    deliveredCount: 23,
    opensCount: 9,
    repliedCount: 1,
    createdAtIso: "2026-05-02T10:00:00.000Z",
    updatedAtIso: "2026-06-02T10:00:00.000Z",
    ...overrides
  };
}

describe("health panel visible-issue cap", () => {
  it("caps visible rows at 2 regardless of how many sequences need attention (#1, #4)", () => {
    expect(PAGE).toContain("const HEALTH_PANEL_VISIBLE_LIMIT = 2;");
    expect(PAGE).toContain("attentionItems.slice(0, HEALTH_PANEL_VISIBLE_LIMIT)");
    expect(PAGE).not.toMatch(/attentionItems\.slice\(0,\s*[3-9]\)/);
  });

  it("shows the +N more line only when issues exceed the visible cap (#2, #3)", () => {
    expect(PAGE).toContain("const hiddenAttentionCount = attentionItems.length - visibleAttentionItems.length;");
    expect(PAGE).toContain("hiddenAttentionCount > 0 ? (");
    expect(PAGE).toContain("+{hiddenAttentionCount} more under the Needs attention filter below.");
  });

  it("real data: 16 attention items renders exactly 2 visible + 14 hidden", () => {
    const items = Array.from({ length: 16 }, (_, index) =>
      makeItem({ id: `seq-${index}`, name: `Sequence ${index}`, failedCount: 1 })
    );
    const attentionItems = buildSequenceAttentionItems(items);
    expect(attentionItems).toHaveLength(16);

    const visible = attentionItems.slice(0, 2);
    const hidden = attentionItems.length - visible.length;
    expect(visible).toHaveLength(2);
    expect(hidden).toBe(14);
  });

  it("exactly 2 issues: no +more line, both visible", () => {
    const items = [
      makeItem({ id: "a", failedCount: 1 }),
      makeItem({ id: "b", invalidCount: 2 })
    ];
    const attentionItems = buildSequenceAttentionItems(items);
    const visible = attentionItems.slice(0, 2);
    const hidden = attentionItems.length - visible.length;
    expect(visible).toHaveLength(2);
    expect(hidden).toBe(0);
  });

  it("no issues renders the all-clear state, not an empty list (#4)", () => {
    expect(buildSequenceAttentionItems([makeItem()])).toEqual([]);
    expect(PAGE).toContain("styles.healthAllClear");
    expect(PAGE).toContain("All clear");
    expect(PAGE).toContain("No sequences need attention right now.");
  });

  it("issue rows stay compact — name, short detail, review link, severity badge (#5, #6)", () => {
    expect(PAGE).toContain("href={`/campaigns/${entry.id}`}");
    expect(PAGE).toContain("Review sequence");
    expect(PAGE).toContain('{entry.severity === "critical" ? "Critical" : "Warning"}');
    // No long-paragraph markup: the detail is a single derived sentence, not
    // a block of copy — buildSequenceAttentionItems joins short parts only.
    const detail = buildSequenceAttentionItems([
      makeItem({ id: "x", failedCount: 21 })
    ])[0].detail;
    expect(detail.length).toBeLessThan(60);
  });
});

describe("overview grid no longer stretches metric cards to health panel height", () => {
  it("the overview grid top-aligns its two columns instead of stretching (#1, #2, #3)", () => {
    const overviewGridRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".overviewGrid {"),
      PAGE_CSS.indexOf(".summaryCards {")
    );
    expect(overviewGridRule).toContain("align-items: start;");
    expect(overviewGridRule).not.toMatch(/align-items:\s*stretch/);
  });

  it("summary cards keep a compact, consistent min-height independent of the health panel", () => {
    const summaryCardRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".summaryCard {"),
      PAGE_CSS.indexOf(".summaryCard dt {")
    );
    expect(summaryCardRule).toContain("min-height:");
    expect(summaryCardRule).not.toMatch(/height:\s*100%/);
  });

  it("the health panel still sizes to its own content only", () => {
    const healthPanelRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".healthPanel {"),
      PAGE_CSS.indexOf(".healthHeading {")
    );
    expect(healthPanelRule).toContain("align-content: start;");
    expect(healthPanelRule).not.toMatch(/height:\s*100%/);
  });
});

describe("scope guards", () => {
  it("no create-sequence or detail-page files are referenced by this change", () => {
    expect(PAGE).not.toContain("<CampaignBuilder");
    expect(PAGE).not.toContain("CampaignSetupEditor");
  });

  it("the page still only reads data — no mutations, no schema use", () => {
    expect(PAGE).not.toMatch(/prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/);
  });
});
