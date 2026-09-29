import { describe, expect, it } from "vitest";
import { looksLikeRoleTitle } from "./role-title-evidence";

describe("looksLikeRoleTitle (parsing clues only)", () => {
  it.each(["Senior Talent Acquisition Partner", "Talent Acquisition Business Partner", "Recruitment Partner",
    "Recruiting Manager", "Technical Talent Sourcer", "Talent Sourcer", "Sourcing Coordinator", "HR", "HRBP",
    "Human Resources", "People Partner", "HR Generalist", "Specialist", "Software Engineer"])(
    "recognizes title evidence: %s", (text) => expect(looksLikeRoleTitle(text)).toBe(true)
  );
  it.each(["", "Acme", "Phoenix", "United States", "partnership", "three", "sphere", "acquisition"])(
    "does not infer role evidence from substrings or unrelated text: %s", (text) => expect(looksLikeRoleTitle(text)).toBe(false)
  );
});
