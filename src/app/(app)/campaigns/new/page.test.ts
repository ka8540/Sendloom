import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CREATE_PAGE = readFileSync("src/app/(app)/campaigns/new/page.tsx", "utf8");
const BACK_BUTTON = readFileSync("src/components/back-button.tsx", "utf8");

describe("Create Sequence back control", () => {
  it("does not render a second visible Back to sequences control", () => {
    expect(CREATE_PAGE).not.toContain("Back to sequences");
    expect(CREATE_PAGE).not.toContain("styles.backLink");
  });

  it("uses the icon-only app-shell back button for the sequences dashboard", () => {
    expect(BACK_BUTTON).toContain('pathname === "/campaigns/new"');
    expect(BACK_BUTTON).toContain('pathname === "/sequences/new"');
    expect(BACK_BUTTON).toContain('"Back to sequences"');
    expect(BACK_BUTTON).toContain('router.push("/sequences")');
    expect(BACK_BUTTON).toContain("aria-label={resolvedLabel}");
    expect(BACK_BUTTON).toContain('<ArrowLeft aria-hidden="true" />');
  });
});
