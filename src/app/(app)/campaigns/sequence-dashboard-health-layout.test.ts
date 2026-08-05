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
    sentLast24h: false,
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
    expect(PAGE).toContain("href={buildSequenceDetailHref(entry.id, dashboardReturnTo)}");
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

describe("overview grid keeps the metric cards and health panel aligned top and bottom", () => {
  it("the overview grid stretches its two columns to the same row height (#1, #2, #3)", () => {
    const overviewGridRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".overviewGrid {"),
      PAGE_CSS.indexOf(".summaryCards {")
    );
    expect(overviewGridRule).toContain("align-items: stretch;");
    expect(overviewGridRule).not.toMatch(/align-items:\s*start/);
  });

  it("the health panel gets a wider share of the row than before", () => {
    const overviewGridRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".overviewGrid {"),
      PAGE_CSS.indexOf(".summaryCards {")
    );
    expect(overviewGridRule).toContain("grid-template-columns: minmax(0, 12fr) minmax(340px, 13fr);");
  });

  it("summary cards use a fixed compact height, equal for all four, independent of the health panel", () => {
    const summaryCardRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".summaryCard {"),
      PAGE_CSS.indexOf(".summaryCard dt {")
    );
    // A single fixed `height` (not `min-height`/`100%`) guarantees all four
    // cards match regardless of unit-text length, and can never be inflated
    // by the health panel's own height.
    expect(summaryCardRule).toMatch(/height:\s*8\.5rem;/);
    expect(summaryCardRule).not.toMatch(/height:\s*100%/);
    expect(summaryCardRule).not.toContain("min-height");
  });

  it("the health panel keeps its own content top-anchored while stretching", () => {
    const healthPanelRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".healthPanel {"),
      PAGE_CSS.indexOf(".healthHeading {")
    );
    expect(healthPanelRule).toContain("align-content: start;");
  });
});

describe("compact card styling — not an oversized marketing panel", () => {
  it("metric cards and the health panel share a sharp radius and a light shadow, not the app's large surface shadow", () => {
    const summaryCardRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".summaryCard {"),
      PAGE_CSS.indexOf(".summaryCard dt {")
    );
    const healthPanelRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".healthPanel {"),
      PAGE_CSS.indexOf(".healthHeading {")
    );

    for (const rule of [summaryCardRule, healthPanelRule]) {
      expect(rule).toMatch(/border-radius:\s*12px;/);
      // Not the shared `var(--shadow)` used by large surfaces like .card —
      // this band uses its own smaller, flatter shadow.
      expect(rule).not.toContain("box-shadow: var(--shadow)");
      expect(rule).toContain("box-shadow:");
    }
  });

  it("issue rows use compact padding/radius, not the roomy defaults from a large card", () => {
    const healthItemRule = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".healthItem {"),
      PAGE_CSS.indexOf(".healthItem[data-severity=\"critical\"]")
    );
    expect(healthItemRule).toMatch(/border-radius:\s*9px;/);
    expect(healthItemRule).toMatch(/padding:\s*0\.6rem 0\.7rem;/);
  });

  it("colors are theme-variable driven only — no hardcoded light/dark variants for this band", () => {
    const overviewSection = PAGE_CSS.slice(
      PAGE_CSS.indexOf(".overviewGrid {"),
      PAGE_CSS.indexOf("@media (max-width: 1080px)")
    );
    // No literal hex/rgb backgrounds outside the pre-existing critical-red
    // accent (#e5484d) — every other color rides the theme's CSS variables,
    // so light and dark share one structure and only the variables differ.
    const hexColors = overviewSection.match(/#[0-9a-fA-F]{3,6}/g) ?? [];
    expect(hexColors.every((hex) => hex.toLowerCase() === "#e5484d")).toBe(true);
    expect(overviewSection).not.toMatch(/@media\s*\(prefers-color-scheme/);
    expect(overviewSection).not.toContain('data-theme=');
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
