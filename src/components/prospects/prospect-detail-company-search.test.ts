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

describe("Location filters on the People section (#21-#27)", () => {
  it("renders a location rail alongside the existing role rail — never replacing it (#31)", () => {
    expect(DETAIL_SOURCE).toContain('data-discover-tour="role-filters"');
    expect(DETAIL_SOURCE).toContain('data-discover-tour="location-filters"');
    expect(DETAIL_SOURCE).toContain("ALL_LOCATIONS_LABEL");
    expect(ALL_LOCATIONS_LABEL).toBe("All locations");
    expect(ANY_LOCATION_LABEL).toBe("Any location");
  });

  it("passes BOTH the active role and active location to every people load (#25)", () => {
    expect(DETAIL_SOURCE).toContain("handleSelectLocation");
    // Selecting a role keeps the location and vice versa.
    expect(DETAIL_SOURCE).toMatch(/category,\s*location: activeLocation/);
    expect(DETAIL_SOURCE).toMatch(/category: activeCategory,\s*location,/);
    expect(PEOPLE_QUERY).toContain("$location: String");
    expect(PEOPLE_QUERY).toContain("location: $location");
  });

  it("shows the filtered empty state with a Clear filters action — never a blank table (#26, #27)", () => {
    expect(DETAIL_SOURCE).toContain("handleClearFilters");
    expect(DETAIL_SOURCE).toContain("FILTERED_PEOPLE_EMPTY_TITLE");
    expect(DETAIL_SOURCE).toContain("CLEAR_FILTERS_LABEL");
    expect(FILTERED_PEOPLE_EMPTY_TITLE).toBe("No people match these filters.");
    expect(CLEAR_FILTERS_LABEL).toBe("Clear filters");
  });

  it("long chip labels truncate instead of stretching the rail (#12-edge)", () => {
    expect(DETAIL_SOURCE).toContain("chipLabelTruncate");
    expect(CSS).toContain("text-overflow: ellipsis");
  });

  it("Add 10 more targets the active role/location group (#28)", () => {
    expect(DETAIL_SOURCE).toMatch(/activeLocationKey: activeLocation/);
  });

  it("bulk select-all stays role-scoped only — hidden while a location chip is active", () => {
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

  it("keeps the role chips driven by server-side position groups", () => {
    expect(DETAIL_SOURCE).toContain("visibleCategories.map((position)");
    expect(DETAIL_SOURCE).toContain("handleSelectCategory(position.category)");
  });
});
