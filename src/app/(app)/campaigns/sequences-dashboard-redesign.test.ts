import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SEQUENCE_FILTERS,
  SEQUENCE_PAGE_SIZE,
  SEQUENCE_TONE_LABELS,
  buildSequenceAttentionItems,
  countSequenceFilters,
  describeSequencePagePreview,
  describeSequenceState,
  filterSequenceItems,
  getSequenceIssueCount,
  getSequenceOpenRatePercent,
  getSequenceStatusFlags,
  paginateSequenceItems,
  primarySequenceTone,
  sequenceMatchesFilter,
  sequenceMatchesSearch,
  type SequenceListItem
} from "@/lib/sequence-dashboard";

// Unit tests for the sequence-dashboard view logic plus node-only source
// assertions for the redesigned Sequences pages (server components are not
// renderable in the node test env). Covers: the dashboard-only /campaigns
// route (header, summary cards, health panel, filters with counts, search,
// 5-per-page pagination), the separate /campaigns/new create page with the
// compact Gmail sender panel, the untouched detail page, and the
// no-backend-change guards.

const PAGE = readFileSync("src/app/(app)/campaigns/page.tsx", "utf8");
const PAGE_CSS = readFileSync("src/app/(app)/campaigns/page.module.css", "utf8");
const CREATE = readFileSync("src/app/(app)/campaigns/new/page.tsx", "utf8");
const CREATE_CSS = readFileSync("src/app/(app)/campaigns/new/page.module.css", "utf8");
const CREATE_ALIAS = readFileSync("src/app/(app)/sequences/new/page.tsx", "utf8");
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

describe("status mapping", () => {
  it("maps campaign and run statuses onto the real enum values", () => {
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "RUNNING", latestRunStatus: null })).active).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "WAITING_FOR_SLOT" })).active).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ latestRunStatus: "QUEUED" })).active).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "PAUSED" })).paused).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ latestRunStatus: "PAUSED" })).paused).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "FAILED" })).attention).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ latestRunStatus: "FAILED" })).attention).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ failedCount: 2, invalidCount: 1 })).attention).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "COMPLETED" })).completed).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "SCHEDULED" })).scheduled).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "VALIDATED" })).scheduled).toBe(true);
    expect(getSequenceStatusFlags(makeItem({ campaignStatus: "DRAFT", latestRunStatus: null })).draft).toBe(true);
    expect(getSequenceIssueCount(makeItem({ failedCount: 2, invalidCount: 3 }))).toBe(5);
  });

  it("keeps cancelled sequences visible only under All", () => {
    const cancelled = makeItem({ campaignStatus: "CANCELLED", latestRunStatus: "CANCELLED" });
    expect(sequenceMatchesFilter(cancelled, "all")).toBe(true);
    for (const filter of ["active", "paused", "attention", "completed", "scheduled", "draft"] as const) {
      expect(sequenceMatchesFilter(cancelled, filter)).toBe(false);
    }
  });

  it("filters are overlapping predicates — a completed run with failures shows under both", () => {
    const item = makeItem({ campaignStatus: "COMPLETED", latestRunStatus: "COMPLETED", failedCount: 2 });
    expect(sequenceMatchesFilter(item, "completed")).toBe(true);
    expect(sequenceMatchesFilter(item, "attention")).toBe(true);
  });

  it("assigns one primary tone with attention taking priority", () => {
    expect(primarySequenceTone(makeItem({ failedCount: 2 }))).toBe("attention");
    expect(primarySequenceTone(makeItem({ campaignStatus: "PAUSED" }))).toBe("paused");
    expect(primarySequenceTone(makeItem({ campaignStatus: "RUNNING" }))).toBe("active");
    expect(primarySequenceTone(makeItem())).toBe("completed");
    expect(primarySequenceTone(makeItem({ campaignStatus: "SCHEDULED", latestRunStatus: null }))).toBe("scheduled");
    expect(primarySequenceTone(makeItem({ campaignStatus: "DRAFT", latestRunStatus: null }))).toBe("draft");
    expect(SEQUENCE_TONE_LABELS.attention).toBe("Needs attention");
  });

  it("describes the current state from real statuses", () => {
    expect(describeSequenceState(makeItem({ latestRunStatus: "RUNNING" }))).toBe("Sending");
    expect(describeSequenceState(makeItem({ latestRunStatus: "WAITING_FOR_SLOT" }))).toBe(
      "Waiting for a send slot"
    );
    expect(describeSequenceState(makeItem({ latestRunStatus: "QUEUED" }))).toBe("Queued to send");
    expect(describeSequenceState(makeItem({ latestRunStatus: "PAUSED" }))).toBe("Manually paused");
    expect(describeSequenceState(makeItem({ latestRunStatus: "FAILED" }))).toBe("Last run failed");
    expect(describeSequenceState(makeItem())).toBe("Finished sending");
    expect(
      describeSequenceState(makeItem({ campaignStatus: "SCHEDULED", latestRunStatus: null }))
    ).toBe("Scheduled");
    expect(
      describeSequenceState(makeItem({ campaignStatus: "DRAFT", latestRunStatus: null }))
    ).toBe("Draft");
  });

  it("computes the open rate only from delivered emails", () => {
    expect(getSequenceOpenRatePercent(makeItem({ deliveredCount: 200, opensCount: 58 }))).toBe(29);
    expect(getSequenceOpenRatePercent(makeItem({ deliveredCount: 0, opensCount: 0 }))).toBeNull();
    expect(getSequenceOpenRatePercent(makeItem({ deliveredCount: 3, opensCount: 3 }))).toBe(100);
  });
});

describe("filter counts (#7)", () => {
  const items = [
    makeItem({ id: "a", campaignStatus: "RUNNING", latestRunStatus: "RUNNING" }),
    makeItem({ id: "b", campaignStatus: "PAUSED", latestRunStatus: "PAUSED" }),
    makeItem({ id: "c", campaignStatus: "COMPLETED", failedCount: 1 }),
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

describe("search (#8, #9)", () => {
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

  it("search and filter combine (#9)", () => {
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

describe("pagination (#10, #11)", () => {
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
      makeItem({ id: "c", failedCount: 1 })
    ]);
    expect(preview).not.toBeNull();
    expect(preview!.headline).toBe("3 sequences");
    expect(preview!.breakdown).toBe("1 needs attention · 1 paused · 1 completed");
    expect(describeSequencePagePreview([])).toBeNull();
  });
});

describe("health panel logic (#13)", () => {
  it("builds attention items only from observed delivery facts", () => {
    const entries = buildSequenceAttentionItems([
      makeItem({ id: "ok" }),
      makeItem({ id: "invalid", invalidCount: 3 }),
      makeItem({ id: "failed-run", latestRunStatus: "FAILED" }),
      makeItem({ id: "failed-sends", failedCount: 4, invalidCount: 1 })
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(["failed-run", "failed-sends", "invalid"]);
    expect(entries[0].severity).toBe("critical");
    expect(entries[0].title).toBe("Run failed");
    expect(entries[1].detail).toBe("4 sends failed, 1 recipient skipped as invalid.");
    expect(entries[2].severity).toBe("warning");
    expect(entries[2].title).toBe("Invalid recipients skipped");
  });

  it("a paused sequence alone is never an invented alert", () => {
    expect(
      buildSequenceAttentionItems([makeItem({ id: "p", campaignStatus: "PAUSED", latestRunStatus: "PAUSED" })])
    ).toEqual([]);
  });

  it("the page renders attention items with review links or the all-clear state", () => {
    expect(PAGE).toContain("buildSequenceAttentionItems");
    expect(PAGE).toContain('aria-label="Sequences health"');
    expect(PAGE).toContain("Review sequence");
    expect(PAGE).toContain("href={`/campaigns/${entry.id}`}");
    expect(PAGE).toContain("All clear");
    expect(PAGE).toContain("No sequences need attention right now.");
  });
});

describe("dashboard page structure (#1, #2, #3, #12)", () => {
  it("renders the dashboard, not the create form (#1)", () => {
    expect(PAGE).not.toContain("<CampaignBuilder");
    expect(PAGE).not.toContain("Create a sequence");
    expect(PAGE).toContain("<SequenceDashboard");
    expect(PAGE).toContain("<h1>Sequences</h1>");
    expect(PAGE).toContain("Track delivery, replies, and runs that need attention.");
  });

  it("has a New sequence button that links to the create page (#2, #3)", () => {
    expect(PAGE).toContain("New sequence");
    expect(PAGE).toContain('href="/campaigns/new"');
  });

  it("summary cards use only real data sources", () => {
    for (const label of ['label: "Active"', 'label: "Replies"', 'label: "Sent"', 'label: "Scheduled"']) {
      expect(PAGE).toContain(label);
    }
    // Active derives from status flags, replies from InboundReply, sent from
    // the send-window ledger, scheduled from queued runs — no invented values.
    expect(PAGE).toContain("countSequenceFilters");
    expect(PAGE).toContain("prisma.inboundReply.count");
    expect(PAGE).toContain("getGmailDailySendWindow");
    expect(PAGE).toContain('status: { in: ["QUEUED", "WAITING_FOR_SLOT"] }');
    // The send count degrades gracefully when the ledger is unavailable.
    expect(PAGE).toContain('sendWindow.ledgerAvailable ? countFormatter.format(sendWindow.sentLast24h) : "—"');
  });

  it("no side inspector and no giant cards on the list page (#12)", () => {
    expect(DASH).not.toContain("<aside");
    expect(DASH).not.toMatch(/inspector/i);
    expect(DASH_CSS).not.toMatch(/inspector/i);
    // The only asides on the page are the health panel, not a list inspector.
    const asides = PAGE.match(/<aside/g) ?? [];
    expect(asides).toHaveLength(1);
    expect(PAGE).toContain('<aside className={styles.healthPanel} aria-label="Sequences health">');
  });
});

describe("create page (#4, #5)", () => {
  it("renders the create form on its own route (#4)", () => {
    expect(CREATE).toContain("<CampaignBuilder");
    expect(CREATE).toContain("Create a sequence");
    for (const prop of ["imports={", "mappings={", "templates={", "senders={", "disconnectedSenderCount={"]) {
      expect(CREATE).toContain(prop);
    }
    // No sequence list/table below the form.
    expect(CREATE).not.toContain("SequenceDashboard");
    expect(CREATE).not.toContain("paginateSequenceItems");
    // A way back to the dashboard.
    expect(CREATE).toContain('href="/campaigns"');
    expect(CREATE).toContain("Back to sequences");
  });

  it("renders the compact Send from Gmail panel (#5)", () => {
    expect(CREATE).toContain("styles.senderPanel");
    expect(CREATE).toContain("Send from Gmail");
    expect(CREATE).toContain("styles.senderChip}>Connected</span>");
    expect(CREATE).toContain("Connect another Gmail");
    const senderPanelCss = CREATE_CSS.slice(CREATE_CSS.indexOf(".senderPanel {"));
    expect(senderPanelCss).toContain("align-self: start;");
  });

  it("the /sequences/new alias reuses the same page", () => {
    expect(CREATE_ALIAS).toContain('export { default } from "@/app/(app)/campaigns/new/page"');
  });
});

describe("dashboard component (#7, #8, #10, #11)", () => {
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

  it("each row shows the required columns and keeps the existing actions", () => {
    expect(DASH).toContain("href={`/campaigns/${item.id}`}");
    expect(DASH).toContain("aria-label={`Open sequence ${item.name}`}");
    expect(DASH).toContain("<CampaignCardActions campaignId={item.id} campaignName={item.name} />");
    // recipient count + sender email, status, state, created, progress, performance
    expect(DASH).toContain("{item.senderEmail}");
    expect(DASH).toContain("{SEQUENCE_TONE_LABELS[tone]}");
    expect(DASH).toContain("{describeSequenceState(item)}");
    expect(DASH).toContain("formatRelativeTime(createdDate)");
    expect(DASH).toContain("{item.progressPercent}%");
    expect(DASH).toContain("getSequenceOpenRatePercent");
    expect(DASH).toContain("{formatCount(item.repliedCount)}");
  });

  it("renders a table-style header aligned with the row grid", () => {
    for (const column of ["Name", "Status", "Current state", "Created", "Progress", "Performance"]) {
      expect(DASH).toContain(`<span>${column}</span>`);
    }
    expect(DASH_CSS).toContain("--seq-cols:");
    expect(DASH_CSS).toContain("grid-template-columns: var(--seq-cols)");
  });
});

describe("empty states", () => {
  it("a workspace with no sequences points to the create page", () => {
    expect(DASH).toContain("No sequences yet");
    expect(DASH).toContain("Create your first sequence or import a list to get started.");
    expect(DASH).toContain('href="/campaigns/new"');
    expect(DASH).toContain('href="/imports"');
  });

  it("an empty filter result offers to clear filters", () => {
    expect(DASH).toContain("No sequences match this filter");
    expect(DASH).toContain("Try another status or clear search.");
    expect(DASH).toContain("Clear filters");
    expect(DASH).toContain("onClick={clearFilters}");
  });
});

describe("loading skeleton", () => {
  it("announces loading accessibly with no spinner-only state", () => {
    expect(LOADING).toContain('role="status"');
    expect(LOADING).toContain('aria-busy="true"');
    expect(LOADING).toContain("srOnly");
    expect(LOADING_CSS).not.toMatch(/rotate\(360deg\)|animation:[^;]*\bspin\b/);
  });

  it("mirrors the real layout: header, summary cards, health panel, toolbar, five rows, pagination", () => {
    for (const piece of [
      "pageHeader",
      "newButton",
      "summaryCards",
      "healthPanel",
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

describe("detail page untouched (#6)", () => {
  it("carries none of this redesign's markers", () => {
    // The reverted v2 experiment added a health ring and band styles — gone.
    expect(DETAIL).not.toContain("healthRing");
    expect(DETAIL_CSS).not.toContain(".healthBand");
    // The detail page never consumes the dashboard view logic.
    expect(DETAIL).not.toContain('from "@/lib/sequence-dashboard"');
    // Its established structure (pinned by sequence-detail-metrics.test.ts)
    // is intact.
    expect(DETAIL).toContain("const issueCount = dispositionCounts.needsAttention");
    expect(DETAIL).toContain("<CampaignSetupEditor");
  });
});

describe("scope guards (#14)", () => {
  it("the dashboard is a pure client view — no data fetching, no db access", () => {
    expect(DASH).not.toContain('from "@/lib/db"');
    expect(DASH).not.toContain('from "@/services');
    expect(DASH).not.toMatch(/fetch\(|useSWR|useQuery|setInterval/);
    expect(LOGIC).not.toContain('from "@/lib/db"');
    expect(LOGIC).not.toContain("import");
  });

  it("the pages only read — no new mutations, endpoints, or schema use", () => {
    // Reads only: findMany/count/groupBy. No create/update/delete calls.
    for (const source of [PAGE, CREATE]) {
      expect(source).not.toMatch(/prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/);
    }
    // Creation still flows through the existing builder + API route.
    expect(CREATE).toContain("<CampaignBuilder");
  });

  it("adds no heavy dependencies", () => {
    for (const source of [DASH, LOADING, LOGIC, PAGE, CREATE, PAGE_CSS, CREATE_CSS]) {
      expect(source).not.toMatch(/three|gsap|lottie|framer-motion|chart\.js|recharts|d3/i);
    }
  });
});
