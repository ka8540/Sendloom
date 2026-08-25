import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKSPACE = readFileSync(
  "src/app/(app)/admin/system-notices/system-notices-workspace.tsx",
  "utf8"
);
const STYLES = readFileSync(
  "src/app/(app)/admin/system-notices/system-notices.module.css",
  "utf8"
);

describe("system notice composer layout", () => {
  it("keeps delivery actions reachable in a dedicated viewport footer", () => {
    expect(WORKSPACE).toContain("styles.composerFooter");
    expect(STYLES).toMatch(
      /\.composer\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/
    );
    expect(STYLES).toMatch(/\.composerFooter\s*\{[\s\S]*?border-top:[\s\S]*?padding:/);
  });

  it("uses bounded scroll regions and exposes preview from the empty state", () => {
    expect(STYLES).toMatch(/\.composerBody\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
    expect(STYLES).toMatch(/\.formPane,[\s\S]*?\.previewPane\s*\{\s*overflow-y:\s*auto;/);
    expect(WORKSPACE).toMatch(/styles\.previewEmpty[\s\S]*?runPreview\(\)/);
  });
});
