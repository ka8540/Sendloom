import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync("src/components/account/account-deletion-section.tsx", "utf8");
const dashboard = readFileSync("src/components/account/account-dashboard.tsx", "utf8");
describe("Account deletion settings", () => {
  it("has selectable choices, a shared second confirmation, and a pending state", () => {
    expect(dashboard).toContain("<AccountDeletionSection />");
    for (const text of ["Before you go", "Keep using Sendloom", "Delete account", "What would you like to delete?", "Delete my account", "Delete my account and outreach data", "Deletion request pending", "Deletion in progress"]) expect(source).toContain(text);
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('type="radio"');
    expect(source).toContain("disabled={!selection}");
    expect(source).toContain("className={styles.cancelTooltip}");
    expect(source).toContain("onClick={closeChoices}>Cancel");
    expect(source).not.toContain("Continue to deletion");
    expect(source).toContain('href="/privacy"');
    expect(source).toContain('href="/terms"');
    expect(source).toContain("We'll try to send a farewell email");
    expect(source).toContain("<AppConfirmDialog");
    expect(source).toContain("/api/account/deletion/cancel");
  });
});
