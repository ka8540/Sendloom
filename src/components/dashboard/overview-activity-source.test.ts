import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Source-level guarantees for the Overview Recent Activity feed that cannot be
// asserted through the pure builder (ownership scoping lives in the server
// loader; export emission lives in the GraphQL resolver). These follow the
// repo's node-only source-assertion convention.

const LOADER = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const EXPORT_RESOLVER = readFileSync("src/graphql/resolvers/prospect-export.ts", "utf8");
const EMAIL_FINDER_ROUTE = readFileSync("src/app/api/email-finder/route.ts", "utf8");

describe("overview activity loader — ownership scoping (#feed-12, #feed-13)", () => {
  it("scopes Discover searches to the authenticated user", () => {
    expect(LOADER).toMatch(/prisma\.prospectSearch\s*\n?\s*\.findMany\(\{\s*\n\s*where:\s*\{\s*userId:\s*user\.id\b/);
  });

  it("scopes Discover expansions to the authenticated user", () => {
    expect(LOADER).toMatch(/discoverSearchExpansion[\s\S]{0,80}userId:\s*user\.id\b/);
  });

  it("scopes domain searches to the authenticated user via the user-scoped service", () => {
    expect(LOADER).toContain("listHunterDomainSearchesForUser(user.id");
  });

  it("scopes the audit read to the authenticated user", () => {
    expect(LOADER).toMatch(/auditLog\s*\n?\s*\.findMany\([\s\S]{0,160}actorUserId:\s*user\.id\b/);
  });
});

describe("overview activity loader — only safe audit actions are surfaced", () => {
  it("reads exactly the individual-lookup and export actions (no other audit events)", () => {
    const match = LOADER.match(/action:\s*\{\s*in:\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const actions = (match?.[1] ?? "").match(/"[^"]+"/g) ?? [];
    expect(actions.sort()).toEqual(['"discover.results_exported"', '"hunter.email_search"']);
  });

  it("is read defensively so a missing table cannot break the Overview page", () => {
    expect(LOADER).toContain(".catch(() => [])");
  });
});

describe("overview activity loader — feed structure is preserved", () => {
  it("keeps the single 7-row slice (no extra visible rows, no new section)", () => {
    // The limit/section live in the shared builder + ActivityFeed; the loader
    // must not introduce a second feed.
    const BUILDER = readFileSync("src/components/dashboard/activity-builder.ts", "utf8");
    expect(BUILDER).toContain("const ACTIVITY_LIMIT = 7");
    expect((LOADER.match(/<ActivityFeed\b/g) ?? []).length).toBe(1);
  });
});

describe("Discover export emission (#discover-9) is privacy-safe", () => {
  it("records the export as a best-effort discover.results_exported event", () => {
    expect(EXPORT_RESOLVER).toContain("recordAuditEvent");
    expect(EXPORT_RESOLVER).toContain('action: "discover.results_exported"');
  });

  it("logs only safe counters/labels — never emails, file names, or download URLs", () => {
    const metadataLine = EXPORT_RESOLVER.match(/metadata:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(metadataLine).toContain("company");
    expect(metadataLine).toContain("selectedCount");
    expect(metadataLine).not.toMatch(/email/i);
    expect(metadataLine).not.toMatch(/fileName|downloadUrl|\.xlsx/);
  });
});

describe("Finder individual-lookup audit metadata stays email-free (#finder-2)", () => {
  it("records only domain + found, never the discovered email address", () => {
    const metadataLine = EMAIL_FINDER_ROUTE.match(/metadata:\s*\{[^}]*\}/)?.[0] ?? "";
    expect(metadataLine).toContain("domain");
    expect(metadataLine).toContain("found");
    // The discovered email/contact details must never enter audit metadata
    // (found is a boolean derived from the result count, which is fine).
    expect(metadataLine).not.toMatch(/email|address/i);
  });
});
