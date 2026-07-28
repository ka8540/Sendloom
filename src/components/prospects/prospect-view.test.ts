import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  DiscoverCompanyGroupNode,
  DiscoverQuota,
  PersonNode,
  ProspectSearchNode
} from "@/components/prospects/prospect-graphql";
import {
  ADD_MORE_DIALOG_NOTE,
  ADD_MORE_DIALOG_SUBTITLE,
  ADD_MORE_PEOPLE_LABEL,
  ANY_LOCATION_LABEL,
  COMPANY_SEARCH_LOADING_LABEL,
  EXTERNAL_LINK_REL,
  EXTERNAL_LINK_TARGET,
  INFERRED_EMAIL_NOTICE,
  NO_RESULTS_BACK_LABEL,
  NO_RESULTS_BODY,
  NO_RESULTS_COMPLETED_NOTE,
  NO_RESULTS_RETRY_LABEL,
  NO_RESULTS_TITLE,
  PROSPECT_FINDER_SUBTITLE,
  PROSPECT_FINDER_TAGLINE,
  PROSPECT_FINDER_TITLE,
  PROSPECT_FINDER_UNAVAILABLE_BODY,
  PROSPECT_FINDER_UNAVAILABLE_TITLE,
  addMoreDisabledReason,
  addMoreSearchLabel,
  buildLocationFilterOptions,
  canSearchCompanyAgain,
  companySearchDisabledReason,
  companySearchSuccessMessage,
  confidenceBadge,
  effectiveSearchStatus,
  formatCurrentPeopleLine,
  formatGroupCountLabel,
  formatSearchesRemainingLine,
  groupStatusBadge,
  groupedRoleLabels,
  resolveAddMoreTarget,
  resolveGroupOpenTarget,
  shouldShowAddMore,
  type AddMoreCandidateSearch,
  buildProspectSelectionInput,
  createEmptyProspectSelection,
  discoverPerSearchCopy,
  discoverPerSearchSentence,
  emailFormatEvidenceSummary,
  emailStatusBadge,
  clampPageIndex,
  filterHistoryGroups,
  filterPeopleByText,
  formatDateTime,
  formatFilteredGroupCountLabel,
  formatHistoryShowingLabel,
  formatPageLabel,
  paginateHistoryGroups,
  formatQuotaRemaining,
  formatQuotaReset,
  formatSearchError,
  formatShowingLabel,
  isEmailCopyable,
  isNoResultsSearch,
  isProcessQuotaBlocked,
  getPageSelectionState,
  getProspectSelectionCount,
  isProspectSelected,
  isVerifiedStatus,
  personLocation,
  resolveHistoryPageAfterDelete,
  resolvePageCount,
  resolveProspectPageState,
  resolveSelectedSearchView,
  selectAllMatchingProspects,
  statusBadge,
  togglePageProspectSelection,
  toggleProspectSelection
} from "@/components/prospects/prospect-view";

const STRUCTURED_EMAIL_DECISION = JSON.stringify({
  version: "structured-v2",
  decisionCode: "SOURCE_MAJORITY",
  supportingSourceCount: 3,
  conflictingSourceCount: 0,
  cacheKey: "structured-v2|walmart inc|walmart.com|walmart.com"
});

function quota(overrides: Partial<DiscoverQuota> = {}): DiscoverQuota {
  return {
    resultsPerSearch: 10,
    dailySearchLimit: 4,
    searchesUsed: 1,
    searchesRemaining: 3,
    resetAt: "2026-06-20T00:00:00.000Z",
    unlimited: false,
    ...overrides
  };
}

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
    errorTitle: null,
    errorMessage: null,
    retryable: false,
    peopleCount: 3,
    exhausted: false,
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

describe("compact email-format evidence summary", () => {
  const base = {
    emailFormatReason: STRUCTURED_EMAIL_DECISION,
    emailDomainConfidence: "HIGH" as const,
    patternConfidence: "HIGH" as const,
    selectedEmailDomain: "walmart.com",
    selectedPattern: "first.last",
    domainEvidence: [
      {
        emailDomain: "walmart.com",
        sourceUrl: "https://addtocrm.test/walmart",
        sourceName: "AddToCRM",
        sourceType: "public_format_page",
        observedPattern: "first.last",
        percentage: 51.8,
        confidence: "HIGH" as const,
        observedAt: "2026-07-04T00:00:00.000Z"
      }
    ],
    patternEvidence: [
      {
        pattern: "first.last",
        emailDomain: "walmart.com",
        sourceUrl: "https://addtocrm.test/walmart",
        sourceName: "AddToCRM",
        sourceType: "public_format_page",
        percentage: 51.8,
        confidence: "HIGH" as const,
        observedAt: "2026-07-04T00:00:00.000Z"
      }
    ]
  };

  it("renders agreement and conflict counts from structured metadata", () => {
    expect(emailFormatEvidenceSummary(base)).toBe("3 sources agree");
    expect(emailFormatEvidenceSummary({
      ...base,
      emailFormatReason: JSON.stringify({
        ...JSON.parse(STRUCTURED_EMAIL_DECISION),
        supportingSourceCount: 2,
        conflictingSourceCount: 1
      })
    })).toBe("2 sources agree · 1 source conflicts");
  });

  it("ignores historical prose and derives a compact single-source label", () => {
    expect(emailFormatEvidenceSummary({
      ...base,
      emailFormatReason: "Multiple public email-format pages identify Walmart's dominant format..."
    })).toBe("1 supporting source");
  });

  it("shows a deterministic review message for insufficient evidence", () => {
    expect(emailFormatEvidenceSummary({
      ...base,
      patternConfidence: "LOW",
      emailFormatReason: null
    })).toBe("Limited evidence · review before sending");
  });
});

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
  it("uses the server-sanitized safe title + message when present (#fe-2)", () => {
    const result = formatSearchError({
      errorCode: "COMPANY_NOT_FOUND",
      errorTitle: "We couldn't identify this company",
      errorMessage: "Check the company name and try again. Using the company's full legal name may help.",
      retryable: true
    });
    expect(result.title).toBe("We couldn't identify this company");
    expect(result.message).toMatch(/company name/i);
    expect(result.retryable).toBe(true);
  });

  it("never renders a raw internal code, even if one leaks into errorCode (#fe-1)", () => {
    const result = formatSearchError({
      errorCode: "COMPANY_UNRESOLVED",
      errorTitle: null,
      errorMessage: null,
      retryable: true
    });
    expect(`${result.title} ${result.message}`).not.toContain("COMPANY_UNRESOLVED");
    expect(result.title).toBe("We couldn't identify this company");
  });

  it("falls back to a generic safe message when nothing is provided (#fe-2)", () => {
    const result = formatSearchError({ errorCode: null, errorTitle: null, errorMessage: null, retryable: false });
    expect(result.title).toBe("Search unavailable");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("status badges", () => {
  it("marks READY as verified-tone and FAILED as blocked", () => {
    expect(statusBadge("READY").tone).toBe("verified");
    expect(statusBadge("FAILED").tone).toBe("blocked");
    expect(statusBadge("SEARCHING_PEOPLE").tone).toBe("inferred");
  });

  it("marks NO_RESULTS as a neutral muted badge — never Ready green or Failed red", () => {
    const badge = statusBadge("NO_RESULTS");
    expect(badge.label).toBe("No results");
    expect(badge.tone).toBe("muted");
    expect(badge.tone).not.toBe("verified");
    expect(badge.tone).not.toBe("blocked");
  });
});

describe("zero-result search state", () => {
  it("detects the explicit NO_RESULTS status", () => {
    expect(isNoResultsSearch({ status: "NO_RESULTS", peopleCount: 0 })).toBe(true);
  });

  it("detects a legacy zero-result row stored as READY with nobody processed", () => {
    expect(isNoResultsSearch({ status: "READY", peopleCount: 0 })).toBe(true);
  });

  it("never flags a normal READY search or an unfinished one", () => {
    expect(isNoResultsSearch({ status: "READY", peopleCount: 3 })).toBe(false);
    expect(isNoResultsSearch({ status: "SEARCHING_PEOPLE", peopleCount: 0 })).toBe(false);
    expect(isNoResultsSearch({ status: "FAILED", peopleCount: 0 })).toBe(false);
    expect(isNoResultsSearch({ status: "DRAFT", peopleCount: 0 })).toBe(false);
  });

  it("effectiveSearchStatus overlays NO_RESULTS onto legacy READY+0 rows only", () => {
    expect(effectiveSearchStatus({ status: "READY", peopleCount: 0 })).toBe("NO_RESULTS");
    expect(effectiveSearchStatus({ status: "NO_RESULTS", peopleCount: 0 })).toBe("NO_RESULTS");
    expect(effectiveSearchStatus({ status: "READY", peopleCount: 5 })).toBe("READY");
    expect(effectiveSearchStatus({ status: "FAILED", peopleCount: 0 })).toBe("FAILED");
  });

  it("resolves the 'no-results' view for NO_RESULTS and legacy READY+0 searches", () => {
    expect(resolveSelectedSearchView(search({ status: "NO_RESULTS", peopleCount: 0 }))).toBe("no-results");
    expect(resolveSelectedSearchView(search({ status: "READY", peopleCount: 0 }))).toBe("no-results");
    // A normal ready search is untouched.
    expect(resolveSelectedSearchView(search())).toBe("ready");
  });

  it("keeps the no-results copy neutral and free of backend terminology", () => {
    expect(NO_RESULTS_TITLE).toBe("Couldn't find any people for this search.");
    expect(NO_RESULTS_BODY).toBe("Try a different job title, location, or company spelling.");
    expect(NO_RESULTS_RETRY_LABEL).toBe("Search this company again");
    expect(NO_RESULTS_BACK_LABEL).toBe("Back to Discover");
    for (const copy of [NO_RESULTS_TITLE, NO_RESULTS_BODY, NO_RESULTS_COMPLETED_NOTE]) {
      expect(copy).not.toMatch(/provider|apify|pipeline|graph|resolver/i);
      expect(copy).not.toMatch(/fail/i);
    }
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

describe("Discover product copy", () => {
  const COPY = [
    PROSPECT_FINDER_TITLE,
    PROSPECT_FINDER_TAGLINE,
    PROSPECT_FINDER_SUBTITLE,
    PROSPECT_FINDER_UNAVAILABLE_TITLE,
    PROSPECT_FINDER_UNAVAILABLE_BODY
  ];

  it("uses the user-facing Discover name and requested subtitle", () => {
    expect(PROSPECT_FINDER_TITLE).toBe("Discover");
    expect(PROSPECT_FINDER_SUBTITLE).toBe(
      "Find relevant professionals by company, role, and location, then prepare their work contacts for outreach."
    );
  });

  it("never uses old product names or backend/debug language", () => {
    for (const text of COPY) {
      expect(text).not.toMatch(/prospect finder/i);
      expect(text).not.toMatch(/prospect graph/i);
      expect(text).not.toMatch(/audience builder/i);
      expect(text).not.toMatch(/contact discovery/i);
      expect(text).not.toMatch(/lead finder/i);
      expect(text).not.toMatch(/graph enabled/i);
      expect(text).not.toMatch(/graphql/i);
      expect(text).not.toMatch(/PROSPECT_GRAPH_ENABLED/);
    }
  });

  it("shows a clean product message when unavailable", () => {
    expect(PROSPECT_FINDER_UNAVAILABLE_TITLE).toBe("Discover is not available right now.");
  });
});

describe("Discover navigation and landing contracts", () => {
  const navSource = readFileSync("src/components/nav.tsx", "utf8");
  const landingSource = readFileSync("src/app/page.tsx", "utf8");

  it("keeps the existing route while branding the sidebar item as Discover", () => {
    const oldPluralLabel = "Pros" + "pects";

    expect(navSource).toContain('href: "/prospects" as Route');
    expect(navSource).toContain('label: "Discover"');
    expect(navSource).toContain("UserRoundSearch");
    expect(navSource).toContain("title={collapsed ? item.label : undefined}");
    expect(navSource).not.toContain(`label: "${oldPluralLabel}"`);
    expect(navSource).not.toContain("icon: Network");
  });

  it("adds Discover inside the existing landing capabilities grid without removing current items", () => {
    for (const title of [
      "Lead imports",
      "Hunter.io enrichment",
      "Template intelligence",
      "Gmail-connected sending",
      "Follow-up scheduling",
      "Delivery visibility"
    ]) {
      expect(landingSource).toContain(`title: "${title}"`);
    }

    expect(landingSource).toContain("UserRoundSearch");
    expect(landingSource).toContain('title: "Discover"');
    expect(landingSource).toContain(
      "Find relevant professionals by company, role, and location, then prepare their inferred work contacts for review."
    );
    expect(landingSource).toContain('tags: ["Company", "Role", "Location"]');
    expect(landingSource).toContain("className={`${styles.capCard} ${styles.fxCard}`}");
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

describe("Discover detail-page People table layout contracts", () => {
  const detailSource = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
  const css = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");

  it("uses a natural-flow People table shell with no internal vertical scroll (#7 layout)", () => {
    expect(detailSource).toContain("styles.peopleTableShell");
    expect(css).toMatch(/\.peopleTableShell\s*\{[^}]*overflow:\s*visible/s);
    // The People shell must not introduce vertical scrolling / fixed heights.
    const shellBlock = css.match(/\.peopleTableShell\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(shellBlock).not.toMatch(/overflow-y|max-height|height:\s*\d|calc\(100vh/);
  });

  it("gives People rows horizontal edge padding so content never touches the card border (#4, #5, #6)", () => {
    const rowBlock = css.match(/\n\.row\s*\{[^}]*\}/s)?.[0] ?? "";
    // Padding shorthand is `vertical horizontal` — the horizontal value must be > 0.
    expect(rowBlock).toMatch(/padding:\s*0\.85rem\s+0\.9rem/);
    expect(css).toMatch(/\.cellSelect\s*\{[^}]*padding-left/s);
    expect(css).toMatch(/\.cellLink\s*\{[^}]*padding-right/s);
    // The LinkedIn header/column gets its own right padding so it is never flush.
    expect(css).toMatch(/\.linkedinHead\s*\{[^}]*padding-right/s);
  });

  it("wraps long People text instead of truncating with an ellipsis (no '…', no scroll)", () => {
    for (const cls of [".personName", ".cellTitle", ".emailText"]) {
      const block = css.match(new RegExp(`\\n\\${cls}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
      expect(block).not.toContain("text-overflow: ellipsis");
      expect(block).not.toContain("white-space: nowrap");
      expect(block).toContain("overflow-wrap: anywhere");
    }
    // Text columns use minmax(0, …) so they shrink + wrap rather than overflow.
    const rowBlock = css.match(/\n\.row\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rowBlock).toContain("minmax(0,");
  });

  it("keeps pagination outside the table shell and uses compact chevrons (#8 layout)", () => {
    expect(detailSource).toContain("<ChevronLeft");
    expect(detailSource).toContain("<ChevronRight");
    expect(detailSource).not.toContain(">Previous<");
    expect(detailSource).not.toContain(">Next<");
    // The pagination row is a sibling of the table shell, not nested inside it.
    expect(detailSource).not.toContain('peopleTableShell" data-discover-tour="people-table">\n                <div className={styles.paginationRow}');
  });
});

describe("resolveHistoryPageAfterDelete", () => {
  it("steps back to the previous page when a later page is emptied (#13)", () => {
    expect(resolveHistoryPageAfterDelete({ remainingOnPage: 0, pageIndex: 2 })).toEqual({
      goToPreviousPage: true,
      pageIndex: 1
    });
  });

  it("stays on the first page even when emptied (the empty state takes over)", () => {
    expect(resolveHistoryPageAfterDelete({ remainingOnPage: 0, pageIndex: 0 })).toEqual({
      goToPreviousPage: false,
      pageIndex: 0
    });
  });

  it("stays on the current page when rows remain (#15)", () => {
    expect(resolveHistoryPageAfterDelete({ remainingOnPage: 6, pageIndex: 3 })).toEqual({
      goToPreviousPage: false,
      pageIndex: 3
    });
  });
});

describe("Discover Search History delete action + confirmation dialog", () => {
  const listSource = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
  const css = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");

  it("renders an icon-only Trash delete button with a company-specific label + tooltip (#1-dialog, #3)", () => {
    expect(listSource).toContain('<Trash2 aria-hidden="true" />');
    expect(listSource).toContain("aria-label={`Delete ${companyName} from Discover`}");
    expect(listSource).toContain('title="Delete from Discover"');
  });

  it("never uses native browser dialogs for this action (#1, #4)", () => {
    expect(listSource).not.toContain("window.confirm(");
    expect(listSource).not.toContain("window.alert(");
    expect(listSource).not.toContain("window.prompt(");
  });

  it("opens the in-app dialog on trash click without navigating or deleting (#2, #5, #13)", () => {
    // The trash button blocks row navigation and only requests the dialog.
    expect(listSource).toContain("event.preventDefault();");
    expect(listSource).toContain("event.stopPropagation();");
    expect(listSource).toContain("onRequestDelete(group, event.currentTarget)");
    // Requesting just records state — no mutation runs here.
    expect(listSource).toContain("setSearchPendingDeletion(group)");
    expect(listSource).toContain("<DeleteSearchDialog");
  });

  it("derives the company name from state (not the DOM) and never shows technical detail (#3, #4)", () => {
    expect(listSource).toContain("const companyName = search.company?.name ?? search.displayName");
    expect(listSource).toContain("allocated Discover results");
    // The dialog is explicit that the shared cross-user cache is untouched.
    expect(listSource).toContain("Shared cached company data and other users’ searches are not affected.");
    // Company name comes from the pending-group object, never scraped from the DOM.
    expect(listSource).not.toContain("document.querySelector");
  });

  it("renders a Sendloom alertdialog with accessible title + description (#14)", () => {
    expect(listSource).toContain('role="alertdialog"');
    expect(listSource).toContain('aria-labelledby={titleId}');
    expect(listSource).toContain('aria-describedby={descId}');
    expect(listSource).toContain("{`Delete ${companyName} from Discover?`}");
    // Reuses the existing modal surface + adds the compact confirm classes.
    expect(listSource).toContain("styles.modalOverlay");
    expect(listSource).toContain("styles.confirmCard");
    expect(css).toMatch(/\.confirmCard\s*\{/);
    expect(css).toMatch(/\.confirmIcon\s*\{/);
  });

  it("only deletes on explicit confirm, then removes the row + count + toast after success (#6, #8, #10, #11)", () => {
    // Confirm is the only place the mutations run: a grouped company entry
    // deletes the user's whole company (all role searches + allocations); an
    // unresolved single-search entry deletes just that search.
    expect(listSource).toContain("const handleConfirmDelete = useCallback(async () => {");
    expect(listSource).toContain("DELETE_COMPANY_MUTATION");
    expect(listSource).toContain("DELETE_SEARCH_MUTATION");
    expect(listSource).toContain("if (!group || deleting)");
    expect(listSource).toContain("setSearches(remaining)");
    expect(listSource).toContain("setSearchesTotal((total) => Math.max(0, total - 1))");
    // Success path: close + toast happen only after a confirmed deletion.
    expect(listSource).toContain("was removed from Discover.");
  });

  it("cancel/escape/backdrop close without deleting and never while in flight (#6, #7, #9)", () => {
    // Cancel clears state + returns focus to the trigger; gated while deleting.
    expect(listSource).toContain("const handleCancelDelete = useCallback(() => {");
    expect(listSource).toContain("setSearchPendingDeletion(null)");
    expect(listSource).toContain("deleteTriggerRef.current?.focus()");
    // Escape + backdrop are both disabled mid-delete.
    expect(listSource).toContain('event.key === "Escape" && !deleting');
    expect(listSource).toContain("event.target === event.currentTarget && !deleting");
  });

  it("shows a disabling Delete control with a Deleting… state and a safe failure message (#9, #12)", () => {
    expect(listSource).toContain('disabled={deleting}');
    expect(listSource).toContain('"Deleting…"');
    // Failure keeps the dialog open with a safe message — never a raw backend error.
    expect(listSource).toContain('setDeleteError("This company could not be deleted. Please try again.")');
  });

  it("keeps the existing pagination edge handling (#15)", () => {
    expect(listSource).toContain("resolveHistoryPageAfterDelete");
  });

  it("keeps the Search History row itself icon-only (no visible Delete/Remove text node)", () => {
    expect(listSource).not.toMatch(/>\s*Delete search\s*</);
    expect(listSource).not.toMatch(/>\s*Remove\s*</);
  });
});

describe("Discover failed-state UI is safe and retryable", () => {
  const detailSource = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");

  it("never renders the raw error code chip (#fe-1, #fe-2)", () => {
    // The old failed card rendered `{error?.code}` inside a styles.errorCode chip.
    expect(detailSource).not.toContain("styles.errorCode");
    expect(detailSource).not.toContain("error?.code");
    // It renders the safe title + message instead.
    expect(detailSource).toContain("{error?.title}");
    expect(detailSource).toContain("{error?.message}");
  });

  it("shows a disabling Retry button with a 'Retrying search…' label (#fe-3, #fe-4, #fe-5)", () => {
    expect(detailSource).toContain("Retrying search…");
    expect(detailSource).toContain("Retry search");
    // The button disables while processing (guards double-clicks).
    expect(detailSource).toContain("disabled={processing || quotaBlocked}");
  });

  it("offers a Back to Discover action on the failed card (#fe-2)", () => {
    expect(detailSource).toContain("Back to Discover");
  });

  it("sends a per-click idempotency key and guards re-entry (#fe-3, #retry-16, #retry-17)", () => {
    expect(detailSource).toContain("crypto.randomUUID()");
    expect(detailSource).toContain("{ id: search.id, idempotencyKey }");
    // Re-entry guard so a second click never fires a second mutation.
    expect(detailSource).toContain("if (!search || processing)");
  });

  it("does not reload the whole page on retry (uses the in-place loader) (#fe-7)", () => {
    expect(detailSource).not.toContain("window.location.reload");
  });
});

describe("Discover quota presentation helpers", () => {
  it("states the fixed per-search count (#2)", () => {
    expect(discoverPerSearchCopy(null)).toBe("Up to 10 people per search");
    expect(discoverPerSearchSentence(null)).toBe("Each search returns up to 10 people.");
    expect(discoverPerSearchCopy(quota({ resultsPerSearch: 10 }))).toBe("Up to 10 people per search");
  });

  it("shows an ordinary user's remaining count (#3)", () => {
    expect(formatQuotaRemaining(quota({ searchesUsed: 1, searchesRemaining: 3 }))).toBe(
      "3 of 4 searches remaining today"
    );
    expect(formatQuotaRemaining(quota({ searchesUsed: 4, searchesRemaining: 0 }))).toBe(
      "0 of 4 searches remaining today"
    );
  });

  it("hides the remaining count for the exempt account (#6)", () => {
    expect(formatQuotaRemaining(quota({ unlimited: true }))).toBeNull();
    expect(formatQuotaRemaining(null)).toBeNull();
  });

  it("renders a day-qualified reset label so a bare time is never ambiguous (#4)", () => {
    // Local-component dates keep the calendar-day diff stable across machine
    // timezones (the formatter also renders in local time).
    const now = new Date(2026, 5, 20, 9, 0, 0);
    const todayReset = new Date(2026, 5, 20, 17, 0, 0);
    const tomorrowReset = new Date(2026, 5, 21, 17, 0, 0);
    const laterReset = new Date(2026, 5, 25, 17, 0, 0);

    expect(formatQuotaReset({ resetAt: todayReset.toISOString() }, now)).toMatch(/^Resets today at .+\d/);
    expect(formatQuotaReset({ resetAt: tomorrowReset.toISOString() }, now)).toMatch(/^Resets tomorrow at .+\d/);
    expect(formatQuotaReset({ resetAt: laterReset.toISOString() }, now)).toMatch(/^Resets \w.* at .+\d/);
    // Never the old ambiguous "Resets at <time>" with no day.
    expect(formatQuotaReset({ resetAt: tomorrowReset.toISOString() }, now)).not.toMatch(/^Resets at /);

    expect(formatQuotaReset(null)).toBeNull();
    expect(formatQuotaReset({ resetAt: "not-a-date" })).toBeNull();
  });

  it("blocks Process only for a new draft when the quota is spent (#5)", () => {
    const spent = quota({ searchesUsed: 4, searchesRemaining: 0 });
    expect(isProcessQuotaBlocked(spent, "DRAFT")).toBe(true);
    // A started/failed search already holds its slot, so retry stays enabled.
    expect(isProcessQuotaBlocked(spent, "FAILED")).toBe(false);
    // With slots left, nothing is blocked.
    expect(isProcessQuotaBlocked(quota({ searchesRemaining: 2 }), "DRAFT")).toBe(false);
  });

  it("never blocks the exempt account (#6)", () => {
    const unlimited = quota({ unlimited: true, searchesRemaining: 0 });
    expect(isProcessQuotaBlocked(unlimited, "DRAFT")).toBe(false);
    expect(isProcessQuotaBlocked(null, "DRAFT")).toBe(false);
  });
});

describe("Add 10 more presentation helpers", () => {
  it("shows the button for any READY search whose company can be searched again (#1, #2)", () => {
    expect(shouldShowAddMore({ view: "ready", status: "READY", canSearchAgain: true })).toBe(true);
    // DRAFT / PROCESSING / FAILED → hidden (#2).
    expect(shouldShowAddMore({ view: "none", status: "DRAFT", canSearchAgain: true })).toBe(false);
    expect(shouldShowAddMore({ view: "processing", status: "SEARCHING_PEOPLE", canSearchAgain: true })).toBe(false);
    expect(shouldShowAddMore({ view: "failed", status: "FAILED", canSearchAgain: true })).toBe(false);
    // Nothing to search again with (no company identity at all) → hidden.
    expect(shouldShowAddMore({ view: "ready", status: "READY", canSearchAgain: false })).toBe(false);
  });

  it("resolves can-search-again from company identity only", () => {
    expect(canSearchCompanyAgain({ name: "Compa" })).toBe(true);
    // A domain alone is enough — a blank name never removes the button.
    expect(canSearchCompanyAgain({ name: "   ", officialDomain: "compa.com" })).toBe(true);
    expect(canSearchCompanyAgain({ officialWebsiteDomain: "compa.com" })).toBe(true);
    expect(canSearchCompanyAgain({ emailDomain: "compa.com" })).toBe(true);
    expect(canSearchCompanyAgain({ name: "", officialDomain: null, emailDomain: null })).toBe(false);
    expect(canSearchCompanyAgain(null)).toBe(false);
  });

  /**
   * The regression this guards: successive email-format / invalid-status work
   * kept wiring row-level state into Add-more visibility, and the button
   * vanished. Visibility is a property of the SEARCH, so none of the people /
   * filter / email-status inputs may even be accepted by the helper.
   */
  it("never hides Add 10 more for people, filter, or email state (#10)", () => {
    const visible = { view: "ready", status: "READY", canSearchAgain: true } as const;
    // An exhausted provider, an empty filtered page, all-invalid emails: the
    // helper cannot see any of them, so it still shows the button.
    expect(shouldShowAddMore(visible)).toBe(true);

    // The helper's contract is the whole guard: it takes company searchability
    // and search state — nothing that describes the rows on screen.
    const source = readFileSync("src/components/prospects/prospect-view.ts", "utf8");
    const helper = source.match(/export function shouldShowAddMore\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(helper).toContain("canSearchAgain");
    for (const banned of [
      "hasResults",
      "peopleCount",
      "filteredPeople",
      "paginatedPeople",
      "visiblePeople",
      "validPeople",
      "invalidPeople",
      "roleGroups",
      "selectedRole",
      "activeCategory",
      "emailStatus",
      "emailConfidence",
      "exhausted"
    ]) {
      expect(helper).not.toContain(banned);
    }
  });

  it("keeps the detail page's Add-more visibility off row/filter state", () => {
    const detailSource = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
    const call = detailSource.match(/const showAddMore =[\s\S]*?\}\);/)?.[0] ?? "";
    expect(call).toContain("canSearchCompanyAgain");
    for (const banned of [
      "hasResults",
      "peopleCount",
      "visiblePeople",
      "people.length",
      "activeCategory",
      "activeLocation",
      "emailStatus",
      "exhausted"
    ]) {
      expect(call).not.toContain(banned);
    }
    // A 0-result expansion answers in the centered dialog, and never by
    // freezing the button out of the header.
    expect(detailSource).toContain("NoMorePeopleDialog");
    expect(detailSource).toContain("setNoMorePeopleOpen(true)");
    expect(detailSource).not.toContain("sessionExhausted");
  });

  it("disables the button while expanding or when the daily allowance is spent (#5)", () => {
    expect(addMoreDisabledReason(quota({ searchesRemaining: 3 }), false)).toBeNull();
    // Disabled (with a reason) while an expansion runs (#5).
    expect(addMoreDisabledReason(quota({ searchesRemaining: 3 }), true)).toBe("Adding new people…");
    // Disabled when no daily quota remains.
    expect(addMoreDisabledReason(quota({ searchesRemaining: 0 }), false)).toMatch(/used today's Discover searches/);
    // Exempt accounts are never blocked by quota.
    expect(addMoreDisabledReason(quota({ unlimited: true, searchesRemaining: 0 }), false)).toBeNull();
  });

  it("renders the current people count and remaining quota for the dialog (#4)", () => {
    expect(formatCurrentPeopleLine(10)).toBe("Current people: 10");
    expect(formatSearchesRemainingLine(quota({ searchesRemaining: 3 }))).toBe("Searches remaining today: 3");
    expect(formatSearchesRemainingLine(quota({ unlimited: true }))).toBe("Searches remaining today: Unlimited");
  });

  it("keeps the dialog copy short: a one-line subtitle plus a small muted note (#3)", () => {
    expect(ADD_MORE_DIALOG_SUBTITLE).toBe("Find up to 10 more matching contacts for this role.");
    expect(ADD_MORE_DIALOG_NOTE).toBe("Existing people won't be repeated.");
    expect(ADD_MORE_PEOPLE_LABEL).toBe("Add 10 more");
  });
});

describe("Discover create modal contracts (list page)", () => {
  const listSource = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");

  it("removes the Max results input (#1)", () => {
    expect(listSource).not.toContain("Max results");
    expect(listSource).not.toContain('type="number"');
  });

  it("does not let the client choose or send a result count (#8)", () => {
    expect(listSource).not.toContain("maxResults");
  });

  it("renders the fixed-count helper and quota panel in the modal", () => {
    expect(listSource).toContain("DiscoverUsagePanel");
    expect(listSource).toContain("discoverPerSearchSentence");
  });

  it("refreshes the quota on the list page (#7)", () => {
    expect(listSource).toContain("loadQuota");
    expect(listSource).toContain("DISCOVER_QUOTA_QUERY");
  });
});

describe("Add 10 more detail-page wiring", () => {
  const detailSource = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
  const listSource = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");

  it("renders the Add-more button only on the detail page with a stable help target (existing #1)", () => {
    expect(detailSource).toContain('data-discover-tour="add-more-people"');
    expect(detailSource).toContain("UserPlus");
    expect(detailSource).toContain("showAddMore");
    // The list page never renders Add 10 more.
    expect(listSource).not.toContain("add-more-people");
    expect(listSource).not.toContain("ADD_MORE_DISCOVER_PEOPLE_MUTATION");
  });

  it("disables the button while an expansion runs so rapid clicks cannot duplicate (existing #5)", () => {
    expect(detailSource).toContain("setExpanding(true)");
    expect(detailSource).toContain("disabled={addMoreDisabled !== null}");
  });

  it("opens a confirmation dialog before expanding", () => {
    expect(detailSource).toContain("AddMorePeopleDialog");
    expect(detailSource).toContain("setShowAddMoreDialog(true)");
  });

  it("updates counts + people in place without a full-page reload (existing #6, #7, #9)", () => {
    expect(detailSource).toContain("ADD_MORE_DISCOVER_PEOPLE_MUTATION");
    // Refreshes company (totals), people (pagination), and the search in place,
    // preserving BOTH active filters (role + location).
    expect(detailSource).toMatch(
      /await loadPeople\(\{\s*companyId: search\.company\.id,\s*category: activeCategory,\s*location: activeLocation,\s*pageIndex: 0,\s*after: null\s*\}\)/
    );
    expect(detailSource).toContain("await loadDetail({ category: activeCategory, location: activeLocation })");
    // No hard navigation / full reload.
    expect(detailSource).not.toContain("window.location.reload");
  });

  it("keeps the People page size fixed at 10 (existing #8)", () => {
    expect(detailSource).toContain("PEOPLE_PAGE_SIZE");
    expect(readFileSync("src/components/prospects/prospect-graphql.ts", "utf8")).toContain("PEOPLE_PAGE_SIZE = 10");
  });
});

describe("Add more people dialog UI polish", () => {
  const detailSource = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
  const css = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");
  const dialogSource =
    detailSource.match(/function AddMorePeopleDialog\([\s\S]*?\nfunction ProspectReviewDialog\(/)?.[0] ?? "";

  it("renders the short title/subtitle/note copy plus the compact summary rows", () => {
    expect(dialogSource).toContain("ADD_MORE_DIALOG_TITLE");
    expect(dialogSource).toContain("ADD_MORE_DIALOG_SUBTITLE");
    expect(dialogSource).toContain("ADD_MORE_DIALOG_NOTE");
    // No leftover reference to the old multi-sentence paragraph constant.
    expect(dialogSource).not.toContain("ADD_MORE_DIALOG_BODY");
    expect(dialogSource).toContain("<dt>Role / location</dt>");
    expect(dialogSource).toContain("<dt>Current people</dt>");
    expect(dialogSource).toContain("<dt>Searches left</dt>");
    // The stat values are untouched.
    expect(dialogSource).toContain("{Math.max(0, peopleCount)}");
    expect(dialogSource).toContain('{quota && !quota.unlimited ? quota.searchesRemaining : "Unlimited"}');
  });

  it("keeps the role-group select controlled with its existing options, value, and handler", () => {
    expect(dialogSource).toContain("value={chosenSearchId}");
    expect(dialogSource).toContain("setChosenSearchId(event.target.value)");
    expect(dialogSource).toContain("addMoreSearchLabel(option)");
    expect(dialogSource).toContain("{ADD_MORE_CHOOSE_ROLE_HINT}");
  });

  it("keeps the accessible label on the role-group select", () => {
    expect(dialogSource).toContain('aria-label="Role group to extend"');
    expect(dialogSource).toContain("<span className={styles.fieldLabel}>Role group</span>");
  });

  it("keeps Cancel, the close X, and the confirm handler wired", () => {
    expect(dialogSource).toContain('<CircularCloseButton compact label="Close" onClick={onClose} disabled={expanding} />');
    expect(dialogSource).toContain("onClick={onClose} disabled={expanding}>");
    expect(dialogSource).toContain("onConfirm(resolvedSearchId)");
    expect(dialogSource).toContain("disabled={expanding || !resolvedSearchId}");
  });

  it("uses the exact shared Sequence-page pill button classes for Cancel and Confirm", () => {
    // Same global .button / .button.secondary classes the Sequences page uses
    // for its primary/secondary actions — not a locally-styled button.
    expect(dialogSource).toContain('className="button secondary"');
    expect(dialogSource).toContain('className="button"');
    expect(dialogSource).not.toContain("styles.ghostButton");
    expect(dialogSource).not.toContain("styles.primaryButton");
  });

  it("scopes every polish rule under .addMoreCard/.addMoreSummary so other dialogs are untouched", () => {
    expect(dialogSource).toContain("styles.addMoreCard");
    expect(dialogSource).toContain("styles.addMoreSummary");
    expect(dialogSource).toContain("styles.addMoreSummaryRow");
    expect(dialogSource).toContain("styles.addMoreNote");
    // The block exists and only ships .addMoreCard-prefixed selectors (plus the
    // dedicated .addMoreSummary* / .addMoreNote classes it introduces).
    const rules = css.match(/^\.addMoreCard[^{]*\{|^\.addMoreSummary[^{]*\{|^\.addMoreNote[^{]*\{/gm) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(8);
  });

  it("replaces the raw browser select look with the shared custom caret", () => {
    // The role-group select opts into the shared caret treatment…
    expect(dialogSource).toMatch(/select\s+className=\{`\$\{styles\.input\} \$\{styles\.selectField\}`\}/);
    // …which suppresses the native arrow and paints a right-aligned chevron.
    expect(css).toMatch(/\.selectField\s*\{[^}]*appearance:\s*none/s);
    expect(css).toMatch(/\.selectField\s*\{[^}]*background-position:\s*right/s);
    // Dialog-scoped sizing keeps the selected text clear of the caret.
    expect(css).toMatch(/\.addMoreCard \.selectField\s*\{[^}]*padding:\s*0 2\.35rem 0 0\.8rem/s);
  });

  it("keeps the dialog typography compact (no oversized type)", () => {
    const blocks = css.match(/\.addMoreCard[^{]*\{[^}]*\}|\.addMoreSummary[^{]*\{[^}]*\}|\.addMoreNote[^{]*\{[^}]*\}/gs) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const block of blocks) {
      const size = block.match(/font-size:\s*([\d.]+)rem/);
      if (size) {
        expect(Number.parseFloat(size[1])).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it("uses compact Sequence control sizing and prevents the action row from overflowing", () => {
    expect(css).toMatch(/\.addMoreCard \.modalActions :global\(\.button\)\s*\{[^}]*min-height: 2\.6rem;[^}]*padding: 0\.58rem 0\.9rem;[^}]*font-size: 0\.86rem;/s);
    expect(css).toMatch(/\.addMoreCard \.modalActions\s*\{[^}]*width: 100%;[^}]*flex-wrap: nowrap;[^}]*min-width: 0;/s);
    expect(css).toMatch(/\.addMoreCard \.modalActions :global\(\.button\)\s*\{[^}]*min-width: 0;[^}]*max-width: 100%;/s);
  });

  it("stacks the compact rows and actions instead of squeezing them on narrow phones", () => {
    expect(css).toMatch(/@media \(max-width: 22rem\)\s*\{\s*\.addMoreSummaryRow\s*\{\s*grid-template-columns: 1fr;/s);
    expect(css).toMatch(/@media \(max-width: 22rem\)[\s\S]*\.addMoreCard \.modalActions\s*\{\s*display: grid;\s*grid-template-columns: 1fr;/s);
  });
});

describe("No more people found dialog", () => {
  const detailSource = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
  const css = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");
  const dialogSource =
    detailSource.match(/function NoMorePeopleDialog\([\s\S]*?\nfunction ProspectReviewDialog\(/)?.[0] ?? "";

  it("composes as medallion + title row, then a full-width sentence, then the hint band", () => {
    expect(dialogSource).toContain("styles.outcomeIcon");
    expect(dialogSource).toContain("styles.outcomeTitle");
    expect(dialogSource).toContain("styles.outcomeBody");
    expect(dialogSource).toContain("styles.outcomeHint");
    // The sentence is a sibling of the head, not a cell inside it — that is what
    // keeps it off the narrow gutter left by the close button.
    expect(dialogSource).toMatch(/<\/div>\s*\n\s*<p id="discover-no-more-people-body" className=\{styles\.outcomeBody\}>/);
  });

  /**
   * Close is the ONLY action, by explicit product decision: this dialog reports
   * an outcome, it does not sell the next search. Starting one belongs to the
   * page's own "Search this company" control.
   */
  it("offers exactly one action — Close — and never launches another search", () => {
    expect(dialogSource).toContain("{ADD_MORE_NO_RESULTS_CLOSE_LABEL}");
    const buttons = dialogSource.match(/<button\b/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(dialogSource).not.toContain("COMPANY_SEARCH_BUTTON_LABEL");
    expect(dialogSource).not.toContain("onSearchCompany");
    expect(dialogSource).not.toContain("setCompanySearchOpen");
    // The parent mounts it with a close handler and nothing else.
    expect(detailSource).toContain(
      "<NoMorePeopleDialog open={noMorePeopleOpen} onClose={() => setNoMorePeopleOpen(false)} />"
    );
  });

  it("behaves like the app's other dialogs: escape, backdrop, and focus on the way out", () => {
    expect(dialogSource).toContain('event.key === "Escape"');
    expect(dialogSource).toContain("event.target === event.currentTarget");
    expect(dialogSource).toContain("closeRef.current?.focus()");
    expect(dialogSource).toContain('aria-describedby="discover-no-more-people-body"');
  });

  it("scopes every rule under .outcome* so the other dialogs keep their shape", () => {
    expect(dialogSource).toContain("styles.outcomeCard");
    const rules = css.match(/^\.outcome[^{]*\{/gm) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(6);
    // Compact type, same scale as the dialog it answers.
    const blocks = css.match(/\.outcome[^{]*\{[^}]*\}/gs) ?? [];
    for (const block of blocks) {
      const size = block.match(/font-size:\s*([\d.]+)rem/);
      if (size) {
        expect(Number.parseFloat(size[1])).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it("keeps the action row on one row until the card is genuinely too narrow", () => {
    expect(css).toMatch(/\.outcomeCard \.modalActions\s*\{[^}]*flex-wrap: nowrap;[^}]*min-width: 0;/s);
    expect(css).toMatch(/@media \(max-width: 24rem\)[\s\S]*\.outcomeCard \.modalActions\s*\{\s*display: grid;\s*grid-template-columns: 1fr;/s);
  });
});

describe("Discover list/detail split contracts", () => {
  const listSource = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
  const detailSource = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");

  it("list page shows Search History but not the People table or company details (#2, #3 routing)", () => {
    expect(listSource).toContain('data-discover-tour="search-history"');
    expect(listSource).not.toContain("PeopleTable");
    expect(listSource).not.toContain("CompanyCard");
    expect(listSource).not.toContain("SummaryCards");
  });

  it("list rows navigate to the detail route (#4 routing)", () => {
    // A grouped company row opens the detail page of its best child search.
    expect(listSource).toContain("href={`/prospects/${openTarget.id}`");
    expect(listSource).toContain("resolveGroupOpenTarget(group.searches)");
    // The first row carries the search-row tour target (set dynamically).
    expect(listSource).toContain('"search-row"');
  });

  it("detail page renders the quality summary, email-format panel, and the People table (#1, #2, #3 layout)", () => {
    expect(detailSource).toContain("ResultsQualityCard");
    expect(detailSource).toContain("EmailFormatPanel");
    expect(detailSource).toContain("PeopleTable");
  });

  it("detail recovers to Discover (not Overview) and adds no second in-page back button (#7 routing)", () => {
    // The not-found state links back to the Discover list, never to Overview.
    expect(detailSource).toContain('href="/prospects"');
    expect(detailSource).not.toContain('href="/workspace"');
    // Back navigation reuses the app shell's global back button — the detail page
    // must not render its own duplicate back control.
    expect(detailSource).not.toContain("BackToDiscover");
    expect(detailSource).not.toContain('data-discover-tour="back-to-list"');
  });

  it("detail page loads the search from the route id and handles not-found safely (#5, #6, #8 routing)", () => {
    expect(detailSource).toContain("PROSPECT_SEARCH_BY_ID_QUERY");
    expect(detailSource).toContain("This Discover search is no longer available.");
  });
});

describe("grouped Search History helpers", () => {
  it("derives Processing when any child search is running (#26)", () => {
    expect(groupStatusBadge(["READY", "SEARCHING_PEOPLE"]).label).toBe("Processing");
    expect(groupStatusBadge(["FAILED", "INFERRING_EMAIL_PATTERN"]).label).toBe("Processing");
  });

  it("derives Needs attention when one role search failed while another is usable (#26)", () => {
    const badge = groupStatusBadge(["READY", "FAILED"]);
    expect(badge.label).toBe("Needs attention");
    expect(badge.tone).toBe("warning");
  });

  it("derives Ready when at least one child is ready and none failed or run (#26)", () => {
    expect(groupStatusBadge(["READY"]).label).toBe("Ready");
    expect(groupStatusBadge(["READY", "CANCELED"]).label).toBe("Ready");
  });

  it("derives Failed only when every non-canceled child failed (#26)", () => {
    expect(groupStatusBadge(["FAILED", "FAILED"]).label).toBe("Failed");
    expect(groupStatusBadge(["FAILED", "CANCELED"]).label).toBe("Failed");
  });

  it("derives Draft for an all-draft group (#26)", () => {
    expect(groupStatusBadge(["DRAFT"]).label).toBe("Draft");
  });

  it("derives No results when children completed but nobody was found", () => {
    expect(groupStatusBadge(["NO_RESULTS"]).label).toBe("No results");
    expect(groupStatusBadge(["NO_RESULTS", "CANCELED"]).label).toBe("No results");
    // A sibling with people still wins; a running sibling still reads Processing.
    expect(groupStatusBadge(["NO_RESULTS", "READY"]).label).toBe("Ready");
    expect(groupStatusBadge(["NO_RESULTS", "SEARCHING_PEOPLE"]).label).toBe("Processing");
    // A failed sibling next to a no-result one still needs attention.
    expect(groupStatusBadge(["NO_RESULTS", "FAILED"]).label).toBe("Needs attention");
  });

  it("opens the newest READY child, else the newest actionable child (#28)", () => {
    const searches = [
      { id: "s_old_ready", status: "READY" as const, createdAt: "2026-07-01T00:00:00.000Z" },
      { id: "s_failed", status: "FAILED" as const, createdAt: "2026-07-04T00:00:00.000Z" },
      { id: "s_new_ready", status: "READY" as const, createdAt: "2026-07-03T00:00:00.000Z" }
    ];
    expect(resolveGroupOpenTarget(searches)?.id).toBe("s_new_ready");
    expect(
      resolveGroupOpenTarget([
        { id: "s_failed", status: "FAILED" as const, createdAt: "2026-07-04T00:00:00.000Z" },
        { id: "s_canceled", status: "CANCELED" as const, createdAt: "2026-07-05T00:00:00.000Z" }
      ])?.id
    ).toBe("s_failed");
    expect(resolveGroupOpenTarget([])).toBeNull();
  });

  it("labels the grouped panel by companies, not raw searches (#23)", () => {
    expect(formatGroupCountLabel(1)).toBe("1 company");
    expect(formatGroupCountLabel(3)).toBe("3 companies");
  });

  it("collects distinct role labels across a company's child searches", () => {
    expect(
      groupedRoleLabels([
        { requestedTitles: ["Software Engineer"] },
        { requestedTitles: ["software engineer", "Recruiter"] }
      ])
    ).toEqual(["Software Engineer", "Recruiter"]);
  });
});

describe("role-targeted Add 10 more (#35-#38)", () => {
  function candidate(overrides: Partial<AddMoreCandidateSearch> & { id: string }): AddMoreCandidateSearch {
    return {
      status: "READY",
      requestedTitles: ["Software Engineer"],
      requestedLocations: [],
      positionCategories: ["SOFTWARE_ENGINEERING"],
      createdAt: "2026-07-04T10:00:00.000Z",
      ...overrides
    };
  }

  const engineer = candidate({ id: "s_engineer" });
  const recruiter = candidate({
    id: "s_recruiter",
    requestedTitles: ["Recruiter"],
    positionCategories: ["RECRUITING"],
    createdAt: "2026-07-04T09:00:00.000Z"
  });

  it("targets the single ready search directly", () => {
    const target = resolveAddMoreTarget({ activeCategory: null, searches: [engineer], currentSearchId: "s_engineer" });
    expect(target).toEqual({ kind: "search", search: engineer });
  });

  it("an active role tab pins the matching child search (#35, #37)", () => {
    const target = resolveAddMoreTarget({
      activeCategory: "RECRUITING",
      searches: [engineer, recruiter],
      currentSearchId: "s_engineer"
    });
    expect(target.kind).toBe("search");
    expect(target.kind === "search" && target.search.id).toBe("s_recruiter");
  });

  it("All people with several role searches requires an explicit choice — never adds to every role (#38)", () => {
    const target = resolveAddMoreTarget({
      activeCategory: null,
      searches: [engineer, recruiter],
      currentSearchId: "s_engineer"
    });
    expect(target.kind).toBe("choose");
    expect(target.kind === "choose" && target.options.map((option) => option.id).sort()).toEqual([
      "s_engineer",
      "s_recruiter"
    ]);
  });

  it("ignores non-READY siblings and prefers the current page's search on a tie", () => {
    const draft = candidate({ id: "s_draft", status: "DRAFT", positionCategories: [] });
    const otherEngineer = candidate({ id: "s_engineer_2", createdAt: "2026-07-05T10:00:00.000Z" });
    const target = resolveAddMoreTarget({
      activeCategory: "SOFTWARE_ENGINEERING",
      searches: [engineer, otherEngineer, draft],
      currentSearchId: "s_engineer"
    });
    expect(target.kind === "search" && target.search.id).toBe("s_engineer");
  });

  it("labels chooser options by their requested roles", () => {
    expect(addMoreSearchLabel(recruiter)).toBe("Recruiter");
    expect(addMoreSearchLabel({ requestedTitles: [] })).toBe("Any role");
  });

  it("collapses re-searched duplicate role groups into a single direct target — no chooser (bug: 'Software Engineer' twice)", () => {
    // The same company+role searched twice → two READY ProspectSearch rows that
    // must present as ONE role group. With a single group there is nothing to
    // choose: the target is direct, and the newest is extended.
    const first = candidate({ id: "s_eng_1", createdAt: "2026-07-04T10:00:00.000Z" });
    const second = candidate({ id: "s_eng_2", createdAt: "2026-07-05T10:00:00.000Z" });
    const target = resolveAddMoreTarget({ activeCategory: null, searches: [first, second], currentSearchId: "" });
    expect(target.kind).toBe("search");
    expect(target.kind === "search" && target.search.id).toBe("s_eng_2");
  });

  it("dedupes across casing/whitespace variants of the same role (#8, #14)", () => {
    const canonical = candidate({ id: "s_eng_1", requestedTitles: ["Software Engineer"] });
    const variant = candidate({
      id: "s_eng_2",
      requestedTitles: ["  software   engineer "],
      createdAt: "2026-07-05T10:00:00.000Z"
    });
    const target = resolveAddMoreTarget({ activeCategory: null, searches: [canonical, variant], currentSearchId: "" });
    expect(target.kind).toBe("search");
  });

  it("shows one chooser option per distinct role group, deduping same-role siblings (#13, #14)", () => {
    // Two Software Engineer searches + one Recruiter → exactly two options.
    const engineerA = candidate({ id: "s_eng_1", createdAt: "2026-07-04T10:00:00.000Z" });
    const engineerB = candidate({ id: "s_eng_2", createdAt: "2026-07-05T10:00:00.000Z" });
    const target = resolveAddMoreTarget({
      activeCategory: null,
      searches: [engineerA, engineerB, recruiter],
      currentSearchId: ""
    });
    expect(target.kind).toBe("choose");
    const labels = target.kind === "choose" ? target.options.map((option) => addMoreSearchLabel(option)) : [];
    expect(labels).toEqual(["Software Engineer", "Recruiter"]);
    // Never two identical "Software Engineer" options.
    expect(labels.filter((label) => label === "Software Engineer")).toHaveLength(1);
  });

  it("keeps the same role in different locations as separate groups", () => {
    const nyc = candidate({ id: "s_ny", requestedLocations: ["New York"] });
    const london = candidate({
      id: "s_ldn",
      requestedLocations: ["London"],
      createdAt: "2026-07-05T10:00:00.000Z"
    });
    const target = resolveAddMoreTarget({ activeCategory: null, searches: [nyc, london], currentSearchId: "" });
    expect(target.kind).toBe("choose");
    expect(target.kind === "choose" && target.options).toHaveLength(2);
  });

  it("prefers the currently-viewed search as the collapsed group's target", () => {
    const first = candidate({ id: "s_eng_1", createdAt: "2026-07-04T10:00:00.000Z" });
    const second = candidate({ id: "s_eng_2", createdAt: "2026-07-05T10:00:00.000Z" });
    const target = resolveAddMoreTarget({
      activeCategory: null,
      searches: [first, second],
      currentSearchId: "s_eng_1"
    });
    expect(target.kind === "search" && target.search.id).toBe("s_eng_1");
  });
});

// ---------------------------------------------------------------------------
// Search History filter (client-side search over the loaded history page).
// ---------------------------------------------------------------------------

function historyGroup(overrides: Partial<DiscoverCompanyGroupNode> = {}): DiscoverCompanyGroupNode {
  return {
    id: "group-acme",
    displayName: "Acme Corp",
    requestedRoles: ["Software Engineer"],
    locations: ["United States"],
    peopleCount: 10,
    latestActivityAt: "2026-07-09T12:00:00.000Z",
    company: {
      id: "company-acme",
      name: "Acme Corp",
      officialDomain: "acme.com",
      officialWebsiteDomain: "acme.com"
    },
    searches: [
      {
        id: "search-acme",
        requestedTitles: ["Software Engineer"],
        requestedLocations: ["United States"],
        status: "READY",
        peopleCount: 10,
        createdAt: "2026-07-09T12:00:00.000Z",
        completedAt: "2026-07-09T12:05:00.000Z"
      }
    ],
    ...overrides
  };
}

describe("filterHistoryGroups", () => {
  const intuit = historyGroup({
    id: "group-intuit",
    displayName: "Intuit Inc.",
    company: { id: "company-intuit", name: "Intuit Inc.", officialDomain: "intuit.com", officialWebsiteDomain: "intuit.com" }
  });
  const walmart = historyGroup({
    id: "group-walmart",
    displayName: "Walmart",
    requestedRoles: ["Recruiter"],
    locations: ["Canada"],
    latestActivityAt: "2026-05-02T09:00:00.000Z",
    company: { id: "company-walmart", name: "Walmart", officialDomain: "walmart.com", officialWebsiteDomain: "walmart.com" },
    searches: [
      {
        id: "search-walmart",
        requestedTitles: ["Recruiter"],
        requestedLocations: ["Canada"],
        status: "SEARCHING_PEOPLE",
        peopleCount: 0,
        createdAt: "2026-05-02T09:00:00.000Z",
        completedAt: null
      }
    ]
  });
  const groups = [intuit, walmart];

  it("returns every row for an empty or whitespace-only query", () => {
    expect(filterHistoryGroups(groups, "")).toEqual(groups);
    expect(filterHistoryGroups(groups, "   ")).toEqual(groups);
  });

  it("matches the company name case-insensitively and trims whitespace", () => {
    expect(filterHistoryGroups(groups, "intuit")).toEqual([intuit]);
    expect(filterHistoryGroups(groups, "  INTUIT  ")).toEqual([intuit]);
  });

  it("matches the company domain", () => {
    expect(filterHistoryGroups(groups, "walmart.com")).toEqual([walmart]);
  });

  it("matches requested role labels", () => {
    expect(filterHistoryGroups(groups, "software engineer")).toEqual([intuit]);
    expect(filterHistoryGroups(groups, "recruiter")).toEqual([walmart]);
  });

  it("matches the location, including the Any-location fallback", () => {
    expect(filterHistoryGroups(groups, "united states")).toEqual([intuit]);
    const anywhere = historyGroup({ id: "group-anywhere", locations: [] });
    expect(filterHistoryGroups([anywhere, walmart], "any location")).toEqual([anywhere]);
  });

  it("matches the derived status label", () => {
    expect(filterHistoryGroups(groups, "ready")).toEqual([intuit]);
    expect(filterHistoryGroups(groups, "processing")).toEqual([walmart]);
  });

  it("matches the displayed updated-date text", () => {
    const dateText = formatDateTime(intuit.latestActivityAt);
    expect(filterHistoryGroups(groups, dateText)).toEqual([intuit]);
  });

  it("matches the display name for unresolved groups with no company", () => {
    const unresolved = historyGroup({ id: "group-pylon", displayName: "Pylon", company: null });
    expect(filterHistoryGroups([unresolved, walmart], "pylon")).toEqual([unresolved]);
  });

  it("returns no rows when nothing matches", () => {
    expect(filterHistoryGroups(groups, "zzz-no-such-company")).toEqual([]);
  });
});

describe("Search History searches the whole history, then paginates", () => {
  const PAGE_SIZE = 10;
  // 25 companies = 3 pages of 10. The needle sits on what would be page 3.
  const history = Array.from({ length: 25 }, (_, index) =>
    historyGroup({
      id: `group-${index}`,
      displayName: index === 22 ? "NVIDIA" : `Company ${index}`,
      company: null
    })
  );

  it("finds a company that lives past the first page while the user is on page 1", () => {
    expect(paginateHistoryGroups(history, 0, PAGE_SIZE).some((group) => group.displayName === "NVIDIA")).toBe(false);
    // Filter over the FULL dataset first, then slice the page the user is on.
    const matches = filterHistoryGroups(history, "nvidia");
    expect(matches).toHaveLength(1);
    expect(paginateHistoryGroups(matches, 0, PAGE_SIZE)).toEqual([history[22]]);
  });

  it("would miss it if the visible page were filtered instead (the bug this replaces)", () => {
    expect(filterHistoryGroups(paginateHistoryGroups(history, 0, PAGE_SIZE), "nvidia")).toEqual([]);
  });

  it("paginates the matches, not the raw history", () => {
    const matches = filterHistoryGroups(history, "company 1"); // Company 1 + 10–19
    expect(matches).toHaveLength(11);
    expect(resolvePageCount(matches.length, PAGE_SIZE)).toBe(2);
    expect(paginateHistoryGroups(matches, 0, PAGE_SIZE)).toHaveLength(10);
    expect(paginateHistoryGroups(matches, 1, PAGE_SIZE)).toHaveLength(1);
  });

  it("clearing the query restores the full paginated list", () => {
    expect(filterHistoryGroups(history, "")).toHaveLength(25);
    expect(resolvePageCount(history.length, PAGE_SIZE)).toBe(3);
    expect(paginateHistoryGroups(history, 2, PAGE_SIZE)).toHaveLength(5);
  });

  it("never strands the user past the last page of a shrunken result set", () => {
    const matches = filterHistoryGroups(history, "nvidia");
    // Was on page 3 when the query narrowed the set to a single page.
    expect(clampPageIndex(2, resolvePageCount(matches.length, PAGE_SIZE))).toBe(0);
    expect(paginateHistoryGroups(matches, 2, PAGE_SIZE)).toEqual([history[22]]);
    expect(clampPageIndex(-1, 3)).toBe(0);
    expect(clampPageIndex(1, 3)).toBe(1);
  });
});

describe("Search History filtered count labels", () => {
  it("keeps the plain count when no filter is active", () => {
    expect(formatFilteredGroupCountLabel({ filteredCount: 30, totalCount: 30, hasQuery: false })).toBe("30 companies");
    expect(formatFilteredGroupCountLabel({ filteredCount: 1, totalCount: 1, hasQuery: false })).toBe("1 company");
  });

  it('shows "X of Y companies" while filtering', () => {
    expect(formatFilteredGroupCountLabel({ filteredCount: 6, totalCount: 30, hasQuery: true })).toBe("6 of 30 companies");
    expect(formatFilteredGroupCountLabel({ filteredCount: 0, totalCount: 1, hasQuery: true })).toBe("0 of 1 company");
  });

  it("describes the pager range against the whole matched set, not the page", () => {
    expect(formatHistoryShowingLabel({ offset: 0, rowCount: 10, matchCount: 72, hasQuery: false })).toBe(
      "Showing 1–10 of 72 companies"
    );
    expect(formatHistoryShowingLabel({ offset: 10, rowCount: 10, matchCount: 72, hasQuery: false })).toBe(
      "Showing 11–20 of 72 companies"
    );
    // While searching, the total is the match count across every page.
    expect(formatHistoryShowingLabel({ offset: 0, rowCount: 10, matchCount: 23, hasQuery: true })).toBe(
      "Showing 1–10 of 23 matches"
    );
    expect(formatHistoryShowingLabel({ offset: 0, rowCount: 1, matchCount: 1, hasQuery: true })).toBe(
      "Showing 1–1 of 1 match"
    );
  });

  it("falls back to an empty-range label", () => {
    expect(formatHistoryShowingLabel({ offset: 0, rowCount: 0, matchCount: 0, hasQuery: true })).toBe(
      "No matching companies"
    );
    expect(formatHistoryShowingLabel({ offset: 0, rowCount: 0, matchCount: 0, hasQuery: false })).toBe(
      "No companies to show"
    );
  });
});

describe("Discover Search History filter UI", () => {
  const listSource = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
  const css = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");

  it("renders the search control in the card header with the scoped classes", () => {
    expect(listSource).toContain("styles.historyPanelHeader");
    expect(listSource).toContain("styles.historySearch");
    expect(listSource).toContain('role="search"');
    expect(css).toMatch(/\.historySearch\s*\{/);
    expect(css).toMatch(/\.historySearchInput\s*\{/);
    expect(css).toMatch(/\.historySearchClear\s*\{/);
  });

  it("has the required placeholder and accessible names", () => {
    expect(listSource).toContain('placeholder="Search company, role, domain, or location"');
    expect(listSource).toContain('aria-label="Search Discover history"');
    expect(listSource).toContain('aria-label="Clear Discover history search"');
  });

  it("filters client-side only — the input drives local state, never a backend call", () => {
    expect(listSource).toContain("filterHistoryGroups(searches, historyQuery)");
    expect(listSource).toContain("onQueryChange(event.target.value)");
  });

  it("searches the whole history and paginates the matches, never the visible page", () => {
    // `searches` holds every loaded group: the loader walks the connection to the end.
    expect(listSource).toContain("connection.pageInfo.hasNextPage");
    expect(listSource).toContain("after = connection.pageInfo.endCursor");
    // Filter first over everything, then slice the current page out of the matches.
    expect(listSource).toContain(
      "const matchedSearches = useMemo(() => filterHistoryGroups(searches, historyQuery), [searches, historyQuery])"
    );
    expect(listSource).toContain("paginateHistoryGroups(matchedSearches, historyPageIndexSafe, SEARCHES_PAGE_SIZE)");
    expect(listSource).toContain("resolvePageCount(matchedSearches.length, SEARCHES_PAGE_SIZE)");
    // The rendered rows are never re-filtered.
    expect(listSource).not.toContain("filterHistoryGroups(visibleSearches");
  });

  it("resets to page 1 whenever the query changes", () => {
    expect(listSource).toContain("const handleHistoryQueryChange = useCallback((value: string) => {");
    expect(listSource).toMatch(/setHistoryQuery\(value\);\s*setHistoryPageIndex\(0\);/);
  });

  it("clear button and Escape both reset the filter", () => {
    expect(listSource).toContain("const clearFilter = useCallback");
    expect(listSource).toContain('event.key === "Escape" && query');
  });

  it("shows the filtered empty state with a clear action, separate from the no-history state", () => {
    expect(listSource).toContain('title="No matching searches"');
    expect(listSource).toContain('body="Try another company, role, domain, or location."');
    expect(listSource).toContain("Clear search");
    expect(listSource).toContain('title="No prospect searches yet"');
  });

  it("shows the filtered count in the subtitle and the pager", () => {
    expect(listSource).toContain("formatFilteredGroupCountLabel");
    expect(listSource).toContain("filteredCount: matchCount");
    expect(listSource).toContain("formatHistoryShowingLabel");
  });

  it("keeps row open and delete wiring on the filtered rows", () => {
    expect(listSource).toContain("visibleSearches.map((group, index)");
    expect(listSource).toContain("resolveGroupOpenTarget(group.searches)");
    expect(listSource).toContain("onRequestDelete(group, event.currentTarget)");
  });
});

// ---------------------------------------------------------------------------
// Location filters + "Search this company" helpers (same-company search).
// ---------------------------------------------------------------------------

describe("location filter chips (buildLocationFilterOptions)", () => {
  it("builds one chip per distinct location, deduped across casing/whitespace (#22)", () => {
    const options = buildLocationFilterOptions([
      { status: "READY", requestedLocations: ["United States"] },
      { status: "READY", requestedLocations: ["united  states"] },
      { status: "READY", requestedLocations: ["Canada"] }
    ]);
    expect(options).toEqual([
      { key: "united states", label: "United States" },
      { key: "canada", label: "Canada" }
    ]);
  });

  it("adds the 'Any location' chip only when bare searches coexist with located ones", () => {
    const mixed = buildLocationFilterOptions([
      { status: "READY", requestedLocations: ["United States"] },
      { status: "READY", requestedLocations: [] }
    ]);
    expect(mixed.map((option) => option.label)).toEqual(["United States", ANY_LOCATION_LABEL]);
    expect(mixed[1].key).toBe("");
  });

  it("returns no options when nothing is filterable — the rail should not render", () => {
    expect(buildLocationFilterOptions([])).toEqual([]);
    expect(buildLocationFilterOptions([{ status: "READY", requestedLocations: [] }])).toEqual([]);
  });

  it("ignores locations from unfinished searches (they have no people yet)", () => {
    const options = buildLocationFilterOptions([
      { status: "READY", requestedLocations: ["United States"] },
      { status: "SEARCHING_PEOPLE", requestedLocations: ["Canada"] },
      { status: "FAILED", requestedLocations: ["Germany"] }
    ]);
    expect(options.map((option) => option.label)).toEqual(["United States"]);
  });
});

describe("location-aware Add 10 more (#28, #29)", () => {
  function located(overrides: Partial<AddMoreCandidateSearch> & { id: string }): AddMoreCandidateSearch {
    return {
      status: "READY",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"],
      positionCategories: ["SOFTWARE_ENGINEERING"],
      createdAt: "2026-07-04T10:00:00.000Z",
      ...overrides
    };
  }

  const us = located({ id: "s_us" });
  const canada = located({ id: "s_ca", requestedLocations: ["Canada"], createdAt: "2026-07-05T10:00:00.000Z" });

  it("an active location chip pins Add 10 more to that location's group", () => {
    const target = resolveAddMoreTarget({
      activeCategory: null,
      activeLocationKey: "canada",
      searches: [us, canada],
      currentSearchId: "s_us"
    });
    expect(target.kind).toBe("search");
    expect(target.kind === "search" && target.search.id).toBe("s_ca");
  });

  it("the 'Any location' chip (key \"\") pins the bare-location group", () => {
    const bare = located({ id: "s_bare", requestedLocations: [] });
    const target = resolveAddMoreTarget({
      activeCategory: null,
      activeLocationKey: "",
      searches: [us, bare],
      currentSearchId: ""
    });
    expect(target.kind === "search" && target.search.id).toBe("s_bare");
  });

  it("without a location filter, same role in two locations still requires a choice", () => {
    const target = resolveAddMoreTarget({
      activeCategory: null,
      activeLocationKey: null,
      searches: [us, canada],
      currentSearchId: ""
    });
    expect(target.kind).toBe("choose");
  });

  it("a stale location key falls back to the full chooser instead of mistargeting", () => {
    const target = resolveAddMoreTarget({
      activeCategory: null,
      activeLocationKey: "mars",
      searches: [us, canada],
      currentSearchId: ""
    });
    expect(target.kind).toBe("choose");
    expect(target.kind === "choose" && target.options).toHaveLength(2);
  });

  it("chooser labels carry the location so same-role groups are distinguishable (#29)", () => {
    expect(addMoreSearchLabel(us)).toBe("Software Engineer · United States");
    expect(addMoreSearchLabel(canada)).toBe("Software Engineer · Canada");
    expect(addMoreSearchLabel({ requestedTitles: ["Recruiter"], requestedLocations: [] })).toBe("Recruiter");
    expect(addMoreSearchLabel({ requestedTitles: [] })).toBe("Any role");
  });

  it("chooser options for the same role across locations never collapse or duplicate", () => {
    const target = resolveAddMoreTarget({ activeCategory: null, searches: [us, canada], currentSearchId: "" });
    const labels = target.kind === "choose" ? target.options.map((option) => addMoreSearchLabel(option)) : [];
    expect(labels).toEqual(["Software Engineer · Canada", "Software Engineer · United States"]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("Search this company helpers", () => {
  const quota: DiscoverQuota = {
    resultsPerSearch: 10,
    dailySearchLimit: 4,
    searchesUsed: 4,
    searchesRemaining: 0,
    resetAt: "2026-07-12T00:00:00.000Z",
    unlimited: false
  };

  it("locks the submit while a search is in flight and when the daily quota is spent (#10)", () => {
    expect(companySearchDisabledReason(quota, true)).toBe(COMPANY_SEARCH_LOADING_LABEL);
    expect(companySearchDisabledReason(quota, false)).toMatch(/used today's Discover searches/);
    expect(companySearchDisabledReason({ ...quota, searchesRemaining: 2 }, false)).toBeNull();
    // Owner/unlimited accounts are never quota-blocked.
    expect(companySearchDisabledReason({ ...quota, unlimited: true }, false)).toBeNull();
    expect(companySearchDisabledReason(null, false)).toBeNull();
  });

  it("describes the added group, falling back to 'Any location' for blank locations", () => {
    expect(companySearchSuccessMessage(" Recruiter ", "Canada")).toBe("New search added: Recruiter · Canada.");
    expect(companySearchSuccessMessage("Recruiter", null)).toBe(`New search added: Recruiter · ${ANY_LOCATION_LABEL}.`);
  });
});
