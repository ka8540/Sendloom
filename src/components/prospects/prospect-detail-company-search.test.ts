// Source-level assertions for the same-company "Search this company" section
// and the role/location People filters on the Discover detail page. The
// project's node-only vitest setup cannot mount React, so (matching
// prospect-detail-redesign.test.ts) these tests pin the wiring that the pure
// helpers cannot see: which components render, which mutation/query the page
// calls, and which safety gates the JSX keeps.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMPANY_ROLE_SEARCH_MESSAGES
} from "@/services/prospects/discover-company-role-search";
import {
  ALL_LOCATIONS_LABEL,
  ALL_ROLES_LABEL,
  ANY_LOCATION_LABEL,
  CLEAR_FILTERS_LABEL,
  COMPANY_SEARCH_BUTTON_LABEL,
  COMPANY_SEARCH_HELPER,
  COMPANY_SEARCH_LOCATION_PLACEHOLDER,
  COMPANY_SEARCH_ROLE_PLACEHOLDER,
  COMPANY_SEARCH_SUBTITLE,
  COMPANY_SEARCH_TITLE,
  FILTERED_PEOPLE_EMPTY_TITLE
} from "@/components/prospects/prospect-view";
import { PEOPLE_QUERY, SEARCH_COMPANY_ROLE_MUTATION } from "@/components/prospects/prospect-graphql";

const DETAIL_SOURCE = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
const CSS = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");
const SCHEMA = readFileSync("src/graphql/schema.ts", "utf8");

describe("Search this company section (detail page) (#16-#18)", () => {
  it("renders the compact same-company search card with both fields and the submit", () => {
    expect(DETAIL_SOURCE).toContain('data-discover-tour="company-search"');
    expect(DETAIL_SOURCE).toContain("SearchCompanyCard");
    expect(DETAIL_SOURCE).toContain("COMPANY_SEARCH_ROLE_PLACEHOLDER");
    expect(DETAIL_SOURCE).toContain("COMPANY_SEARCH_LOCATION_PLACEHOLDER");
    expect(DETAIL_SOURCE).toContain("COMPANY_SEARCH_BUTTON_LABEL");
    expect(DETAIL_SOURCE).toContain("COMPANY_SEARCH_HELPER");
  });

  it("keeps the product copy compact, premium, and free of internals", () => {
    expect(COMPANY_SEARCH_TITLE).toBe("Search this company");
    expect(COMPANY_SEARCH_SUBTITLE).toBe("Add another role or location without leaving this company.");
    expect(COMPANY_SEARCH_ROLE_PLACEHOLDER).toBe("Software Engineer");
    expect(COMPANY_SEARCH_LOCATION_PLACEHOLDER).toBe("United States");
    expect(COMPANY_SEARCH_BUTTON_LABEL).toBe("Search this company");
    expect(COMPANY_SEARCH_HELPER).toMatch(/Add 10 more/);
  });

  it("submits through the dedicated mutation with an idempotency key (#20)", () => {
    expect(DETAIL_SOURCE).toContain("SEARCH_COMPANY_ROLE_MUTATION");
    expect(SEARCH_COMPANY_ROLE_MUTATION).toContain("searchCompanyRole(");
    expect(SEARCH_COMPANY_ROLE_MUTATION).toContain("$idempotencyKey");
    expect(DETAIL_SOURCE).toMatch(/handleSearchCompany/);
  });

  it("pre-checks duplicates client-side with the SAME shared resolver the server uses (#19)", () => {
    expect(DETAIL_SOURCE).toContain("resolveCompanyRoleSearchAction");
    expect(DETAIL_SOURCE).toContain("validateCompanyRoleSearchInput");
    // The duplicate answer explicitly directs the user to Add 10 more.
    expect(COMPANY_ROLE_SEARCH_MESSAGES.duplicateReady).toBe(
      "This role and location already exist. Use Add 10 more to extend this group."
    );
    expect(COMPANY_ROLE_SEARCH_MESSAGES.duplicateRunning).toMatch(/already running/);
  });

  it("treats a server DUPLICATE_ROLE_LOCATION answer as guidance, not an error banner", () => {
    expect(DETAIL_SOURCE).toContain('result.errorCode === "DUPLICATE_ROLE_LOCATION" ? "info" : "error"');
  });

  it("the schema exposes the mutation and rejects nothing silently (safe 409-style code)", () => {
    expect(SCHEMA).toContain("searchCompanyRole(companyId: ID!, jobTitle: String!, location: String");
    expect(SCHEMA).toContain("DUPLICATE_ROLE_LOCATION");
  });

  it("stacks the form fields on mobile (#30)", () => {
    expect(CSS).toContain(".companySearchForm");
    // The narrow-viewport override collapses the 3-column form to one column.
    expect(CSS).toMatch(/@media \(max-width: 640px\) \{[^}]*\n\s*\.companySearchForm \{\s*\n\s*grid-template-columns: 1fr;/);
  });
});

describe("Scalable People filter controls (#21-#27)", () => {
  it("renders compact role + location dropdowns under the same tour targets (#31)", () => {
    // Both filter dimensions survive as accessible <select> controls, and the
    // tour anchors that pointed at the old chip rails still resolve.
    expect(DETAIL_SOURCE).toContain('data-discover-tour="role-filters"');
    expect(DETAIL_SOURCE).toContain('data-discover-tour="location-filters"');
    expect(DETAIL_SOURCE).toContain('aria-label="Filter by role"');
    expect(DETAIL_SOURCE).toContain('aria-label="Filter by location"');
    expect(DETAIL_SOURCE).toContain("ALL_LOCATIONS_LABEL");
    expect(DETAIL_SOURCE).toContain("ALL_ROLES_LABEL");
    expect(ALL_LOCATIONS_LABEL).toBe("All locations");
    expect(ALL_ROLES_LABEL).toBe("All roles");
    expect(ANY_LOCATION_LABEL).toBe("Any location");
  });

  it("replaces the chip wall so many roles/locations never clutter the page (#11)", () => {
    // The old pill rails are gone entirely — no per-role/per-location chip is
    // rendered, so 8 roles × 10 locations can no longer stretch the section.
    expect(DETAIL_SOURCE).not.toContain("categoryChip");
    expect(DETAIL_SOURCE).not.toContain("categoryRail");
    expect(DETAIL_SOURCE).not.toContain("chipLabelTruncate");
    expect(CSS).not.toContain(".categoryChip");
    expect(CSS).not.toContain(".categoryRail");
    // The scalable control bar is what renders instead.
    expect(DETAIL_SOURCE).toContain("peopleFilterBar");
    expect(CSS).toContain(".peopleFilterBar");
  });

  it("keeps the bar quiet — inline pill labels, no shouty FILTERS heading or icon", () => {
    // Each control carries its own muted label INSIDE the pill; there is no
    // standalone toolbar heading, filter icon, or floating field label.
    expect(DETAIL_SOURCE).toContain("peopleFilterPrefix");
    expect(DETAIL_SOURCE).toContain("peopleFilterControl");
    expect(DETAIL_SOURCE).not.toContain("SlidersHorizontal");
    expect(DETAIL_SOURCE).not.toContain("peopleFilterHeading");
    expect(CSS).not.toContain(".peopleFilterHeading");
    expect(CSS).not.toContain(".peopleFilterFieldLabel");
    // Compact control metrics: 42px pills, 14px value text.
    expect(CSS).toMatch(/\.peopleFilterControl \{[^}]*height: 2\.625rem/);
    expect(CSS).toMatch(/\.peopleFilterSelect \{[^}]*font-size: 0\.88rem/);
  });

  it("builds the role dropdown from server-side groups, labels only — no counts (#2, #3)", () => {
    // "All roles" plus one option per position group. Counts were removed from
    // the option labels on request; the pill shows just the role name.
    expect(DETAIL_SOURCE).toMatch(/<option value=\{ALL_ROLES_VALUE\}>\{ALL_ROLES_LABEL\}<\/option>/);
    expect(DETAIL_SOURCE).toContain("visibleCategories.map((position)");
    expect(DETAIL_SOURCE).not.toContain("· {company.peopleCount}");
    expect(DETAIL_SOURCE).not.toContain("· {position.peopleCount}");
  });

  it("builds the location dropdown from already-loaded options (#4, #5, #14)", () => {
    // All locations + one option per deduped requested location, sourced from
    // the frontend helper (no extra fetch just to list locations).
    expect(DETAIL_SOURCE).toContain("buildLocationFilterOptions(companySearches)");
    expect(DETAIL_SOURCE).toContain("locationOptions.map((option)");
    expect(DETAIL_SOURCE).toMatch(/<option value=\{ALL_LOCATIONS_VALUE\}>\{ALL_LOCATIONS_LABEL\}<\/option>/);
  });

  it("keeps role and location filtering on the existing combined load path (#6, #7, #8)", () => {
    // Changing either dropdown routes through the same handlers that carry BOTH
    // dimensions into every people load — combined filtering is unchanged.
    expect(DETAIL_SOURCE).toContain("handleSelectCategory");
    expect(DETAIL_SOURCE).toContain("handleSelectLocation");
    expect(DETAIL_SOURCE).toMatch(/category,\s*location: activeLocation/);
    expect(DETAIL_SOURCE).toMatch(/category: activeCategory,\s*location,/);
    expect(PEOPLE_QUERY).toContain("$location: String");
    expect(PEOPLE_QUERY).toContain("location: $location");
  });

  it("shows Clear filters only when a filter is active and resets both (#9)", () => {
    expect(DETAIL_SOURCE).toMatch(/\{filtersActive && \(/);
    expect(DETAIL_SOURCE).toContain("handleClearFilters");
    expect(DETAIL_SOURCE).toContain("aria-label={CLEAR_FILTERS_LABEL}");
    expect(DETAIL_SOURCE).toContain("CLEAR_FILTERS_LABEL");
    expect(CLEAR_FILTERS_LABEL).toBe("Clear filters");
  });

  it("shows the filtered empty state — never a blank table (#26, #27)", () => {
    expect(DETAIL_SOURCE).toContain("FILTERED_PEOPLE_EMPTY_TITLE");
    expect(FILTERED_PEOPLE_EMPTY_TITLE).toBe("No people match these filters.");
  });

  it("long role/location labels truncate inside the control (#1, #2, #3-edge)", () => {
    // The select clips overflow with an ellipsis instead of widening the bar,
    // and drops its max-width on mobile so it fills the row cleanly.
    expect(DETAIL_SOURCE).toContain("peopleFilterSelect");
    expect(CSS).toContain("text-overflow: ellipsis");
    expect(CSS).toMatch(/@media \(max-width: 640px\)[\s\S]*\.peopleFilterSelect \{\s*\n\s*max-width: none;/);
  });

  it("Add 10 more targets the active role/location group (#28)", () => {
    expect(DETAIL_SOURCE).toMatch(/activeLocationKey: activeLocation/);
  });

  it("bulk select-all stays role-scoped only — hidden while a location filter is active", () => {
    expect(DETAIL_SOURCE).toMatch(/activeLocation === null &&\s*\n\s*peopleTotal > selectedPageIds.length/);
  });
});

describe("Detail page regressions (#31-#35)", () => {
  it("keeps the existing sections untouched around the new card", () => {
    // Quality summary, email format, add-more, and delete all still render.
    expect(DETAIL_SOURCE).toContain('data-discover-tour="quality-summary"');
    expect(DETAIL_SOURCE).toContain('data-discover-tour="company-details"');
    expect(DETAIL_SOURCE).toContain('data-discover-tour="add-more-people"');
    expect(DETAIL_SOURCE).toContain('data-discover-tour="delete-search"');
    expect(DETAIL_SOURCE).toContain("EmailFormatPanel");
    expect(DETAIL_SOURCE).toContain("AddMorePeopleDialog");
  });

  it("keeps the role dropdown driven by server-side position groups", () => {
    expect(DETAIL_SOURCE).toContain("visibleCategories.map((position)");
    // The role <select> still hands the chosen group's category to the same
    // handler (via its onChange) that drove the old chips.
    expect(DETAIL_SOURCE).toContain("handleSelectCategory");
    expect(DETAIL_SOURCE).toContain("as PositionCategory");
  });

  it("keeps Add 10 more and the per-page table search intact (#12, #13)", () => {
    expect(DETAIL_SOURCE).toContain("ADD_MORE_PEOPLE_LABEL");
    expect(DETAIL_SOURCE).toContain('data-discover-tour="add-more-people"');
    expect(DETAIL_SOURCE).toContain("Filter this page by name, title, or email");
    expect(DETAIL_SOURCE).toContain("setPeopleFilter");
  });
});
