import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync("src/components/account/account-deletion-section.tsx", "utf8");
const dashboard = readFileSync("src/components/account/account-dashboard.tsx", "utf8");
describe("Account Danger Zone", () => {
  it("has both choices, a shared second confirmation, and a pending state", () => {
    expect(dashboard).toContain("<AccountDeletionSection />");
    for (const text of ["Delete your account", "Keep using Sendloom", "Continue to deletion", "Choose what you'd like to delete", "Delete my account", "Delete my account and outreach data", "Deletion request pending"]) expect(source).toContain(text);
    expect(source).toContain("<AppConfirmDialog");
    expect(source).toContain("/api/account/deletion/cancel");
  });
});
