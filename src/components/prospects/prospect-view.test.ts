import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { PersonNode, ProspectSearchNode } from "@/components/prospects/prospect-graphql";
import {
  EXTERNAL_LINK_REL,
  EXTERNAL_LINK_TARGET,
  INFERRED_EMAIL_NOTICE,
  PROSPECT_FINDER_SUBTITLE,
  PROSPECT_FINDER_TAGLINE,
  PROSPECT_FINDER_TITLE,
  PROSPECT_FINDER_UNAVAILABLE_BODY,
  PROSPECT_FINDER_UNAVAILABLE_TITLE,
  confidenceBadge,
  buildProspectSelectionInput,
  createEmptyProspectSelection,
  emailStatusBadge,
  filterPeopleByText,
  formatPageLabel,
  formatSearchError,
  formatShowingLabel,
  isEmailCopyable,
  getPageSelectionState,
  getProspectSelectionCount,
  isProspectSelected,
  isVerifiedStatus,
  personLocation,
  resolvePageCount,
  resolveProspectPageState,
  resolveSelectedSearchView,
  selectAllMatchingProspects,
  statusBadge,
  togglePageProspectSelection,
  toggleProspectSelection
} from "@/components/prospects/prospect-view";

function person(overrides: Partial<PersonNode> = {}): PersonNode {
  return {
    id: "p1",
    fullName: "Ada Lovelace",
    firstName: "Ada",
    lastName: "Lovelace",
    currentTitle: "Software Engineer",
    normalizedTitle: "software engineer",
    location: "London, United Kingdom",
    country: "United Kingdom",
    state: null,
    city: "London",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    inferredEmail: "ada.lovelace@example.com",
    emailStatus: "INFERRED_HIGH",
    emailConfidence: "HIGH",
    emailPattern: "first.last",
    emailSource: "PATTERN",
    createdAt: "2026-06-18T00:00:00.000Z",
    ...overrides
  };
}

function search(overrides: Partial<ProspectSearchNode> = {}): ProspectSearchNode {
  return {
    id: "s1",
    requestedCompany: "Stripe",
    requestedTitles: ["Software Engineer"],
    requestedLocations: ["United States"],
    maxResults: 20,
    status: "READY",
    errorCode: null,
    errorMessage: null,
    peopleCount: 3,
    createdAt: "2026-06-18T00:00:00.000Z",
    completedAt: "2026-06-18T00:01:00.000Z",
    company: {
      id: "c1",
      name: "Stripe, Inc.",
      officialDomain: "stripe.com",
      officialWebsiteDomain: "stripe.com",
      emailDomain: "stripe.com",
      emailDomainConfidence: "HIGH",
      emailPattern: "first.last",
      patternConfidence: "HIGH",
      peopleCount: 3
    },
    ...overrides
  };
}

describe("email status badges — inferred is never verified", () => {
  it("labels inferred-high as Inferred and not the verified tone", () => {
    const badge = emailStatusBadge("INFERRED_HIGH");
    expect(badge.label).toMatch(/inferred/i);
    expect(badge.label).not.toMatch(/verified/i);
    expect(badge.tone).not.toBe("verified");
  });

  it("labels inferred-medium and inferred-low as inferred (not verified)", () => {
    for (const status of ["INFERRED_MEDIUM", "INFERRED_LOW"] as const) {
      const badge = emailStatusBadge(status);
      expect(badge.label).toMatch(/inferred/i);
      expect(badge.tone).not.toBe("verified");
    }
  });

  it("only uses the verified tone for a real VERIFIED status", () => {
    expect(emailStatusBadge("VERIFIED").tone).toBe("verified");
    expect(isVerifiedStatus("VERIFIED")).toBe(true);
    expect(isVerifiedStatus("INFERRED_HIGH")).toBe(false);
  });

  it("shows Unavailable / Suppressed appropriately", () => {
    expect(emailStatusBadge("UNAVAILABLE").label).toMatch(/unavailable/i);
    expect(emailStatusBadge("UNAVAILABLE").tone).toBe("muted");
    expect(emailStatusBadge("SUPPRESSED").tone).toBe("blocked");
  });

  it("exposes a persistent inferred-not-verified notice", () => {
    expect(INFERRED_EMAIL_NOTICE).toMatch(/inferred/i);
    expect(INFERRED_EMAIL_NOTICE).toMatch(/verified/i);
  });
});

describe("confidence badges", () => {
  it("maps levels without throwing and never marks LOW as verified", () => {
    expect(confidenceBadge("HIGH").label).toBe("High");
    expect(confidenceBadge("LOW").tone).toBe("warning");
    expect(confidenceBadge("UNAVAILABLE").tone).toBe("muted");
  });
});

describe("copy-email visibility", () => {
  it("is copyable when an inferred email is present", () => {
    expect(isEmailCopyable(person({ inferredEmail: "x@y.com", emailStatus: "INFERRED_HIGH" }))).toBe(true);
  });

  it("is NOT copyable for an unavailable / empty email", () => {
    expect(isEmailCopyable(person({ inferredEmail: null, emailStatus: "UNAVAILABLE" }))).toBe(false);
    expect(isEmailCopyable(person({ inferredEmail: "   ", emailStatus: "INFERRED_LOW" }))).toBe(false);
  });
});

describe("external LinkedIn links are hardened", () => {
  it("opens in a new tab with a safe rel", () => {
    expect(EXTERNAL_LINK_TARGET).toBe("_blank");
    expect(EXTERNAL_LINK_REL).toBe("noopener noreferrer");
  });
});

describe("page-level view state", () => {
  it("returns disabled when the feature flag is off", () => {
    expect(resolveProspectPageState({ disabled: true, loading: false, searchCount: 0 })).toBe("disabled");
  });

  it("returns loading only while the first load is in flight", () => {
    expect(resolveProspectPageState({ disabled: false, loading: true, searchCount: 0 })).toBe("loading");
  });

  it("returns empty when there are no searches", () => {
    expect(resolveProspectPageState({ disabled: false, loading: false, searchCount: 0 })).toBe("empty");
  });

  it("returns ready once searches exist", () => {
    expect(resolveProspectPageState({ disabled: false, loading: false, searchCount: 2 })).toBe("ready");
  });
});

describe("selected-search view state", () => {
  it("is 'none' with no selection (no company present)", () => {
    expect(resolveSelectedSearchView(null)).toBe("none");
  });

  it("is 'ready' for a READY search with a company", () => {
    expect(resolveSelectedSearchView(search())).toBe("ready");
  });

  it("is 'processing' for a READY search that has no company yet", () => {
    expect(resolveSelectedSearchView(search({ status: "READY", company: null }))).toBe("processing");
  });

  it("is 'failed' / 'canceled' / 'processing' for those statuses", () => {
    expect(resolveSelectedSearchView(search({ status: "FAILED", company: null }))).toBe("failed");
    expect(resolveSelectedSearchView(search({ status: "CANCELED", company: null }))).toBe("canceled");
    expect(resolveSelectedSearchView(search({ status: "SEARCHING_PEOPLE", company: null }))).toBe("processing");
  });
});

describe("failed-search error formatting is safe", () => {
  it("uses the curated code and message when present", () => {
    const result = formatSearchError({ errorCode: "PROVIDER_TIMEOUT", errorMessage: "The profile search timed out." });
    expect(result.code).toBe("PROVIDER_TIMEOUT");
    expect(result.message).toMatch(/timed out/i);
  });

  it("falls back to a friendly message when none is provided", () => {
    const result = formatSearchError({ errorCode: null, errorMessage: null });
    expect(result.code).toBe("ERROR");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("status badges", () => {
  it("marks READY as verified-tone and FAILED as blocked", () => {
    expect(statusBadge("READY").tone).toBe("verified");
    expect(statusBadge("FAILED").tone).toBe("blocked");
    expect(statusBadge("SEARCHING_PEOPLE").tone).toBe("inferred");
  });
});

describe("formatting helpers", () => {
  it("builds a Showing 1–20 of N label", () => {
    expect(formatShowingLabel({ offset: 0, pageCount: 20, totalCount: 134 })).toBe("Showing 1–20 of 134");
    expect(formatShowingLabel({ offset: 20, pageCount: 14, totalCount: 134 })).toBe("Showing 21–34 of 134");
  });

  it("handles an empty page", () => {
    expect(formatShowingLabel({ offset: 0, pageCount: 0, totalCount: 0 })).toMatch(/no people/i);
  });

  it("composes a location from structured fields with a raw fallback", () => {
    expect(personLocation(person({ city: "Dublin", state: null, country: "Ireland" }))).toBe("Dublin, Ireland");
    expect(personLocation(person({ city: null, state: null, country: null, location: "Remote" }))).toBe("Remote");
    expect(personLocation(person({ city: null, state: null, country: null, location: null }))).toBe("—");
  });

  it("filters people locally by name, title or email", () => {
    const people = [person({ id: "a", fullName: "Ada Lovelace" }), person({ id: "b", fullName: "Alan Turing", inferredEmail: "alan@x.com" })];
    expect(filterPeopleByText(people, "turing").map((p) => p.id)).toEqual(["b"]);
    expect(filterPeopleByText(people, "alan@x").map((p) => p.id)).toEqual(["b"]);
    expect(filterPeopleByText(people, "")).toHaveLength(2);
  });
});

describe("Prospect Finder product copy", () => {
  const COPY = [
    PROSPECT_FINDER_TITLE,
    PROSPECT_FINDER_TAGLINE,
    PROSPECT_FINDER_SUBTITLE,
    PROSPECT_FINDER_UNAVAILABLE_TITLE,
    PROSPECT_FINDER_UNAVAILABLE_BODY
  ];

  it("uses the user-facing Prospect Finder name (#1)", () => {
    expect(PROSPECT_FINDER_TITLE).toBe("Prospect Finder");
  });

  it("never uses backend/debug language (#2, #3)", () => {
    for (const text of COPY) {
      expect(text).not.toMatch(/prospect graph/i);
      expect(text).not.toMatch(/graph enabled/i);
      expect(text).not.toMatch(/graphql/i);
      expect(text).not.toMatch(/PROSPECT_GRAPH_ENABLED/);
    }
  });

  it("shows a clean product message when unavailable", () => {
    expect(PROSPECT_FINDER_UNAVAILABLE_TITLE).toBe("Prospect Finder is not available right now.");
  });
});

describe("people pagination helpers", () => {
  it("derives an exact page count from the known total at 10 per page (#8)", () => {
    expect(resolvePageCount(24, 10)).toBe(3);
    expect(resolvePageCount(10, 10)).toBe(1);
    expect(resolvePageCount(11, 10)).toBe(2);
    expect(resolvePageCount(100, 10)).toBe(10);
    expect(resolvePageCount(0, 10)).toBe(1);
    expect(resolvePageCount(40, 0)).toBe(1);
  });

  it("formats a compact page label, never Previous/Next text (#8)", () => {
    expect(formatPageLabel({ pageIndex: 0, pageCount: 2 })).toBe("Page 1 of 2");
    expect(formatPageLabel({ pageIndex: 1, pageCount: 2 })).toBe("Page 2 of 2");
    const label = formatPageLabel({ pageIndex: 0, pageCount: 3 });
    expect(label).not.toMatch(/previous|next/i);
  });

  it("keeps the page index in range when the count lags behind", () => {
    expect(formatPageLabel({ pageIndex: 2, pageCount: 1 })).toBe("Page 3 of 3");
  });

  it("composes the 10-per-page range and page label for the toolbar", () => {
    const total = 24;
    const pageSize = 10;
    const pageIndex = 0;
    const pageCount = resolvePageCount(total, pageSize);
    expect(formatShowingLabel({ offset: pageIndex * pageSize, pageCount: pageSize, totalCount: total })).toBe(
      "Showing 1–10 of 24"
    );
    expect(formatPageLabel({ pageIndex, pageCount })).toBe("Page 1 of 3");
  });
});

describe("prospect selection helpers", () => {
  const scope = { companyId: "company_1", positionCategory: "SOFTWARE_ENGINEERING" as const };

  it("row selection toggles individual IDs", () => {
    const empty = createEmptyProspectSelection();
    const selected = toggleProspectSelection(empty, "p1", scope);
    expect(isProspectSelected(selected, "p1", scope)).toBe(true);
    expect(getProspectSelectionCount(selected, 0)).toBe(1);

    const cleared = toggleProspectSelection(selected, "p1", scope);
    expect(isProspectSelected(cleared, "p1", scope)).toBe(false);
    expect(getProspectSelectionCount(cleared, 0)).toBe(0);
  });

  it("header checkbox selects only the visible page IDs and supports indeterminate state", () => {
    const pageIds = Array.from({ length: 10 }, (_, index) => `p${index + 1}`);
    const selectedPage = togglePageProspectSelection(createEmptyProspectSelection(), pageIds, scope);
    expect(getPageSelectionState(selectedPage, pageIds, scope)).toBe("checked");
    expect(getProspectSelectionCount(selectedPage, 0)).toBe(10);

    const oneCleared = toggleProspectSelection(selectedPage, "p1", scope);
    expect(getPageSelectionState(oneCleared, pageIds, scope)).toBe("indeterminate");
    expect(isProspectSelected(oneCleared, "p2", scope)).toBe(true);
  });

  it("all-matching selection uses the active category and excludes IDs without storing every person", () => {
    const allMatching = selectAllMatchingProspects(scope);
    expect(getProspectSelectionCount(allMatching, 21)).toBe(21);
    expect(buildProspectSelectionInput(allMatching, "company_1")).toMatchObject({
      companyId: "company_1",
      mode: "ALL_MATCHING",
      positionCategory: "SOFTWARE_ENGINEERING"
    });

    const excluded = toggleProspectSelection(allMatching, "p5", scope);
    expect(isProspectSelected(excluded, "p5", scope)).toBe(false);
    expect(getProspectSelectionCount(excluded, 21)).toBe(20);
  });

  it("company changes clear selection by returning a fresh explicit state", () => {
    const selected = toggleProspectSelection(createEmptyProspectSelection(), "p1", scope);
    expect(getProspectSelectionCount(selected, 0)).toBe(1);
    expect(getProspectSelectionCount(createEmptyProspectSelection(), 0)).toBe(0);
  });
});

describe("external links are hardened (#12)", () => {
  it("opens LinkedIn in a new tab without leaking the opener", () => {
    expect(EXTERNAL_LINK_TARGET).toBe("_blank");
    expect(EXTERNAL_LINK_REL).toContain("noreferrer");
    expect(EXTERNAL_LINK_REL).toContain("noopener");
  });
});

describe("prospect dashboard layout contracts", () => {
  const dashboardSource = readFileSync("src/components/prospects/prospects-dashboard.tsx", "utf8");
  const dashboardCss = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");

  it("uses a natural-flow People table shell, not the horizontal history scroller", () => {
    expect(dashboardSource).toContain("styles.peopleTableShell");
    expect(dashboardSource).not.toContain("<div className={styles.tableScroll}>\n                    <PeopleTable");
    expect(dashboardCss).toMatch(/\.peopleTableShell\s*\{[^}]*overflow:\s*visible/s);
  });

  it("renders compact chevron pagination without Previous or Next text buttons", () => {
    expect(dashboardSource).toContain("<ChevronLeft");
    expect(dashboardSource).toContain("<ChevronRight");
    expect(dashboardSource).not.toContain(">Previous<");
    expect(dashboardSource).not.toContain(">Next<");
  });
});
