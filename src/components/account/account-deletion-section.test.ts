import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync("src/components/account/account-deletion-section.tsx", "utf8");
const dashboard = readFileSync("src/components/account/account-dashboard.tsx", "utf8");
describe("Account deletion settings", () => {
  it("has selectable choices, a shared second confirmation, and a pending state", () => {
    expect(dashboard).toContain("<AccountDeletionSection onKeepUsing=");
    for (const text of ["Before you go", "Keep using Sendloom", "Continue to deletion", "What would you like to delete?", "Delete my account", "Delete my account and outreach data", "Deletion request pending", "Deletion in progress"]) expect(source).toContain(text);
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('type="radio"');
    expect(source).toContain("disabled={!selection}");
    expect(source).toContain("onClick={onKeepUsing}");
    expect(source).toContain("<AppConfirmDialog");
    expect(source).toContain("/api/account/deletion/cancel");
  });
});
