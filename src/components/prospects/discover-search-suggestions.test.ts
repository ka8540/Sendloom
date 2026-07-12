// UI wiring contracts for Discover smart search suggestions across both
// surfaces: the main "Create discovery search" modal (company / role / location)
// and the inside-company "Search this company" card (role / location only). The
// project's node-only vitest cannot mount React, so — matching the other
// prospect UI tests — the wiring is pinned with source-level assertions while
// the pure suggestion + comma-token behaviour is exercised directly.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { rankSuggestions, replaceActiveToken } from "@/services/prospects/discover-suggestions";

const SUGGESTION_INPUT = readFileSync("src/components/prospects/suggestion-input.tsx", "utf8");
const LIST_SOURCE = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
const DETAIL_SOURCE = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
const CSS = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");

describe("SuggestionInput behaviour contract", () => {
  it("debounces requests and keeps a minimum query length", () => {
    expect(SUGGESTION_INPUT).toContain("const DEBOUNCE_MS = 200");
    expect(SUGGESTION_INPUT).toContain("COMPANY: 1");
    expect(SUGGESTION_INPUT).toContain("ROLE: 2");
    expect(SUGGESTION_INPUT).toContain("LOCATION: 2");
    // A short token below the threshold never opens a dropdown.
    expect(SUGGESTION_INPUT).toContain("queryToken.length < effectiveMinChars");
  });

  it("fetches suggestions through the shared loader and aborts stale requests", () => {
    expect(SUGGESTION_INPUT).toContain("loadDiscoverSuggestions");
    expect(SUGGESTION_INPUT).toContain("new AbortController()");
    expect(SUGGESTION_INPUT).toContain("controller.abort()");
  });

  it("renders a listbox with match rows and a distinct 'Did you mean' correction row (#22)", () => {
    expect(SUGGESTION_INPUT).toContain('role="listbox"');
    expect(SUGGESTION_INPUT).toContain('role="option"');
    expect(SUGGESTION_INPUT).toContain("Did you mean");
    expect(SUGGESTION_INPUT).toContain("styles.suggestionCorrection");
  });

  it("shows a company's domain subtext but no 'Previous search' badge (#1, #2)", () => {
    expect(SUGGESTION_INPUT).toContain("styles.suggestionDetail");
    expect(SUGGESTION_INPUT).not.toContain("Previous search");
  });

  it("never renders usage counts / metadata in the dropdown (#3, #4)", () => {
    expect(SUGGESTION_INPUT).not.toContain("searches");
    expect(SUGGESTION_INPUT).not.toContain("suggestionMeta");
    expect(SUGGESTION_INPUT).not.toContain("suggestionTag");
  });

  it("only renders the dropdown when there are suggestions — never an empty box", () => {
    expect(SUGGESTION_INPUT).toContain("open && focused && suggestions.length > 0");
  });

  it("supports keyboard navigation and closes on Escape without closing the modal (#24)", () => {
    expect(SUGGESTION_INPUT).toContain('event.key === "ArrowDown"');
    expect(SUGGESTION_INPUT).toContain('event.key === "ArrowUp"');
    expect(SUGGESTION_INPUT).toContain('event.key === "Enter"');
    expect(SUGGESTION_INPUT).toContain('event.key === "Escape"');
    // Escape only collapses the dropdown; the modal/card keeps its own Escape.
    expect(SUGGESTION_INPUT).toContain("event.nativeEvent.stopImmediatePropagation()");
  });

  it("only intercepts Enter when a row is highlighted, so form submit still works (#25, #15)", () => {
    expect(SUGGESTION_INPUT).toContain("activeIndex >= 0 && activeIndex < suggestions.length");
  });

  it("closes on outside click", () => {
    expect(SUGGESTION_INPUT).toContain('addEventListener("mousedown"');
    expect(SUGGESTION_INPUT).toContain("!wrapperRef.current.contains");
  });

  it("applies a suggestion to the current comma-token only for multi-token fields (#20)", () => {
    expect(SUGGESTION_INPUT).toContain("replaceActiveToken(value, caret, suggestion.value)");
  });
});

describe("Main modal wiring (#17, #18, #19, #21, #23)", () => {
  it("renders a company SuggestionInput below the Company name field (#17)", () => {
    expect(LIST_SOURCE).toContain('<SuggestionInput\n            type="COMPANY"');
    expect(LIST_SOURCE).toContain('ariaLabel="Company name"');
  });

  it("fills the company field and preserves the picked domain for dedupe (#18)", () => {
    // Selecting a company suggestion updates the company name via onChange…
    expect(LIST_SOURCE).toContain("onChange={(value) => onChange({ ...form, companyName: value })}");
    // …and captures its resolved domain, sent only while the name still matches.
    expect(LIST_SOURCE).toContain("onSelectSuggestion={onCompanySelect}");
    // Global identity suggestions (canonicalKey, no own row id) carry the hint too.
    expect(LIST_SOURCE).toContain("suggestion.companyId || suggestion.canonicalKey");
    expect(LIST_SOURCE).toContain("companyHint.name.trim().toLowerCase() === companyName.toLowerCase()");
    expect(LIST_SOURCE).toContain("...(companyDomain ? { companyDomain } : {})");
  });

  it("renders role + location SuggestionInputs as comma-separated multi-token fields (#19, #21)", () => {
    expect(LIST_SOURCE).toContain('<SuggestionInput\n            type="ROLE"\n            multiToken');
    expect(LIST_SOURCE).toContain('<SuggestionInput\n            type="LOCATION"\n            multiToken');
  });

  it("no longer renders the old plain company/role/location inputs", () => {
    expect(LIST_SOURCE).not.toContain('onChange={(event) => onChange({ ...form, companyName: event.target.value })}');
    expect(LIST_SOURCE).not.toContain('onChange={(event) => onChange({ ...form, jobTitles: event.target.value })}');
  });
});

describe("Inside-company card wiring (#26, #27, #28, #29, #30)", () => {
  it("renders role + location SuggestionInputs inside the Search this company card (#26, #27)", () => {
    expect(DETAIL_SOURCE).toContain('<SuggestionInput\n              type="ROLE"\n              companyId={companyId}');
    expect(DETAIL_SOURCE).toContain('<SuggestionInput\n              type="LOCATION"\n              companyId={companyId}');
  });

  it("prioritizes the current company's roles/locations via companyId (#28)", () => {
    expect(DETAIL_SOURCE).toContain("companyId={company.id}");
    expect(DETAIL_SOURCE).toContain("companyId: string;");
  });

  it("has NO company input inside the company detail card (#30)", () => {
    // The only SuggestionInputs on the detail page are ROLE and LOCATION.
    expect(DETAIL_SOURCE).not.toContain('type="COMPANY"');
  });

  it("keeps the duplicate role+location pre-check + backend guard (#29)", () => {
    // Suggestions only fill the input; the same-company duplicate rules still run.
    expect(DETAIL_SOURCE).toContain("resolveCompanyRoleSearchAction");
    expect(DETAIL_SOURCE).toContain('errorCode === "DUPLICATE_ROLE_LOCATION"');
  });

  it("single-token: the same-company search does not comma-split roles/locations", () => {
    expect(DETAIL_SOURCE).not.toContain('type="ROLE"\n              companyId={companyId}\n              multiToken');
  });
});

describe("Suggestion dropdown styling is theme-aware, compact, and non-clipping (#5)", () => {
  it("uses shared theme tokens (light/dark) for the dropdown surface", () => {
    expect(CSS).toContain(".suggestionList");
    expect(CSS).toContain("background: var(--surface-strong)");
    expect(CSS).toContain(".suggestionItemActive");
  });

  it("bounds the dropdown height (~5 rows) and scrolls internally so it never covers the footer (#5)", () => {
    const list = CSS.slice(CSS.indexOf(".suggestionList"));
    expect(list).toMatch(/max-height:\s*1[0-4]rem/);
    expect(list).toContain("overflow-y: auto");
  });

  it("truncates long values so it never breaks layout (#10, #12)", () => {
    expect(CSS).toContain("text-overflow: ellipsis");
  });
});

describe("clean canonical labels on display + save (#3, #4, #15, #16, #17, #18)", () => {
  it("history role chips render title-cased, not raw stored casing (#16)", () => {
    expect(LIST_SOURCE).toContain("group.requestedRoles.map((role) => titleCaseLabel(role))");
  });

  it("the detail header + role chips display clean labels (#16)", () => {
    // groupedRoleLabels cleans casing for its chips…
    const view = readFileSync("src/components/prospects/prospect-view.ts", "utf8");
    expect(view).toContain("labels.push(titleCaseLabel(title))");
    // …and the fallback role/location labels are cleaned too.
    expect(DETAIL_SOURCE).toContain("search.requestedTitles.map((title) => titleCaseLabel(title))");
  });

  it("the inside-company card canonicalizes role + location before the duplicate pre-check (#17, #18, #19)", () => {
    expect(DETAIL_SOURCE).toContain("canonicalizeLabel(companyRoleTitle, knownRoles)");
    expect(DETAIL_SOURCE).toContain("validateCompanyRoleSearchInput({ jobTitle: canonicalRole, location: canonicalLocation })");
  });

  it("create + searchCompanyRole resolvers canonicalize the saved labels (#15)", () => {
    const resolver = readFileSync("src/graphql/resolvers/prospect-search.ts", "utf8");
    expect(resolver).toContain("canonicalizeLabels(validated.jobTitles, known.roles)");
    expect(resolver).toContain("canonicalizeLabel(args.jobTitle, known.roles)");
  });
});

describe("selecting a suggestion does not bypass duplicate validation (#29)", () => {
  it("a chosen role/location is still a plain string the pre-check normalizes", () => {
    // rankSuggestions returns the ORIGINAL known value; applying it just fills the
    // field, so the existing role-group duplicate fold sees the same text it
    // always would (no hidden identity bypass).
    const { matches } = rankSuggestions([{ value: "Software Engineer" }], "software eng");
    expect(matches[0]?.value).toBe("Software Engineer");
    const filled = replaceActiveToken("softwere eng", "softwere eng".length, "Software Engineer");
    expect(filled.value).toBe("Software Engineer");
  });
});
