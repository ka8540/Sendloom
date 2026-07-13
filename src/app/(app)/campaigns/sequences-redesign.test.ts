import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  computeSequenceFlags,
  countSequencesByFilter,
  filterSequences,
  getSequencePagination,
  primarySequenceTone,
  resolveSequenceSelection,
  SEQUENCE_PAGE_SIZE,
  summarizeSequencePage,
  type SequenceStatusFlags
} from "./sequence-insights";

// Unit tests for the Sequences command-center logic module plus source-level
// assertions for the redesigned board, following the repo's node-only
// source-assertion convention (no DOM in the test env). Covers: rendering
// wiring, filter/search behavior, 5-per-page pagination, the pagination hover
// preview, the separated inspector panel, empty/loading states, keyboard
// support, and the no-backend-changes guarantee.

const PAGE = readFileSync("src/app/(app)/campaigns/page.tsx", "utf8");
const CENTER = readFileSync("src/app/(app)/campaigns/sequences-command-center.tsx", "utf8");
const CENTER_CSS = readFileSync("src/app/(app)/campaigns/command-center.module.css", "utf8");
const LOADING = readFileSync("src/app/(app)/campaigns/loading.tsx", "utf8");
const LOADING_CSS = readFileSync("src/app/(app)/campaigns/loading.module.css", "utf8");
const CARD_ACTIONS = readFileSync("src/components/campaign-card-actions.tsx", "utf8");

function makeSequence(
  overrides: Partial<{
    id: string;
    name: string;
    listName: string;
    templateName: string;
    senderName: string;
    senderEmail: string;
    flags: Partial<SequenceStatusFlags>;
  }> = {}
) {
  return {
    id: overrides.id ?? "seq-1",
    name: overrides.name ?? "April founder outreach",
    listName: overrides.listName ?? "Founders list",
    templateName: overrides.templateName ?? "Intro template",
    senderName: overrides.senderName ?? "Kush Ahir",
    senderEmail: overrides.senderEmail ?? "kush@example.com",
    flags: {
      active: false,
      paused: false,
      needsAttention: false,
      completed: false,
      scheduled: false,
      draft: false,
      ...overrides.flags
    }
  };
}

describe("status flag mapping from real CampaignStatus/RunStatus enums (#4, #5, #6)", () => {
  it("maps RUNNING and WAITING_FOR_SLOT campaigns (and queued/running latest runs) to Active", () => {
    expect(computeSequenceFlags({ status: "RUNNING", latestRunStatus: null, issueCount: 0 }).active).toBe(true);
    expect(computeSequenceFlags({ status: "WAITING_FOR_SLOT", latestRunStatus: null, issueCount: 0 }).active).toBe(true);
    expect(computeSequenceFlags({ status: "COMPLETED", latestRunStatus: "QUEUED", issueCount: 0 }).active).toBe(true);
    expect(computeSequenceFlags({ status: "COMPLETED", latestRunStatus: "COMPLETED", issueCount: 0 }).active).toBe(false);
  });

  it("maps PAUSED to Paused", () => {
    expect(computeSequenceFlags({ status: "PAUSED", latestRunStatus: null, issueCount: 0 }).paused).toBe(true);
    expect(computeSequenceFlags({ status: "RUNNING", latestRunStatus: "PAUSED", issueCount: 0 }).paused).toBe(true);
    expect(computeSequenceFlags({ status: "RUNNING", latestRunStatus: "RUNNING", issueCount: 0 }).paused).toBe(false);
  });

  it("maps FAILED status, failed latest runs, and issue counts to Needs attention", () => {
    expect(computeSequenceFlags({ status: "FAILED", latestRunStatus: null, issueCount: 0 }).needsAttention).toBe(true);
    expect(computeSequenceFlags({ status: "COMPLETED", latestRunStatus: "FAILED", issueCount: 0 }).needsAttention).toBe(true);
    expect(computeSequenceFlags({ status: "COMPLETED", latestRunStatus: "COMPLETED", issueCount: 3 }).needsAttention).toBe(true);
    expect(computeSequenceFlags({ status: "COMPLETED", latestRunStatus: "COMPLETED", issueCount: 0 }).needsAttention).toBe(false);
  });

  it("maps COMPLETED to Completed and SCHEDULED/VALIDATED to Scheduled/Ready, DRAFT to Draft", () => {
    expect(computeSequenceFlags({ status: "COMPLETED", latestRunStatus: null, issueCount: 0 }).completed).toBe(true);
    expect(computeSequenceFlags({ status: "SCHEDULED", latestRunStatus: null, issueCount: 0 }).scheduled).toBe(true);
    expect(computeSequenceFlags({ status: "VALIDATED", latestRunStatus: null, issueCount: 0 }).scheduled).toBe(true);
    expect(computeSequenceFlags({ status: "DRAFT", latestRunStatus: null, issueCount: 0 }).draft).toBe(true);
  });

  it("does not invent statuses — a CANCELLED sequence only appears under All", () => {
    const flags = computeSequenceFlags({ status: "CANCELLED", latestRunStatus: "CANCELLED", issueCount: 0 });
    expect(Object.values(flags).some(Boolean)).toBe(false);
    expect(primarySequenceTone({ flags })).toBe("idle");
  });
});

describe("filters (#4, #5, #6) and header counts (#2)", () => {
  const sequences = [
    makeSequence({ id: "a", flags: { active: true } }),
    makeSequence({ id: "b", flags: { paused: true } }),
    makeSequence({ id: "c", flags: { completed: true, needsAttention: true } }),
    makeSequence({ id: "d", flags: { completed: true } }),
    makeSequence({ id: "e", flags: { scheduled: true } })
  ];

  it("Active filter returns only active sequences", () => {
    expect(filterSequences(sequences, "active", "").map((s) => s.id)).toEqual(["a"]);
  });

  it("Paused filter returns only paused sequences", () => {
    expect(filterSequences(sequences, "paused", "").map((s) => s.id)).toEqual(["b"]);
  });

  it("Needs attention filter returns sequences with issues even when completed", () => {
    expect(filterSequences(sequences, "attention", "").map((s) => s.id)).toEqual(["c"]);
  });

  it("counts every filter bucket from the data (never hardcoded)", () => {
    const counts = countSequencesByFilter(sequences);
    expect(counts).toEqual({ all: 5, active: 1, paused: 1, attention: 1, completed: 2, scheduled: 1, draft: 0 });
  });
});

describe("search (#7, #8)", () => {
  const sequences = [
    makeSequence({ id: "a", name: "BlackRock outreach", flags: { paused: true } }),
    makeSequence({ id: "b", name: "BlackRock follow-up", flags: { completed: true } }),
    makeSequence({ id: "c", name: "Verkada SDE", listName: "Verkada list", flags: { paused: true } }),
    makeSequence({ id: "d", name: "Ops", senderEmail: "ops@blackrock-partners.com", flags: { active: true } })
  ];

  it("matches by sequence name, case-insensitively, with trimming", () => {
    expect(filterSequences(sequences, "all", "  blackrock ").map((s) => s.id)).toEqual(["a", "b", "d"]);
  });

  it("matches list, template, and sender fields too", () => {
    expect(filterSequences(sequences, "all", "verkada list").map((s) => s.id)).toEqual(["c"]);
    expect(filterSequences(sequences, "all", "OPS@BLACKROCK").map((s) => s.id)).toEqual(["d"]);
  });

  it("combines with the status filter — paused + BlackRock returns only paused BlackRock sequences", () => {
    expect(filterSequences(sequences, "paused", "blackrock").map((s) => s.id)).toEqual(["a"]);
  });

  it("empty query matches everything", () => {
    expect(filterSequences(sequences, "all", "   ")).toHaveLength(4);
  });
});

describe("pagination is 5 per page (#9, #10)", () => {
  it("page size is exactly 5", () => {
    expect(SEQUENCE_PAGE_SIZE).toBe(5);
  });

  it("computes the visible range and label", () => {
    const first = getSequencePagination(158, 1);
    expect(first).toMatchObject({ page: 1, totalPages: 32, start: 0, end: 5 });
    expect(first.rangeLabel).toBe("Showing 1–5 of 158");

    const last = getSequencePagination(158, 32);
    expect(last).toMatchObject({ start: 155, end: 158 });
    expect(last.rangeLabel).toBe("Showing 156–158 of 158");
  });

  it("clamps out-of-range pages instead of showing an empty board", () => {
    expect(getSequencePagination(12, 99).page).toBe(3);
    expect(getSequencePagination(12, 0).page).toBe(1);
    expect(getSequencePagination(0, 1)).toMatchObject({ page: 1, totalPages: 1, rangeLabel: "No sequences" });
  });
});

describe("pagination hover preview (#11)", () => {
  it("summarizes a target page with one primary tone per sequence", () => {
    const page = [
      makeSequence({ flags: { completed: true } }),
      makeSequence({ flags: { completed: true } }),
      makeSequence({ flags: { paused: true } }),
      makeSequence({ flags: { completed: true, needsAttention: true } }),
      makeSequence({ flags: { needsAttention: true } })
    ];
    expect(summarizeSequencePage(page)).toBe("2 need review · 1 paused · 2 completed");
  });

  it("uses singular wording for one sequence", () => {
    expect(summarizeSequencePage([makeSequence({ flags: { needsAttention: true } })])).toBe("1 needs review");
  });

  it("the preview renders as a tooltip and never changes the page on hover", () => {
    expect(CENTER).toContain('role="tooltip"');
    // Hover/focus handlers only toggle preview state…
    expect(CENTER).toMatch(/onMouseEnter=\{\(\) =>\s*setPreviewDirection/);
    expect(CENTER).toMatch(/onFocus=\{\(\) =>\s*\n?\s*setPreviewDirection/);
    // …while page changes happen exclusively in click handlers.
    expect(CENTER).not.toMatch(/onMouseEnter=\{[^}]*goToPage/);
    expect(CENTER).toMatch(/onClick=\{\(\) => goToPage\(pagination\.page \+ 1\)\}/);
    // Touch devices skip the hover tooltip entirely.
    expect(CENTER_CSS).toMatch(/@media \(hover: none\)[\s\S]*?\.pagePreview \{\s*display: none/);
  });
});

describe("selection and the separated inspector panel (#12, #13)", () => {
  it("keeps the selection only while visible, otherwise falls back to the first card", () => {
    expect(resolveSequenceSelection(["a", "b", "c"], "b")).toBe("b");
    expect(resolveSequenceSelection(["a", "b", "c"], "z")).toBe("a");
    expect(resolveSequenceSelection([], "z")).toBeNull();
  });

  it("cards stay minimal — extended values live only in the inspector", () => {
    const cardBlock = CENTER.slice(CENTER.indexOf("styles.cardSelect"), CENTER.indexOf("styles.cardActions"));
    const inspectorBlock = CENTER.slice(CENTER.indexOf("function SequenceInspector"), CENTER.indexOf("function PagePreview"));

    for (const detailOnly of ['"Validation"', '"Send timing"', '"Template"', '"Contact list"', '"Latest run"', '"Opened"']) {
      expect(inspectorBlock).toContain(detailOnly);
      expect(cardBlock).not.toContain(detailOnly);
    }
  });

  it("clicking a card selects it and the inspector renders the selected sequence", () => {
    expect(CENTER).toContain("onClick={() => setSelectedId(item.id)}");
    expect(CENTER).toContain("<SequenceInspector item={selectedItem} />");
    // Mobile fallback: the selected card expands inline instead of a side panel.
    expect(CENTER).toContain("<SequenceInspector item={selectedItem} inline />");
    expect(CENTER_CSS).toContain(".inlineInspector {\n  display: none;\n}");
  });

  it("selected state is obvious and not color-only", () => {
    expect(CENTER).toContain('aria-pressed={isSelected}');
    expect(CENTER_CSS).toContain('.card[data-selected="true"]');
  });
});

describe("page wiring and header (#1, #2, #3)", () => {
  it("the /campaigns route renders the redesigned command center from real data", () => {
    expect(PAGE).toContain("<SequencesCommandCenter items={boardItems} />");
    expect(PAGE).toContain("<h1>Sequences</h1>");
    expect(PAGE).toContain("Track launches, delivery health, and sequences that need attention.");
    // The old bulky row design is gone.
    expect(PAGE).not.toContain("sequenceRow");
    expect(PAGE).not.toContain("SequenceBoard ");
  });

  it("summary counts and card numbers come from data, never literals", () => {
    expect(CENTER).toContain("countSequencesByFilter(items)");
    expect(CENTER).toContain("{formatCount(counts[entry.key])}");
    expect(PAGE).toContain("summarizeOverviewRun");
  });

  it("filter pills render for every required state", () => {
    for (const label of ['label: "All"', 'label: "Active"', 'label: "Paused"', 'label: "Needs attention"', 'label: "Completed"', 'label: "Scheduled"', 'label: "Draft"']) {
      expect(CENTER).toContain(label);
    }
  });
});

describe("accessibility and keyboard support (#16)", () => {
  it("filters are real buttons with aria-pressed", () => {
    expect(CENTER).toContain('aria-pressed={filter === entry.key}');
    expect(CENTER).toContain('aria-label="Filter sequences by status"');
  });

  it("search has a label and a labelled clear control", () => {
    expect(CENTER).toContain('htmlFor="sequence-search"');
    expect(CENTER).toContain('aria-label="Clear search"');
  });

  it("cards are keyboard-selectable buttons with arrow-key navigation", () => {
    expect(CENTER).toMatch(/<button[\s\S]{0,200}className=\{styles\.cardSelect\}/);
    expect(CENTER).toContain('event.key === "ArrowDown"');
    expect(CENTER).toContain('event.key === "ArrowUp"');
  });

  it("pagination buttons are labelled and results are announced politely", () => {
    expect(CENTER).toContain('aria-label="Previous sequences page"');
    expect(CENTER).toContain('aria-label="Next sequences page"');
    expect(CENTER).toContain('aria-live="polite"');
  });

  it("status is never color-only and reduced motion is honored", () => {
    // Every card carries a text status pill next to its tone dot.
    expect(CENTER).toContain("{item.statusLabel}");
    expect(CENTER_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(LOADING_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("empty and loading states (#14, #15)", () => {
  it("renders the premium empty state when no sequences exist", () => {
    expect(CENTER).toContain("No sequences yet");
    expect(CENTER).toContain("Import a list, create a template, then launch your first sequence.");
    expect(CENTER).toContain('href="#create-sequence"');
    expect(CENTER).toContain('href="/imports"');
    // The builder anchor target exists on the page.
    expect(PAGE).toContain('id="create-sequence"');
  });

  it("filtered empty state offers a clear-filters escape hatch", () => {
    expect(CENTER).toContain("No sequences match");
    expect(CENTER).toContain("onClick={clearFilters}");
  });

  it("route loading state is a skeleton of the new layout, not a spinner", () => {
    expect(LOADING).toContain("Array.from({ length: 5 })");
    expect(LOADING).toContain('aria-busy="true"');
    expect(LOADING).not.toMatch(/className=["'{][^"'}]*[sS]pinner/);
    expect(LOADING_CSS).not.toMatch(/animation:[^;]*(spin|rotate)/);
    for (const piece of ["hero", "filterRail", "search", "inspector", "pagination"]) {
      expect(LOADING).toContain(piece);
    }
  });
});

describe("no backend changes; existing actions keep working (#17, #18)", () => {
  it("the command center is frontend-only — no direct fetch calls or new endpoints", () => {
    expect(CENTER).not.toContain("fetch(");
    expect(CENTER).not.toContain('from "@/lib/db"');
    expect(CENTER).not.toContain('"/api/');
  });

  it("open and delete reuse the existing CampaignCardActions wiring", () => {
    expect(CENTER).toContain("<CampaignCardActions campaignId={item.id} campaignName={item.name} />");
    expect(CARD_ACTIONS).toContain("`/api/campaigns/${props.campaignId}`");
    expect(CARD_ACTIONS).toContain('method: "DELETE"');
    expect(CARD_ACTIONS).toContain("href={`/campaigns/${props.campaignId}`}");
  });

  it("pause/resume reuses the existing button against existing endpoints", () => {
    expect(CENTER).toContain("CampaignPauseResumeButton");
    expect(CENTER).toMatch(/isPaused=\{item\.isPaused\}/);
  });
});
