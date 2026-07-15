import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const HEADER = readFileSync("src/components/workspace-page-header.tsx", "utf8");
const HEADER_STYLES = readFileSync("src/components/workspace-page-header.module.css", "utf8");
const SEQUENCES = readFileSync("src/app/(app)/campaigns/page.tsx", "utf8");
const DISCOVER = readFileSync("src/components/prospects/prospects-list-view.tsx", "utf8");
const IMPORTS = readFileSync("src/app/(app)/imports/page.tsx", "utf8");
const TEMPLATES = readFileSync("src/components/templates-workspace.tsx", "utf8");
const FINDER = readFileSync("src/components/hunter-dashboard.tsx", "utf8");
const OVERVIEW = readFileSync("src/components/dashboard/overview-command-center.tsx", "utf8");
const ACCOUNT = readFileSync("src/components/account/account-dashboard.tsx", "utf8");
const GLOBAL_STYLES = readFileSync("src/app/globals.css", "utf8");
const DISCOVER_STYLES = readFileSync("src/components/prospects/prospects-dashboard.module.css", "utf8");
const FINDER_STYLES = readFileSync("src/components/hunter-dashboard.module.css", "utf8");
const ACCOUNT_STYLES = readFileSync("src/components/account/account-dashboard.module.css", "utf8");

describe("workspace page header", () => {
  it("preserves the exact Sequences header layout and typography in one component", () => {
    expect(HEADER).toContain("export function WorkspacePageHeader");
    expect(HEADER_STYLES).toMatch(/\.header\s*\{[^}]*display: flex;[^}]*align-items: flex-end;[^}]*gap: 1rem;/s);
    expect(HEADER_STYLES).toMatch(/\.heading\s*\{[^}]*display: grid;[^}]*gap: 0\.3rem;/s);
    expect(HEADER_STYLES).toMatch(/\.heading h1\s*\{[^}]*font-size: clamp\(1\.9rem, 3\.4vw, 2\.5rem\);/s);
    expect(HEADER_STYLES).toMatch(/\.heading p\s*\{[^}]*line-height: 1\.55;/s);
  });

  it("is the one header rendered by each main workspace page", () => {
    for (const source of [SEQUENCES, DISCOVER, IMPORTS, TEMPLATES, FINDER, ACCOUNT]) {
      expect(source).toContain("<WorkspacePageHeader");
    }
  });

  it("keeps Overview as its purpose-built command-center hero", () => {
    expect(OVERVIEW).not.toContain("<WorkspacePageHeader");
    expect(OVERVIEW).toContain("styles.heroEyebrow");
    expect(OVERVIEW).toContain("styles.heroTitle}>Overview</h1>");
  });

  it("removes dashboard eyebrow labels without changing create/detail flows", () => {
    expect(DISCOVER).not.toContain("PROSPECT_FINDER_TAGLINE");
    expect(IMPORTS).not.toContain("Audience library");
    expect(TEMPLATES).not.toContain("Message library");
    expect(FINDER).not.toContain("Prospecting workspace");
    expect(TEMPLATES).toContain("Template workflow");
  });

  it("keeps Email Finder controls in a left-aligned row below its shared title", () => {
    expect(FINDER).toContain("styles.headerBlock");
    expect(FINDER).toContain("styles.headerControls");
    expect(FINDER_STYLES).toMatch(/\.headerControls\s*\{[^}]*justify-content: flex-start;/s);
  });

  it("uses the Sequences 1.25rem header-to-content rhythm across workspace pages", () => {
    expect(GLOBAL_STYLES).toMatch(/\.templates-library\s*\{[^}]*gap: 1\.25rem;/s);
    expect(GLOBAL_STYLES).toMatch(/\.imports-dashboard\s*\{[^}]*gap: 1\.25rem;/s);
    expect(DISCOVER_STYLES).toMatch(/\.page\s*\{[^}]*gap: 1\.25rem;/s);
    expect(FINDER_STYLES).toMatch(/\.page\s*\{[^}]*gap: 1\.25rem;/s);
    expect(ACCOUNT_STYLES).toMatch(/\.page\s*\{[^}]*gap: 1\.25rem;/s);
  });
});
