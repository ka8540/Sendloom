import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SEQUENCE_FILTERS,
  SEQUENCE_PAGE_SIZE,
  SEQUENCE_TONE_LABELS,
  countSequenceFilters,
  describeSequencePagePreview,
  filterSequenceItems,
  getSequenceStatusFlags,
  paginateSequenceItems,
  primarySequenceTone,
  sequenceMatchesFilter,
  sequenceMatchesSearch,
  type SequenceListItem
} from "@/lib/sequence-dashboard";

// Unit tests for the sequence-dashboard view logic plus node-only source
// assertions for the redesigned Sequences page (server components are not
// renderable in the node test env). Covers: page structure (form on top,
// compact sender panel, dashboard below), filters with counts, search,
// 5-per-page pagination, minimal list rows, empty states, the route loading
// skeleton, the detail-page visual cards, and the no-backend-change guards.

const PAGE = readFileSync("src/app/(app)/campaigns/page.tsx", "utf8");
const PAGE_CSS = readFileSync("src/app/(app)/campaigns/page.module.css", "utf8");
const DASH = readFileSync("src/app/(app)/campaigns/sequence-dashboard.tsx", "utf8");
const DASH_CSS = readFileSync("src/app/(app)/campaigns/sequence-dashboard.module.css", "utf8");
const LOGIC = readFileSync("src/lib/sequence-dashboard.ts", "utf8");
const LOADING = readFileSync("src/app/(app)/campaigns/loading.tsx", "utf8");
const LOADING_CSS = readFileSync("src/app/(app)/campaigns/loading.module.css", "utf8");
const DETAIL = readFileSync("src/app/(app)/campaigns/[id]/page.tsx", "utf8");
const DETAIL_CSS = readFileSync("src/app/(app)/campaigns/[id]/page.module.css", "utf8");

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
    issueCount: 0,
    ...overrides
  };
}

describe("status mapping (#4)", () => {
  it("maps campaign and run statuses onto the real enum values", () => {
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "RUNNING", latestRunStatus: null })).active).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "WAITING_FOR_SLOT" })).active).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ latestRunStatus: "QUEUED" })).active).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "PAUSED" })).paused).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ latestRunStatus: "PAUSED" })).paused).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "FAILED" })).attention).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ latestRunStatus: "FAILED" })).attention).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ issueCount: 3 })).attention).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "COMPLETED" })).completed).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "SCHEDULED" })).scheduled).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "VALIDATED" })).scheduled).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "DRAFT", latestRunStatus: null })).draft).toBe(true);
  });

  it("keeps cancelled sequences visible only under All", () => {
    const cancelled = makeItem({ campaignStatus: "CANCELLED", latestRunStatus: "CANCELLED" });
    expect(sequenceMatchesFilter(cancelled, "all")).toBe(true);
    for (const filter of ["active", "paused", "attention", "completed", "scheduled", "draft"] as const) {
      expect(sequenceMatchesFilter(cancelled, filter)).toBe(false);
    }
  });

  it("filters are overlapping predicates — a completed run with failures shows under both", () => {
    const item = makeItem({ campaignStatus: "COMPLETED", latestRunStatus: "COMPLETED", issueCount: 2 });
    expect(sequenceMatchesFilter(item, "completed")).toBe(true);
    expect(sequenceMatchesFilter(item, "attention")).toBe(true);
  });

  it("assigns one primary tone with attention taking priority", () => {
    expect(primarySequenceTone(makeItem({ issueCount: 2 }))).toBe("attention");
    expect(primarySequenceTone(makeItem({ campaignStatus: "PAUSED" }))).toBe("paused");
    expect(primarySequenceTone(makeItem({ campaignStatus: "RUNNING" }))).toBe("active");
    expect(primarySequenceTone(makeItem())).toBe("completed");
    expect(primarySequenceTone(makeItem({ campaignStatus: "SCHEDULED", latestRunStatus: null }))).toBe("scheduled");
    expect(primarySequenceTone(makeItem({ campaignStatus: "DRAFT", latestRunStatus: null }))).toBe("draft");
    expect(SEQUENCE_TONE_LABELS.attention).toBe("Needs attention");
  });
});

describe("filter counts (#4, #5)", () => {
  const items = [
    makeItem({ id: "a", campaignStatus: "RUNNING", latestRunStatus: "RUNNING" }),
    makeItem({ id: "b", campaignStatus: "PAUSED", latestRunStatus: "PAUSED" }),
    makeItem({ id: "c", campaignStatus: "COMPLETED", issueCount: 1 }),
    makeItem({ id: "d", campaignStatus: "COMPLETED" }),
    makeItem({ id: "e", campaignStatus: "SCHEDULED", latestRunStatus: null })
  ];

  it("counts every overlapping bucket from real flags", () => {
    const counts = countSequenceFilters(items);
    expect(counts.all).toBe(5);
    expect(counts.active).toBe(1);
    expect(counts.paused).toBe(1);
    expect(counts.attention).toBe(1);
    expect(counts.completed).toBe(2);
    expect(counts.scheduled).toBe(1);
    expect(counts.draft).toBe(0);
  });

  it("clicking a filter narrows the visible list", () => {
    expect(filterSequenceItems(items, "paused", "").map((item) => item.id)).toEqual(["b"]);
    expect(filterSequenceItems(items, "completed", "").map((item) => item.id)).toEqual(["c", "d"]);
    expect(filterSequenceItems(items, "all", "")).toHaveLength(5);
  });
});

describe("search (#6, #7)", () => {
  const item = makeItem({
    name: "Verkada Recruiters List",
    listName: "Verkada Recruiters",
    templateName: "Verkada Recruiter Temp",
    senderName: "Kush Jayesh Ahir",
    senderEmail: "kush.ahir2024@gmail.com"
  });

  it("matches name, list, template, sender name, and sender email", () => {
    expect(sequenceMatchesSearch(item, "verkada rec")).toBe(true);
    expect(sequenceMatchesSearch(item, "recruiter temp")).toBe(true);
    expect(sequenceMatchesSearch(item, "kush.ahir2024")).toBe(true);
    expect(sequenceMatchesSearch(item, "jayesh")).toBe(true);
    expect(sequenceMatchesSearch(item, "blackrock")).toBe(false);
  });

  it("is case-insensitive and trim-safe", () => {
    expect(sequenceMatchesSearch(item, "  VERKADA  ")).toBe(true);
    expect(sequenceMatchesSearch(item, "\tKuSh\n")).toBe(true);
  });

  it("an empty or whitespace query matches everything", () => {
    expect(sequenceMatchesSearch(item, "")).toBe(true);
    expect(sequenceMatchesSearch(item, "   ")).toBe(true);
  });

  it("search and filter combine", () => {
    const items = [
      makeItem({ id: "a", name: "Verkada SDE", campaignStatus: "PAUSED" }),
      makeItem({ id: "b", name: "Verkada Recruiters", campaignStatus: "COMPLETED" }),
      makeItem({ id: "c", name: "Ciena SDE", campaignStatus: "PAUSED" })
    ];
    expect(filterSequenceItems(items, "paused", "verkada").map((item) => item.id)).toEqual(["a"]);
    expect(filterSequenceItems(items, "paused", "")).toHaveLength(2);
    expect(filterSequenceItems(items, "all", "verkada")).toHaveLength(2);
  });
});

describe("pagination (#8, #9)", () => {
  const items = Array.from({ length: 12 }, (_, index) =>
    makeItem({ id: `seq-${index}`, name: `Sequence ${index}` })
  );

  it("shows exactly five sequences per page", () => {
    expect(SEQUENCE_PAGE_SIZE).toBe(5);
    const slice = paginateSequenceItems(items, 1);
    expect(slice.pageItems).toHaveLength(5);
    expect(slice.totalPages).toBe(3);
    expect(slice.rangeLabel).toBe("Showing 1–5 of 12");
  });

  it("slices later pages and labels the partial last page", () => {
    expect(paginateSequenceItems(items, 2).pageItems.map((item) => item.id)).toEqual([
      "seq-5",
      "seq-6",
      "seq-7",
      "seq-8",
      "seq-9"
    ]);
    expect(paginateSequenceItems(items, 3).rangeLabel).toBe("Showing 11–12 of 12");
  });

  it("clamps out-of-range pages instead of showing an empty slice", () => {
    expect(paginateSequenceItems(items, 99).page).toBe(3);
    expect(paginateSequenceItems(items, 0).page).toBe(1);
    expect(paginateSequenceItems([], 4).rangeLabel).toBe("No sequences to show");
  });

  it("describes the target page for prev/next hover previews", () => {
    const preview = describeSequencePagePreview([
      makeItem({ id: "a" }),
      makeItem({ id: "b", campaignStatus: "PAUSED" }),
      makeItem({ id: "c", issueCount: 1 })
    ]);
    expect(preview).not.toBeNull();
    expect(preview!.headline).toBe("3 sequences");
    expect(preview!.breakdown).toBe("1 needs attention · 1 paused · 1 completed");
    expect(describeSequencePagePreview([])).toBeNull();
  });
});

describe("page structure (#1, #2, #3)", () => {
  it("keeps the create-sequence form at the top, dashboard below", () => {
    const builderIndex = PAGE.indexOf("styles.builderCard");
    const dashboardIndex = PAGE.indexOf("<SequenceDashboard");
    expect(builderIndex).toBeGreaterThan(-1);
    expect(dashboardIndex).toBeGreaterThan(builderIndex);
    expect(PAGE).toContain('id="create-sequence"');
    expect(PAGE).toContain("Create a sequence");
  });

  it("renders the Send from Gmail panel compactly — sender, status chip, connect button", () => {
    expect(PAGE).toContain("styles.senderPanel");
    expect(PAGE).toContain("styles.senderChip}>Connected</span>");
    expect(PAGE).toContain("Connect another Gmail");
    // The old tall-card copy is gone and the panel hugs its content.
    expect(PAGE).not.toContain("Connected senders can launch sequences right away");
    const senderPanelCss = PAGE_CSS.slice(PAGE_CSS.indexOf(".senderPanel {"));
    expect(senderPanelCss).toContain("align-self: start;");
  });

  it("the old board and summary-card deck are gone from the route", () => {
    expect(PAGE).not.toContain("SequenceBoard");
    expect(PAGE).not.toContain("summaryGrid");
    expect(PAGE).not.toContain("sequenceCards");
  });
});

describe("dashboard component (#4, #5, #6, #9, #10)", () => {
  it("filters render as aria-pressed buttons with live counts", () => {
    expect(DASH).toContain("aria-pressed={filter === entry.id}");
    expect(DASH).toContain("{formatCount(counts[entry.id])}");
    expect(DASH).toContain('from "@/lib/sequence-dashboard"');
    expect(SEQUENCE_FILTERS.map((entry) => entry.id)).toEqual([
      "all",
      "active",
      "paused",
      "attention",
      "completed",
      "scheduled",
      "draft"
    ]);
  });

  it("search has an accessible label and resets pagination", () => {
    expect(DASH).toContain('aria-label="Search sequences by name, list, template, or sender"');
    const searchHandler = DASH.slice(DASH.indexOf("function onSearchChange"), DASH.indexOf("function clearFilters"));
    expect(searchHandler).toContain("setPage(1)");
    const filterHandler = DASH.slice(DASH.indexOf("function selectFilter"), DASH.indexOf("function onSearchChange"));
    expect(filterHandler).toContain("setPage(1)");
  });

  it("pages change on click only — hover previews are informational tooltips", () => {
    expect(DASH).toContain("onClick={() => setPage(slice.page + 1)}");
    expect(DASH).toContain("onClick={() => setPage(slice.page - 1)}");
    expect(DASH).toContain('role="tooltip"');
    expect(DASH).not.toContain("onMouseEnter");
    expect(DASH).toContain('aria-label="Next page"');
    expect(DASH).toContain('aria-label="Previous page"');
    expect(DASH).toContain("Page {slice.page} of {slice.totalPages}");
    expect(DASH).toContain("{slice.rangeLabel}");
  });

  it("each row opens the detail page and keeps the existing delete action", () => {
    expect(DASH).toContain("href={`/campaigns/${item.id}`}");
    expect(DASH).toContain("aria-label={`Open sequence ${item.name}`}");
    expect(DASH).toContain("<CampaignCardActions campaignId={item.id} campaignName={item.name} />");
  });

  it("rows stay minimal — no detail-page facts crammed into the list", () => {
    // The row template renders name, one list chip, health, enrolled, and the
    // status pill. Validation timestamps, schedule labels, and run history
    // stay on the detail page.
    expect(DASH).not.toContain("Validated");
    expect(DASH).not.toContain("Send timing");
    expect(DASH).not.toContain("Latest run");
    expect(DASH).not.toContain("LocalDateTime");
    expect(DASH).not.toContain("<aside");
  });

  it("summary values render in the dashboard header", () => {
    expect(DASH).toContain('aria-label="Sequence summary"');
    for (const label of ["<dt>Total</dt>", "<dt>Active</dt>", "<dt>Needs attention</dt>", "<dt>Completed</dt>"]) {
      expect(DASH).toContain(label);
    }
  });
});

describe("empty states (#12)", () => {
  it("a workspace with no sequences gets the starter empty state", () => {
    expect(DASH).toContain("No sequences yet");
    expect(DASH).toContain("Create your first sequence or import a list to get started.");
    expect(DASH).toContain('href="#create-sequence"');
    expect(DASH).toContain('href="/imports"');
  });

  it("an empty filter result offers to clear filters", () => {
    expect(DASH).toContain("No sequences match this filter");
    expect(DASH).toContain("Try another status or clear search.");
    expect(DASH).toContain("Clear filters");
    expect(DASH).toContain("onClick={clearFilters}");
  });
});

describe("loading skeleton (#13)", () => {
  it("announces loading accessibly with no spinner-only state", () => {
    expect(LOADING).toContain('role="status"');
    expect(LOADING).toContain('aria-busy="true"');
    expect(LOADING).toContain("srOnly");
    expect(LOADING_CSS).not.toMatch(/rotate\(360deg\)|animation:[^;]*\bspin\b/);
  });

  it("mirrors the real layout: form, sender panel, header, filters, five rows, pagination", () => {
    for (const piece of [
      "builderCard",
      "senderPanel",
      "dashboardHeader",
      "filterRail",
      "search",
      "paginationBar"
    ]) {
      expect(LOADING).toContain(piece);
    }
    expect(LOADING).toContain("Array.from({ length: 5 })");
    // CSS-only server component — zero client JS or heavy animation libraries.
    expect(LOADING).not.toContain('"use client"');
    expect(LOADING).not.toMatch(/useState|useEffect|three|gsap|lottie|framer-motion/i);
    expect(LOADING_CSS).toContain("sequences-skeleton-shimmer");
  });

  it("respects reduced motion", () => {
    const reduced = LOADING_CSS.slice(LOADING_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation:\s*none/);
    const reducedDash = DASH_CSS.slice(DASH_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedDash).toMatch(/transition:\s*none/);
  });
});

describe("detail page visual cards (#11)", () => {
  it("delivery health gets a ring and a segmented breakdown on the detail page", () => {
    expect(DETAIL).toContain("Delivery health");
    expect(DETAIL).toContain("styles.healthRing");
    expect(DETAIL).toContain("strokeDasharray");
    expect(DETAIL).toContain("styles.healthRail");
    expect(DETAIL).toContain("styles.healthLegend");
    expect(DETAIL_CSS).toContain(".healthBand {");
  });

  it("the ring is readable — labelled figure plus per-segment legend counts", () => {
    expect(DETAIL).toMatch(/aria-label=\{`Delivery health \$\{deliveryHealthPercent \?\? 0\}%/);
    expect(DETAIL).toContain('{ key: "delivered", label: "Delivered", count: deliveredCount }');
    expect(DETAIL).toContain('{ key: "pending", label: "Pending", count: pendingCount }');
  });

  it("adds Opened alongside the existing truthful metric cards", () => {
    expect(DETAIL).toContain("<span className={styles.metricLabel}>Opened</span>");
    expect(DETAIL).toContain("const opensCount =");
    // The disposition-based cards from the earlier hardening remain intact
    // (also covered by sequence-detail-metrics.test.ts).
    expect(DETAIL).toContain("const deliveredCount = dispositionCounts.sent");
    expect(DETAIL).toContain("Recent recipient activity");
    expect(DETAIL).toContain("<CampaignSetupEditor");
  });
});

describe("scope guards (#14, #15, #16)", () => {
  it("sequence creation is unchanged — the same builder with the same wiring", () => {
    expect(PAGE).toContain("<CampaignBuilder");
    for (const prop of ["imports={", "mappings={", "templates={", "senders={", "disconnectedSenderCount={"]) {
      expect(PAGE).toContain(prop);
    }
  });

  it("the dashboard is a pure client view — no data fetching, no db access", () => {
    expect(DASH).not.toContain('from "@/lib/db"');
    expect(DASH).not.toContain('from "@/services');
    expect(DASH).not.toMatch(/fetch\(|useSWR|useQuery|setInterval/);
    expect(LOGIC).not.toContain('from "@/lib/db"');
    expect(LOGIC).not.toContain("import");
  });

  it("adds no heavy dependencies", () => {
    for (const source of [DASH, LOADING, LOGIC]) {
      expect(source).not.toMatch(/three|gsap|lottie|framer-motion|chart\.js|recharts|d3/i);
    }
  });
});
