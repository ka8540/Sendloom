// Focused contracts for two Discover detail-page changes shipped together:
// (1) "Email confidence" is derived from the Results quality usable rate, and
// (2) the "Search this company" form is a collapsed disclosure behind a
// premium header trigger instead of an always-visible page section.
// The project's node-only vitest setup cannot mount React, so (matching
// prospect-detail-company-search.test.ts) the UI wiring is pinned with
// source-level assertions while the pure helpers are exercised directly.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMPANY_ROLE_SEARCH_MESSAGES,
  resolveCompanyRoleSearchAction,
  validateCompanyRoleSearchInput
} from "@/services/prospects/discover-company-role-search";
import {
  COMPANY_SEARCH_CLOSE_LABEL,
  COMPANY_SEARCH_TITLE,
  COMPANY_SEARCH_TOOLTIP_BODY,
  COMPANY_SEARCH_TOOLTIP_TITLE,
  COMPANY_SEARCH_TRIGGER_LABEL,
  DISCOVER_QUOTA_TOOLTIP_TITLE,
  EMAIL_CONFIDENCE_HIGH_USABLE_PERCENT,
  EMAIL_CONFIDENCE_MEDIUM_USABLE_PERCENT,
  deriveDiscoverQualitySummary,
  emailConfidenceFromUsableRate,
  formatQuotaChip
} from "@/components/prospects/prospect-view";
import type { DiscoverQuota } from "@/components/prospects/prospect-graphql";

const DETAIL_SOURCE = readFileSync("src/components/prospects/prospect-detail-view.tsx", "utf8");
const LIST_SOURCE = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
const SHARED_SOURCE = readFileSync("src/components/prospects/prospects-shared.tsx", "utf8");
const CSS = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");

const rate = (usable: number, total: number) => ({ usable, total });

describe("email confidence follows the Results quality usable rate (#1, #2)", () => {
  it("80%+ usable is High", () => {
    expect(emailConfidenceFromUsableRate(rate(80, 80))).toBe("HIGH"); // 100%
    expect(emailConfidenceFromUsableRate(rate(90, 100))).toBe("HIGH"); // 90%
    expect(emailConfidenceFromUsableRate(rate(80, 100))).toBe("HIGH"); // exactly 80%
  });

  it("50–79% usable is Medium (#3, #4)", () => {
    expect(emailConfidenceFromUsableRate(rate(79, 100))).toBe("MEDIUM"); // just under High
    expect(emailConfidenceFromUsableRate(rate(61, 80))).toBe("MEDIUM"); // 76%
    expect(emailConfidenceFromUsableRate(rate(50, 100))).toBe("MEDIUM"); // exactly 50%
  });

  it("below 50% usable is Low (#5, #6)", () => {
    expect(emailConfidenceFromUsableRate(rate(49, 100))).toBe("LOW");
    expect(emailConfidenceFromUsableRate(rate(0, 100))).toBe("LOW");
  });

  it("no counted people yields Unknown, never a misleading Low", () => {
    expect(emailConfidenceFromUsableRate(rate(0, 0))).toBe("UNAVAILABLE");
  });

  it("agrees with the rounded percent the quality headline displays", () => {
    // 398/500 = 79.6% renders as "80% usable" → the badge must say High too.
    expect(emailConfidenceFromUsableRate(rate(398, 500))).toBe("HIGH");
    // 397/500 = 79.4% renders as "79% usable" → Medium.
    expect(emailConfidenceFromUsableRate(rate(397, 500))).toBe("MEDIUM");
  });

  it("derives from the SAME per-status counts the Results quality card shows", () => {
    const summary = deriveDiscoverQualitySummary([
      { status: "INFERRED_MEDIUM", count: 61 },
      { status: "INVALID", count: 19 }
    ]);
    expect(summary.total).toBe(80);
    expect(summary.usable).toBe(61);
    expect(emailConfidenceFromUsableRate(summary)).toBe("MEDIUM"); // 76%
  });

  it("keeps the documented thresholds", () => {
    expect(EMAIL_CONFIDENCE_HIGH_USABLE_PERCENT).toBe(80);
    expect(EMAIL_CONFIDENCE_MEDIUM_USABLE_PERCENT).toBe(50);
  });

  it("the Email format panel renders the derived level; Pattern confidence is unchanged (#7)", () => {
    expect(DETAIL_SOURCE).toContain(
      "emailConfidenceFromUsableRate(deriveDiscoverQualitySummary(company.emailStatusCounts))"
    );
    expect(DETAIL_SOURCE).toContain("<ConfidenceIndicator level={emailConfidence} />");
    // Pattern confidence still shows the discovery-evidence level.
    expect(DETAIL_SOURCE).toContain("<ConfidenceIndicator level={company.patternConfidence} />");
    // The raw domain-evidence level no longer feeds the Email confidence badge.
    expect(DETAIL_SOURCE).not.toContain("<ConfidenceIndicator level={company.emailDomainConfidence} />");
  });
});

describe("Search this company disclosure (#8-#13, #16)", () => {
  it("renders the premium header trigger (#8)", () => {
    expect(DETAIL_SOURCE).toContain("companySearchTrigger");
    expect(DETAIL_SOURCE).toContain('data-discover-tour="company-search"');
    expect(COMPANY_SEARCH_TITLE).toBe("Search this company");
    // The trigger announces its disclosure state and target panel.
    expect(DETAIL_SOURCE).toContain("aria-expanded={companySearchOpen}");
    expect(DETAIL_SOURCE).toContain("aria-controls={COMPANY_SEARCH_PANEL_ID}");
    expect(DETAIL_SOURCE).toContain("id={panelId}");
  });

  it("the trigger is icon-only at rest: the label reveals on intent, the full name stays accessible", () => {
    // The reveal text is just "Search" — the button never dominates the row.
    expect(COMPANY_SEARCH_TRIGGER_LABEL).toBe("Search");
    expect(DETAIL_SOURCE).toContain(
      "<span className={styles.companySearchTriggerLabel}>{COMPANY_SEARCH_TRIGGER_LABEL}</span>"
    );
    // Screen readers always get the full name from the button itself.
    expect(DETAIL_SOURCE).toContain("aria-label={COMPANY_SEARCH_TITLE}");
    // The long title is never the visible trigger label.
    expect(DETAIL_SOURCE).not.toContain("<span>{COMPANY_SEARCH_TITLE}</span>");
    // CSS collapses the label at rest and reveals it on hover/focus/open.
    expect(CSS).toMatch(/\.companySearchTriggerLabel \{[^}]*max-width: 0/);
    expect(CSS).toMatch(
      /\.companySearchTrigger:hover \.companySearchTriggerLabel,\s*\n\s*\.companySearchTrigger:focus-visible \.companySearchTriggerLabel,\s*\n\s*\.companySearchTriggerOpen \.companySearchTriggerLabel \{/
    );
  });

  it("a decorative helper card explains the icon button on hover/focus", () => {
    expect(COMPANY_SEARCH_TOOLTIP_TITLE).toBe("Find more people");
    expect(COMPANY_SEARCH_TOOLTIP_BODY).toBe("Search this company by another role or location.");
    // Rendered next to the trigger, decorative only — never the accessible name.
    expect(DETAIL_SOURCE).toMatch(/companySearchTooltip\} aria-hidden="true"/);
    expect(DETAIL_SOURCE).toContain("{COMPANY_SEARCH_TOOLTIP_TITLE}");
    expect(DETAIL_SOURCE).toContain("{COMPANY_SEARCH_TOOLTIP_BODY}");
    // It can never intercept clicks, and keyboard focus shows it too.
    expect(CSS).toMatch(/\.companySearchTooltip \{[^}]*pointer-events: none/);
    expect(CSS).toMatch(
      /\.companySearchTriggerWrap:hover \.companySearchTooltip,\s*\n\s*\.companySearchTriggerWrap:has\(\.companySearchTrigger:focus-visible\) \.companySearchTooltip \{/
    );
    // Touch screens drop the hover card and keep the label visible instead.
    expect(CSS).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.companySearchTooltip \{\s*\n\s*display: none;/);
    expect(CSS).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.companySearchTriggerLabel \{\s*\n\s*max-width: none;/);
  });

  it("the search form is collapsed by default and never an always-visible div (#9, #16)", () => {
    expect(DETAIL_SOURCE).toMatch(/\[companySearchOpen, setCompanySearchOpen\] = useState\(false\)/);
    // Exactly ONE render site, and it is gated on the open state.
    expect(DETAIL_SOURCE.match(/<SearchCompanyCard/g)).toHaveLength(1);
    expect(DETAIL_SOURCE).toMatch(/\{company && companySearchOpen && \(\s*\n\s*<SearchCompanyCard/);
  });

  it("clicking the trigger toggles the card open (#10)", () => {
    expect(DETAIL_SOURCE).toContain("onClick={handleToggleCompanySearch}");
    expect(DETAIL_SOURCE).toContain("setCompanySearchOpen((open) => !open)");
  });

  it("the open state is a compact centered modal dialog, not a page section", () => {
    // The card sits on the page's shared modal overlay with dialog semantics
    // and a labelled title/subtitle pair.
    const card = DETAIL_SOURCE.slice(DETAIL_SOURCE.indexOf("function SearchCompanyCard"));
    expect(card).toContain("styles.modalOverlay");
    expect(card).toContain('role="dialog"');
    expect(card).toContain('aria-modal="true"');
    expect(card).toContain('aria-labelledby="discover-company-search-title"');
    expect(card).toContain('aria-describedby="discover-company-search-subtitle"');
    // Confirm-dialog-style anatomy: icon tile, head copy, footer actions.
    expect(card).toContain("companySearchIconTile");
    expect(card).toContain("companySearchHead");
    expect(card).toContain("companySearchFooterActions");
  });

  it("the footer submit drives the same form the fields live in", () => {
    const card = DETAIL_SOURCE.slice(DETAIL_SOURCE.indexOf("function SearchCompanyCard"));
    // One form id shared by the <form> and the footer submit button.
    expect(card).toContain("const formId = `${panelId}-form`");
    expect(card).toContain("id={formId}");
    expect(card).toContain("form={formId}");
    expect(card).toMatch(/type="submit"\s*\n\s*form=\{formId\}/);
  });

  it("close X, Cancel, and Escape all collapse the card; focus returns to the trigger (#11)", () => {
    expect(DETAIL_SOURCE).toContain("handleCloseCompanySearch");
    expect(DETAIL_SOURCE).toContain("companySearchTriggerRef.current?.focus()");
    // The card carries the shared circular close control with a real name.
    expect(DETAIL_SOURCE).toContain("CircularCloseButton label={COMPANY_SEARCH_CLOSE_LABEL}");
    expect(COMPANY_SEARCH_CLOSE_LABEL).toBe("Close company search");
    // A plain Cancel button shares the same close handler.
    const card = DETAIL_SOURCE.slice(DETAIL_SOURCE.indexOf("function SearchCompanyCard"));
    expect(card).toMatch(/onClick=\{onClose\} disabled=\{searching\}>\s*\n\s*Cancel/);
    // Escape collapses it too.
    expect(DETAIL_SOURCE).toContain('event.key === "Escape"');
  });

  it("the duplicate/error notice renders inside the dialog card (#10-dup)", () => {
    const card = DETAIL_SOURCE.slice(DETAIL_SOURCE.indexOf("function SearchCompanyCard"));
    expect(card).toContain("notice.message");
    expect(card).toMatch(/role=\{notice\.tone === "error" \? "alert" : "status"\}/);
  });

  it("both labelled inputs render inside the open card (#12, #13)", () => {
    expect(DETAIL_SOURCE).toContain("COMPANY_SEARCH_ROLE_LABEL");
    expect(DETAIL_SOURCE).toContain("COMPANY_SEARCH_LOCATION_LABEL");
    expect(DETAIL_SOURCE).toContain("aria-label={COMPANY_SEARCH_ROLE_LABEL}");
    expect(DETAIL_SOURCE).toContain("aria-label={COMPANY_SEARCH_LOCATION_LABEL}");
    // Opening moves focus into the first field so keyboard focus is never lost.
    expect(DETAIL_SOURCE).toContain("roleInputRef.current?.focus()");
  });

  it("a successful search and a route change both collapse the panel again", () => {
    // Three explicit collapse sites: the route-change reset, the close handler,
    // and the post-success cleanup in handleSearchCompany.
    const collapses = DETAIL_SOURCE.match(/setCompanySearchOpen\(false\)/g) ?? [];
    expect(collapses.length).toBeGreaterThanOrEqual(3);
  });
});

describe("duplicate rules for same-company searches (#14, #15)", () => {
  const existing = [
    {
      id: "search-ready",
      status: "READY",
      requestedTitles: ["Software Engineer"],
      requestedLocations: ["United States"]
    }
  ];

  it("same role + same location is blocked and points at Add 10 more (#14)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "United States",
      existingSearches: existing
    });
    expect(action.kind).toBe("duplicate");
    expect(action.kind === "duplicate" && action.message).toBe(COMPANY_ROLE_SEARCH_MESSAGES.duplicateReady);
    expect(COMPANY_ROLE_SEARCH_MESSAGES.duplicateReady).toBe(
      "This role and location already exist. Use Add 10 more to extend this group."
    );
  });

  it("normalization catches casing/whitespace twins without over-normalizing", () => {
    const sneaky = resolveCompanyRoleSearchAction({
      jobTitle: "  software   ENGINEER ",
      location: " UNITED  states ",
      existingSearches: existing
    });
    expect(sneaky.kind).toBe("duplicate");
  });

  it("same role + different location is allowed (#15)", () => {
    const action = resolveCompanyRoleSearchAction({
      jobTitle: "Software Engineer",
      location: "Canada",
      existingSearches: existing
    });
    expect(action.kind).toBe("create");
  });

  it("different role (same or different location) is allowed", () => {
    expect(
      resolveCompanyRoleSearchAction({
        jobTitle: "Recruiter",
        location: "United States",
        existingSearches: existing
      }).kind
    ).toBe("create");
    expect(
      resolveCompanyRoleSearchAction({
        jobTitle: "Recruiter",
        location: "Canada",
        existingSearches: existing
      }).kind
    ).toBe("create");
  });

  it("validation trims input and blanks become the any-location group", () => {
    const validated = validateCompanyRoleSearchInput({ jobTitle: "  Recruiter  ", location: "   " });
    expect(validated).toEqual({ ok: true, jobTitle: "Recruiter", location: null });
    expect(validateCompanyRoleSearchInput({ jobTitle: "   " }).ok).toBe(false);
  });
});

describe("compact header quota chip", () => {
  const quotaOf = (searchesRemaining: number, dailySearchLimit = 4, unlimited = false): DiscoverQuota => ({
    resultsPerSearch: 10,
    dailySearchLimit,
    searchesUsed: dailySearchLimit - searchesRemaining,
    searchesRemaining,
    resetAt: "2026-07-13T00:00:00.000Z",
    unlimited
  });

  it("formats the compact value from the live quota", () => {
    expect(formatQuotaChip(quotaOf(2))?.value).toBe("2/4");
    expect(formatQuotaChip(quotaOf(4))?.value).toBe("4/4");
    expect(formatQuotaChip(quotaOf(0))?.value).toBe("0/4");
    // A transient negative can never render "-1/4".
    expect(formatQuotaChip(quotaOf(-1))?.value).toBe("0/4");
    expect(formatQuotaChip(quotaOf(0, 4, true))?.value).toBe("Unlimited");
    expect(formatQuotaChip(null)).toBeNull();
  });

  it("carries the full meaning in the accessible label and helper copy", () => {
    const limited = formatQuotaChip(quotaOf(2))!;
    expect(limited.ariaLabel).toBe("2 of 4 Discover searches remaining today");
    expect(limited.tooltip).toBe("2 of 4 searches remaining today.");
    const unlimited = formatQuotaChip(quotaOf(0, 4, true))!;
    expect(unlimited.ariaLabel).toBe("Unlimited Discover access");
    expect(unlimited.tooltip).toBe("Unlimited Discover access.");
    expect(DISCOVER_QUOTA_TOOLTIP_TITLE).toBe("Discover searches");
  });

  it("the detail header renders the chip; the dialog footer keeps the full sentence", () => {
    expect(DETAIL_SOURCE).toContain("<QuotaStatChip quota={quota} />");
    // Exactly one QuotaIndicator remains in the detail view — the dialog footer.
    expect(DETAIL_SOURCE.match(/<QuotaIndicator quota=\{quota\} \/>/g)).toHaveLength(1);
  });

  it("the chip is focusable, labelled, and keeps the detail-tour anchors", () => {
    expect(SHARED_SOURCE).toContain("export function QuotaStatChip");
    expect(SHARED_SOURCE).toContain("tabIndex={0}");
    expect(SHARED_SOURCE).toContain("aria-label={view.ariaLabel}");
    // The detail tour still finds and reads the quota element.
    const chip = SHARED_SOURCE.slice(SHARED_SOURCE.indexOf("export function QuotaStatChip"));
    expect(chip).toContain('data-discover-tour="quota"');
    expect(chip).toContain("data-discover-quota=");
    // The helper card is decorative only.
    expect(chip).toMatch(/quotaChipTooltip\}`\} aria-hidden="true"/);
  });

  it("the Discover list header uses the same chip; Refresh/New search stay wired", () => {
    // The long sentence indicator is fully replaced on the list page.
    expect(LIST_SOURCE).toContain("<QuotaStatChip quota={quota} />");
    expect(LIST_SOURCE).not.toContain("QuotaIndicator");
    // The existing actions are untouched.
    expect(LIST_SOURCE).toContain('data-discover-tour="refresh"');
    expect(LIST_SOURCE).toContain("onClick={refreshAll}");
    expect(LIST_SOURCE).toContain('data-discover-tour="new-search"');
    expect(LIST_SOURCE).toContain("setShowNewSearch(true)");
  });

  it("a wrapped header action row stays right-aligned (expanded sidebar / tablet)", () => {
    expect(CSS).toMatch(/\.headerActions \{[^}]*margin-left: auto/);
    expect(CSS).toMatch(/\.headerActions \{[^}]*justify-content: flex-end/);
  });

  it("the chip is a small stat pill with room before the Search trigger", () => {
    // 34px pill, tabular digits, quiet muted text.
    expect(CSS).toMatch(/\.quotaChip \{[^}]*height: 2\.125rem/);
    expect(CSS).toMatch(/\.quotaChip \{[^}]*font-variant-numeric: tabular-nums/);
    // ~20px total to the Search trigger: 12px row gap + 8px chip margin.
    expect(CSS).toMatch(/\.quotaChipWrap \{[^}]*margin-right: 0\.5rem/);
    // Its helper card opens from the left edge and shows on hover/keyboard focus.
    expect(CSS).toMatch(/\.quotaChipTooltip \{\s*\n\s*left: 0;\s*\n\s*right: auto;/);
    expect(CSS).toMatch(
      /\.quotaChipWrap:hover \.companySearchTooltip,\s*\n\s*\.quotaChipWrap:has\(\.quotaChip:focus-visible\) \.companySearchTooltip \{/
    );
  });
});

describe("People filters stay independent of the disclosure (#17, #18)", () => {
  it("role/location filter selects still render (#17)", () => {
    expect(DETAIL_SOURCE).toContain('data-discover-tour="role-filters"');
    expect(DETAIL_SOURCE).toContain('data-discover-tour="location-filters"');
    expect(DETAIL_SOURCE).toContain('aria-label="Filter by role"');
    expect(DETAIL_SOURCE).toContain('aria-label="Filter by location"');
  });

  it("the open/close path is pure client state — no backend call added (#18)", () => {
    const start = DETAIL_SOURCE.indexOf("const handleToggleCompanySearch");
    const end = DETAIL_SOURCE.indexOf("// \"Search this company\": run the SAME company again");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const disclosureHandlers = DETAIL_SOURCE.slice(start, end);
    expect(disclosureHandlers).not.toContain("prospectGraphql");
    expect(disclosureHandlers).not.toContain("fetch(");
  });
});

describe("premium styling contract", () => {
  it("the trigger is a gradient-ring pill with hover/focus treatment", () => {
    expect(CSS).toContain(".companySearchTrigger {");
    expect(CSS).toMatch(/\.companySearchTrigger \{[^}]*border-radius: 999px/);
    expect(CSS).toContain(".companySearchTrigger:focus-visible");
    expect(CSS).toContain(".companySearchTriggerIcon");
  });

  it("the trigger stays a compact 44px icon action, never a hero CTA", () => {
    // 44px round-pill at rest, ~14.4px reveal text, plain ~18px icon —
    // no filled icon chip.
    expect(CSS).toMatch(/\.companySearchTrigger \{[^}]*height: 2\.75rem/);
    expect(CSS).toMatch(/\.companySearchTrigger \{[^}]*min-width: 2\.75rem/);
    expect(CSS).toMatch(/\.companySearchTrigger \{[^}]*font-size: 0\.9rem/);
    expect(CSS).toMatch(/\.companySearchTriggerIcon \{\s*\n\s*width: 1\.15rem/);
    expect(CSS).not.toMatch(/\.companySearchTriggerIcon \{[^}]*background/);
    // No full-row takeover on phones — it wraps like any other header action.
    expect(CSS).not.toMatch(/\.companySearchTrigger \{\s*\n\s*flex: 1 1 100%;/);
  });

  it("the dialog card is compact — never full content width on desktop", () => {
    // ~608px card in the 560–720px band, big radius, confirm-dialog surface.
    expect(CSS).toMatch(/\.companySearchCard \{[^}]*max-width: 38rem/);
    expect(CSS).toMatch(/\.companySearchCard \{[^}]*border-radius: 26px/);
    expect(CSS).toMatch(/\.companySearchCard \{[^}]*radial-gradient/);
  });

  it("the reveal card animates in and honors reduced motion", () => {
    expect(CSS).toContain("@keyframes companySearchReveal");
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.companySearchCard \{\s*\n\s*animation: none;/);
  });

  it("the dialog footer stacks to full-width tap targets on phones", () => {
    expect(CSS).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?\.companySearchFooter \{\s*\n\s*flex-direction: column;/);
    expect(CSS).toMatch(/\.companySearchFooterActions \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: 1fr;/);
  });
});
