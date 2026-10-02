import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/faq/page.tsx", "utf8");

describe("public account-deletion FAQ", () => {
  it("answers the two scopes, review, retention, return, and transactional email questions", () => {
    for (const question of [
      "Can I delete my Sendloom account?",
      "What's the difference between deleting my account and deleting my account and data?",
      "What happens to my outreach data if I only delete my account?",
      "How do I delete my outreach data?",
      "Why does full data deletion require review?",
      "What information can remain after deletion?",
      "Can I come back to Sendloom after deleting my account?",
      "Will I receive confirmation when I delete my account?"
    ]) expect(page).toContain(`question: "${question}"`);
    expect(page).toContain("private outreach records");
    expect(page).toContain("audit and security history");
    expect(page).toContain("delivery can fail without reversing deletion");
  });
});
