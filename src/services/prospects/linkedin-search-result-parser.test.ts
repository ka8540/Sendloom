import { describe, expect, it } from "vitest";
import { parseLinkedInSearchResult, positionEvidenceDetails, snippetPositionEvidence } from "./linkedin-search-result-parser";
import type { BrightOrganicResult } from "./brightdata-google-search-provider";

describe("LinkedIn position evidence", () => {
  const options = { expectedCompanyName: "Guidewire Software" };
  it("preserves Guidewire Software as the company beside a talent acquisition title", () => {
    expect(positionEvidenceDetails("Guidewire Software - Senior Talent Acquisition Partner", options))
      .toMatchObject({ company: "Guidewire Software", title: "Senior Talent Acquisition Partner" });
  });

  it.each([
    ["Senior Talent Acquisition Partner", "Senior Talent Acquisition Partner · Guidewire Software · United States"],
    ["Guidewire Software", "Guidewire Software · Senior Talent Acquisition Partner · United States"]
  ])("extracts the real title from Guidewire snippet segments: %s", (headline, snippet) => {
    const result: BrightOrganicResult = {
      title: `Jane Doe - ${headline}`,
      url: "https://www.linkedin.com/in/test-guidewire",
      rawUrl: "https://www.linkedin.com/in/test-guidewire",
      displayedUrl: null,
      snippet,
      evidence: []
    };
    expect(parseLinkedInSearchResult(result, options)).toMatchObject({
      currentCompanyName: "Guidewire Software",
      currentTitle: "Senior Talent Acquisition Partner"
    });
  });

  it.each([" - ", " | ", " · ", ", ", " : ", " – ", " — "])("uses the target company in either order with separator %s", (separator) => {
    for (const title of ["Senior Talent Acquisition Partner", "Technical Recruiter", "Recruiting Manager", "Senior Software Engineer", "Unrecognized Profession"]) {
      for (const text of [`Guidewire Software${separator}${title}`, `${title}${separator}Guidewire Software`]) {
        expect(positionEvidenceDetails(text, options)).toMatchObject({ title, company: "Guidewire Software" });
      }
    }
  });

  it.each([
    "Guidewire Software (Talent Acquisition Partner)",
    "Talent Acquisition Partner (Guidewire Software)"
  ])("orients parentheses using company identity: %s", (text) => {
    expect(positionEvidenceDetails(text, options)).toMatchObject({
      company: "Guidewire Software", title: "Talent Acquisition Partner", connector: "PARENTHESES"
    });
  });

  it.each([
    ["Recruiting Manager at Guidewire Software", "Recruiting Manager", "AT"],
    ["Talent Acquisition Partner @ Guidewire Software", "Talent Acquisition Partner", "AT_SIGN"],
    ["Software Engineer at Guidewire Software", "Software Engineer", "AT"],
    ["Guidewire Software at Another Company", "Guidewire Software", "AT"],
    ["Guidewire Software @ Another Company", "Guidewire Software", "AT_SIGN"]
  ])("preserves explicit connector orientation: %s", (text, title, connector) => {
    expect(positionEvidenceDetails(text, options)).toMatchObject({ title, connector,
      company: text.includes("Another Company") ? "Another Company" : "Guidewire Software" });
  });

  it.each(["Guidewire Software", "Software AG", "People.ai", "Productboard", "DataRobot", "Salesforce"])(
    "keeps a role-looking company name out of the title: %s", (company) => {
      for (const text of [`${company} · Senior Talent Acquisition Partner`, `Senior Software Engineer - ${company}`]) {
        expect(positionEvidenceDetails(text, { expectedCompanyName: company })).toMatchObject({ company,
          title: text.startsWith(company) ? "Senior Talent Acquisition Partner" : "Senior Software Engineer" });
      }
    }
  );

  it.each([
    ["Guidewire", "Guidewire Software"],
    ["Guidewire Software", "Guidewire"],
    ["London Stock Exchange", "London Stock Exchange Group"],
    ["London Stock Exchange Group", "London Stock Exchange"]
  ])("reuses supported aliases: %s for %s", (company, expectedCompanyName) => {
    expect(positionEvidenceDetails(`${company} - Talent Acquisition Partner`, { expectedCompanyName }))
      .toMatchObject({ company, title: "Talent Acquisition Partner" });
  });

  it("retains the role heuristic for callers without company context", () => {
    expect(positionEvidenceDetails("Acme - Talent Acquisition Partner"))
      .toMatchObject({ company: "Acme", title: "Talent Acquisition Partner" });
    expect(positionEvidenceDetails("Software Engineer at Acme"))
      .toMatchObject({ company: "Acme", title: "Software Engineer" });
    expect(positionEvidenceDetails("Acme - Software Engineer", { expectedCompanyName: "Other" }))
      .toMatchObject({ company: "Acme", title: "Software Engineer" });
  });

  it.each([
    "Senior Talent Acquisition Partner · Guidewire Software · San Mateo, California, United States",
    "Guidewire Software · Senior Talent Acquisition Partner · United States",
    "500+ connections | Guidewire Software | Senior Talent Acquisition Partner | Full-time | United States"
  ])("passes target context through adjacent snippet segments: %s", (text) => {
    expect(snippetPositionEvidence(text, options)).toMatchObject({ company: "Guidewire Software", title: "Senior Talent Acquisition Partner" });
  });

  it("does not join a complete explicit employment claim to another company segment", () => {
    expect(snippetPositionEvidence("Recruiter at Another Company · Guidewire Software · United States", options))
      .toMatchObject({ company: "Another Company", title: "Recruiter" });
  });
});
