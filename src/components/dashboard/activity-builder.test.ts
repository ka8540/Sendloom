import { describe, expect, it } from "vitest";

import {
  buildActivityItems,
  type RecentActivityAuditInput,
  type RecentDiscoverExpansionInput,
  type RecentDomainSearchInput,
  type RecentImportInput,
  type RecentProspectSearchInput,
  type RecentRunInput,
  type RecentTemplateInput
} from "@/components/dashboard/activity-builder";

const baseSearch = (overrides: Partial<RecentProspectSearchInput> = {}): RecentProspectSearchInput => ({
  id: "search-1",
  company: "Stripe",
  status: "READY",
  peopleCount: 10,
  roleGroupCount: 2,
  titles: ["Software Engineer"],
  locations: ["United States"],
  updatedAt: new Date("2026-06-28T16:00:00.000Z"),
  ...overrides
});

const auditEvent = (overrides: Partial<RecentActivityAuditInput> = {}): RecentActivityAuditInput => ({
  id: "audit-1",
  action: "hunter.email_search",
  metadata: { domain: "reddit.com", found: true },
  createdAt: new Date("2026-06-28T16:00:00.000Z"),
  ...overrides
});

function build(overrides: {
  recentRuns?: RecentRunInput[];
  recentImports?: RecentImportInput[];
  recentTemplates?: RecentTemplateInput[];
  recentProspectSearches?: RecentProspectSearchInput[];
  recentDiscoverExpansions?: RecentDiscoverExpansionInput[];
  recentDomainSearches?: RecentDomainSearchInput[];
  recentActivityAuditEvents?: RecentActivityAuditInput[];
} = {}) {
  return buildActivityItems({
    recentRuns: [],
    recentImports: [],
    recentTemplates: [],
    ...overrides
  });
}

describe("activity builder — Discover search", () => {
  it("maps a DRAFT search to a single 'search created' event (#discover-1)", () => {
    const items = build({ recentProspectSearches: [baseSearch({ status: "DRAFT" })] });
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe("discover_search_created");
    expect(items[0].title).toBe("Stripe search created");
    expect(items[0].description).toBe("Discover search prepared for Software Engineer in United States.");
    expect(items[0].href).toBe("/prospects/search-1");
  });

  it("summarizes multiple requested roles (#discover-1)", () => {
    const items = build({
      recentProspectSearches: [
        baseSearch({ status: "DRAFT", titles: ["Software Engineer", "Data Scientist", "Recruiter"] })
      ]
    });
    expect(items[0].description).toBe("Discover search prepared for 3 requested roles in United States.");
  });

  it("maps a READY search to one 'results are ready' event with safe counts (#discover-3, #discover-5, #discover-6)", () => {
    const items = build({ recentProspectSearches: [baseSearch({ status: "READY", peopleCount: 10, roleGroupCount: 2 })] });
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe("discover_search_ready");
    expect(items[0].title).toBe("Stripe results are ready");
    expect(items[0].description).toBe("10 professionals found across 2 role groups.");
    expect(items[0].tone).toBe("success");
  });

  it("uses singular wording for one professional / one role group (#discover-5, #discover-6)", () => {
    const items = build({ recentProspectSearches: [baseSearch({ status: "READY", peopleCount: 1, roleGroupCount: 1 })] });
    expect(items[0].description).toBe("1 professional found across 1 role group.");
  });

  it("does not duplicate a READY search when read repeatedly (#discover-4)", () => {
    const search = baseSearch({ status: "READY" });
    const first = build({ recentProspectSearches: [search] });
    const second = build({ recentProspectSearches: [search] });
    // One row per search, and the id is stable across reads/polls.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe("discover-search-search-1");
  });

  it("renders a FAILED search with safe, non-technical copy and warning tone (#discover-12)", () => {
    const items = build({
      recentProspectSearches: [baseSearch({ status: "FAILED" })]
    });
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe("discover_search_failed");
    expect(items[0].title).toBe("Stripe search needs attention");
    expect(items[0].description).toBe("The Discover search could not be completed. Open it to retry.");
    expect(items[0].tone).toBe("warning");
    // No provider names, raw codes, queue/stack details.
    const text = `${items[0].title} ${items[0].description}`.toLowerCase();
    for (const leak of ["apify", "playwright", "openai", "company_unresolved", "provider", "timeout", "stack", "redis"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("skips CANCELED searches entirely", () => {
    const items = build({ recentProspectSearches: [baseSearch({ status: "CANCELED" })] });
    expect(items).toHaveLength(0);
  });

  it("produces no item when there are no searches (failed creation surfaces nothing) (#discover-2)", () => {
    const items = build({ recentProspectSearches: [] });
    expect(items).toHaveLength(0);
  });
});

describe("activity builder — Discover people added", () => {
  it("reports the number of genuinely new people (#discover-7)", () => {
    const items = build({
      recentDiscoverExpansions: [
        {
          id: "exp-1",
          company: "Stripe",
          searchId: "search-1",
          addedCount: 10,
          updatedAt: new Date("2026-06-28T16:00:00.000Z")
        }
      ]
    });
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe("discover_people_added");
    expect(items[0].title).toBe("More people added to Stripe");
    expect(items[0].description).toBe("10 new professionals were added to the Discover results.");
    expect(items[0].href).toBe("/prospects/search-1");
  });

  it("uses singular wording for a single added person", () => {
    const items = build({
      recentDiscoverExpansions: [
        { id: "exp-1", company: "Stripe", searchId: "search-1", addedCount: 1, updatedAt: new Date() }
      ]
    });
    expect(items[0].description).toBe("1 new professional was added to the Discover results.");
  });

  it("does not surface an expansion that added zero new people (#discover-8)", () => {
    const items = build({
      recentDiscoverExpansions: [
        { id: "exp-1", company: "Stripe", searchId: "search-1", addedCount: 0, updatedAt: new Date() }
      ]
    });
    expect(items).toHaveLength(0);
  });
});

describe("activity builder — Discover export (audit-backed)", () => {
  it("maps one export audit row to one export event (#discover-9)", () => {
    const items = build({
      recentActivityAuditEvents: [
        auditEvent({
          id: "audit-export-1",
          action: "discover.results_exported",
          metadata: { company: "Stripe", selectedCount: 8 }
        })
      ]
    });
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe("discover_results_exported");
    expect(items[0].title).toBe("Stripe contacts exported");
    expect(items[0].description).toBe("8 selected contacts were exported to a spreadsheet.");
    expect(items[0].href).toBe("/prospects");
  });

  it("never leaks a file name or download URL into export copy", () => {
    const items = build({
      recentActivityAuditEvents: [
        auditEvent({
          id: "audit-export-1",
          action: "discover.results_exported",
          metadata: {
            company: "Stripe",
            selectedCount: 8,
            fileName: "sendloom-stripe-2026.xlsx",
            downloadUrl: "/api/prospects/exports/secret-token"
          }
        })
      ]
    });
    const text = `${items[0].title} ${items[0].description}`;
    expect(text).not.toContain(".xlsx");
    expect(text).not.toContain("/api/");
    expect(text).not.toContain("secret-token");
  });
});

describe("activity builder — Finder", () => {
  it("maps a successful individual lookup to one Finder event (#finder-1)", () => {
    const items = build({ recentActivityAuditEvents: [auditEvent()] });
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe("finder_email_found");
    expect(items[0].title).toBe("Finder located a work email");
    expect(items[0].description).toBe("A work email result was found for reddit.com.");
    expect(items[0].href).toBe("/finder");
  });

  it("never includes the discovered email address (#finder-2)", () => {
    const items = build({
      recentActivityAuditEvents: [
        auditEvent({ metadata: { domain: "reddit.com", found: true, email: "jane.doe@reddit.com" } })
      ]
    });
    const text = `${items[0].title} ${items[0].description}`;
    expect(text).not.toContain("jane.doe@reddit.com");
    expect(text).not.toContain("@");
  });

  it("does not surface an unsuccessful / empty individual lookup (#finder-4)", () => {
    const items = build({
      recentActivityAuditEvents: [auditEvent({ metadata: { domain: "reddit.com", found: false } })]
    });
    expect(items).toHaveLength(0);
  });

  it("maps a domain search to the domain-search event type with counts (#finder-3)", () => {
    const items = build({
      recentDomainSearches: [
        { id: "dom-1", domain: "stripe.com", resultCount: 12, updatedAt: new Date("2026-06-28T16:00:00.000Z") }
      ]
    });
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe("finder_domain_search");
    expect(items[0].title).toBe("stripe.com Finder search completed");
    expect(items[0].description).toBe("12 work-email results were returned.");
    expect(items[0].href).toBe("/finder");
  });

  it("uses singular wording for a single domain-search result", () => {
    const items = build({
      recentDomainSearches: [{ id: "dom-1", domain: "stripe.com", resultCount: 1, updatedAt: new Date() }]
    });
    expect(items[0].description).toBe("1 work-email result was returned.");
  });

  it("does not surface an empty domain search (#finder-4)", () => {
    const items = build({
      recentDomainSearches: [{ id: "dom-1", domain: "stripe.com", resultCount: 0, updatedAt: new Date() }]
    });
    expect(items).toHaveLength(0);
  });

  it("uses the product name 'Finder' and never the provider name (#finder-6)", () => {
    const items = build({
      recentDomainSearches: [{ id: "dom-1", domain: "stripe.com", resultCount: 3, updatedAt: new Date() }],
      recentActivityAuditEvents: [auditEvent()]
    });
    for (const item of items) {
      const text = `${item.title} ${item.description}`.toLowerCase();
      expect(text).not.toContain("hunter");
      expect(text).not.toContain("api key");
      expect(text).not.toContain("apikey");
    }
  });
});

describe("activity builder — existing rows unchanged", () => {
  const run: RecentRunInput = {
    id: "run-1",
    status: "COMPLETED",
    sentCount: 20,
    failedCount: 0,
    suppressedCount: 0,
    invalidCount: 0,
    totalRecipients: 20,
    updatedAt: new Date("2026-06-26T11:44:00.000Z"),
    campaign: { id: "camp-1", name: "Kyndryl SDE List" }
  };
  const importRow: RecentImportInput = {
    id: "imp-1",
    fileName: "Twitch SDE",
    rowCount: 19,
    status: "PROCESSED",
    updatedAt: new Date("2026-06-28T16:10:00.000Z")
  };
  const template: RecentTemplateInput = {
    id: "tpl-1",
    name: "Kyndryl SDE Temp",
    format: "plain_text",
    updatedAt: new Date("2026-06-26T11:33:00.000Z")
  };

  it("keeps existing run activity wording (#feed-3)", () => {
    const items = build({ recentRuns: [run] });
    expect(items[0].kind).toBe("run");
    expect(items[0].title).toBe("Kyndryl SDE List updated");
    expect(items[0].description).toBe("20 sent across 20 recipients");
    expect(items[0].eventType).toBeUndefined();
  });

  it("renders invalid-address exclusions as skipped with neutral activity semantics", () => {
    const items = build({
      recentRuns: [
        {
          ...run,
          sentCount: 10,
          failedCount: 28,
          totalRecipients: 38,
          recipientJobs: [
            ...Array.from({ length: 10 }, () => ({ status: "SENT" })),
            ...Array.from({ length: 28 }, () => ({
              status: "FAILED",
              metadata: { failureCode: "HARD_BOUNCE_RECIPIENT" }
            }))
          ]
        }
      ]
    });

    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("10 sent, 28 skipped across 38 recipients");
    expect(items[0].description).not.toContain("issues");
    expect(items[0].tone).toBe("muted");
    expect(items[0].eventType).toBe("sequence_run_skipped");
  });

  it("keeps skipped and genuine action-required counts separate", () => {
    const items = build({
      recentRuns: [
        {
          ...run,
          sentCount: 10,
          failedCount: 8,
          suppressedCount: 20,
          totalRecipients: 38,
          recipientJobs: [
            ...Array.from({ length: 10 }, () => ({ status: "SENT" })),
            ...Array.from({ length: 20 }, () => ({ status: "SUPPRESSED" })),
            ...Array.from({ length: 8 }, () => ({
              status: "FAILED",
              metadata: { failureCode: "QUEUE_PROCESSING_FAILED" }
            }))
          ]
        }
      ]
    });

    expect(items[0].description).toBe("10 sent, 20 skipped, 8 need attention across 38 recipients");
    expect(items[0].tone).toBe("warning");
    expect(items[0].eventType).toBeUndefined();
  });

  it("uses singular Needs attention grammar", () => {
    const items = build({
      recentRuns: [
        {
          ...run,
          sentCount: 1,
          failedCount: 1,
          totalRecipients: 2,
          recipientJobs: [
            { status: "SENT" },
            { status: "FAILED", metadata: { failureCode: "GMAIL_PROFILE_DISCONNECTED" } }
          ]
        }
      ]
    });

    expect(items[0].description).toBe("1 sent, 1 needs attention across 2 recipients");
  });

  it("does not create a duplicate event when only display classification changes", () => {
    const skippedRun = {
      ...run,
      sentCount: 10,
      suppressedCount: 28,
      totalRecipients: 38,
      recipientJobs: Array.from({ length: 28 }, () => ({ status: "SUPPRESSED" }))
    };

    const first = build({ recentRuns: [skippedRun] });
    const second = build({ recentRuns: [skippedRun] });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).toBe(second[0].id);
  });

  it("keeps existing import activity wording (#feed-1)", () => {
    const items = build({ recentImports: [importRow] });
    expect(items[0].kind).toBe("import");
    expect(items[0].title).toBe("Twitch SDE is ready");
    expect(items[0].description).toBe("19 rows are ready for mapping and launch.");
    expect(items[0].eventType).toBeUndefined();
  });

  it("keeps existing template activity wording (#feed-2)", () => {
    const items = build({ recentTemplates: [template] });
    expect(items[0].kind).toBe("template");
    expect(items[0].title).toBe("Kyndryl SDE Temp updated");
    expect(items[0].description).toBe("PLAIN_TEXT copy refreshed and ready to reuse.");
    expect(items[0].eventType).toBeUndefined();
  });
});

describe("activity builder — ordering, limit, timestamps", () => {
  it("orders all sources by newest timestamp (#feed-11)", () => {
    const items = build({
      recentProspectSearches: [
        baseSearch({ id: "old", company: "Old Co", status: "READY", updatedAt: new Date("2026-06-20T00:00:00.000Z") }),
        baseSearch({ id: "new", company: "New Co", status: "READY", updatedAt: new Date("2026-06-28T00:00:00.000Z") })
      ],
      recentDomainSearches: [
        { id: "mid", domain: "mid.com", resultCount: 4, updatedAt: new Date("2026-06-24T00:00:00.000Z") }
      ]
    });
    expect(items.map((item) => item.title)).toEqual([
      "New Co results are ready",
      "mid.com Finder search completed",
      "Old Co results are ready"
    ]);
  });

  it("respects the existing 7-row activity limit (#feed-row-limit)", () => {
    const searches = Array.from({ length: 12 }, (_, index) =>
      baseSearch({
        id: `s-${index}`,
        company: `Co ${index}`,
        status: "READY",
        updatedAt: new Date(2026, 5, 1 + index)
      })
    );
    const items = build({ recentProspectSearches: searches });
    expect(items).toHaveLength(7);
  });

  it("emits both an ISO timeValue and a relative timeLabel (#feed-14)", () => {
    const items = build({ recentProspectSearches: [baseSearch({ status: "READY" })] });
    expect(items[0].timeValue).toBe("2026-06-28T16:00:00.000Z");
    expect(typeof items[0].timeLabel).toBe("string");
    expect(items[0].timeLabel.length).toBeGreaterThan(0);
    expect(() => new Date(items[0].timeValue).toISOString()).not.toThrow();
  });
});
