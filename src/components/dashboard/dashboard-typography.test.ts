import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const GLOBALS = readFileSync("src/app/globals.css", "utf8");

const PAGE_TITLE_SOURCES = [
  ["Overview", "src/components/dashboard/overview-command-center.tsx"],
  ["Finder", "src/components/hunter-dashboard.tsx"],
  ["Discover", "src/components/prospects/prospects-list-view.tsx"],
  ["Imports", "src/app/(app)/imports/page.tsx"],
  ["Templates", "src/components/templates-workspace.tsx"],
  ["Create Sequence", "src/app/(app)/campaigns/page.tsx"],
  ["Account", "src/components/account/account-dashboard.tsx"]
] as const;

describe("shared dashboard page typography", () => {
  it.each(PAGE_TITLE_SOURCES)("%s uses the shared page-title class", (_page, file) => {
    const source = readFileSync(file, "utf8");

    expect(source).toMatch(/<h1\s+className="dashboard-page-title"/);
  });

  it("defines the full title contract from shared role-specific tokens", () => {
    const titleRule = GLOBALS.match(/\.dashboard-page-title\s*\{(?<rule>[^}]*)\}/)?.groups?.rule;

    expect(titleRule).toBeDefined();
    expect(titleRule).toContain("font-size: var(--dashboard-page-title-size)");
    expect(titleRule).toContain("line-height: var(--dashboard-page-title-line-height)");
    expect(titleRule).toContain("font-weight: var(--dashboard-page-title-weight)");
    expect(titleRule).toContain("letter-spacing: var(--dashboard-page-title-letter-spacing)");
  });

  it("keeps contextual card and hero rules from overriding page titles", () => {
    expect(GLOBALS).toContain(".hero h1:not(.dashboard-page-title)");
    expect(GLOBALS).toContain(".card h1:not(.dashboard-page-title)");
    expect(GLOBALS).not.toMatch(/\.card h1,\s*\n\.card h2/);
  });
});
