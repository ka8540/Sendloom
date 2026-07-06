import { describe, expect, it, vi } from "vitest";

import {
  EmailFormatDiscoveryService,
  extractCandidateEmails,
  inferPatternFromExampleEmails,
  normalizePublicEmailPattern,
  parsePublicEmailFormatEvidence
} from "@/services/prospects/email-format-discovery-service";

const ESRI_ROCKETREACH_TEXT = `
The most common Esri email format is [first_initial][last] (ex. jdoe@esri.com), which is being used by 84.7% of Esri work email addresses.

Email Format | Example | Percentage
[first_initial][last] | jdoe@esri.com | 84.7%
[first][last] | janedoe@esri.com | 6.3%
[first]_[last] | jane_doe@esri.com | 1.9%
`;

describe("normalizePublicEmailPattern", () => {
  it("maps RocketReach first-initial last syntax to flast", () => {
    expect(normalizePublicEmailPattern("[first_initial][last]")).toBe("flast");
  });

  it("maps first underscore last syntax to first_last", () => {
    expect(normalizePublicEmailPattern("[first]_[last]")).toBe("first_last");
  });
});

describe("parsePublicEmailFormatEvidence", () => {
  it("extracts RocketReach-style pattern, example domain, and percentage", () => {
    const bundle = parsePublicEmailFormatEvidence(ESRI_ROCKETREACH_TEXT, {
      sourceUrl: "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51"
    });

    expect(bundle.rows[0]).toMatchObject({
      sourceName: "RocketReach",
      patternRaw: "[first_initial][last]",
      pattern: "flast",
      example: "jdoe@esri.com",
      emailDomain: "esri.com",
      percentage: 84.7,
      confidence: "HIGH"
    });
    expect(bundle.domainEvidence?.[0]).toMatchObject({
      emailDomain: "esri.com",
      observedPattern: "flast",
      sourceType: "public_format_page"
    });
  });

  it("uses the example email domain rather than the website domain", () => {
    const bundle = parsePublicEmailFormatEvidence(
      "Applied Materials Email Format\n[first]_[last]\njane_doe@amat.com\nhighest percentage",
      { sourceUrl: "https://rocketreach.co/applied-materials-email-format" }
    );

    expect(bundle.rows[0]).toMatchObject({
      pattern: "first_last",
      example: "jane_doe@amat.com",
      emailDomain: "amat.com",
      confidence: "HIGH"
    });
  });

  it("rejects personal email domains from public pages", () => {
    const bundle = parsePublicEmailFormatEvidence("[first]_[last] | jane_doe@gmail.com | 99%");
    expect(bundle.rows).toHaveLength(0);
    expect(bundle.domainEvidence).toHaveLength(0);
  });

  it("infers first.last from consistent mailto: work-email examples on a plain page", () => {
    const html = `
      <html><body>
        <ul>
          <li><a href="mailto:jane.doe@acme.com">Jane Doe</a></li>
          <li><a href="mailto:john.smith@acme.com">John Smith</a></li>
          <li><a href="mailto:maria.lee@acme.com">Maria Lee</a></li>
        </ul>
        <a href="mailto:careers@acme.com">Careers</a>
      </body></html>`;
    const bundle = parsePublicEmailFormatEvidence(html, { sourceUrl: "https://acme.com/team" });

    expect(bundle.rows).toHaveLength(1);
    expect(bundle.rows[0]).toMatchObject({ pattern: "first.last", emailDomain: "acme.com", confidence: "HIGH" });
    expect(bundle.patternEvidence?.[0]).toMatchObject({ pattern: "first.last", emailDomain: "acme.com" });
  });

  it("prefers an explicit bracket table over example inference when both exist", () => {
    const bundle = parsePublicEmailFormatEvidence(
      `${ESRI_ROCKETREACH_TEXT}\n<a href="mailto:jane.doe@esri.com">x</a>\n<a href="mailto:john.smith@esri.com">y</a>`,
      { sourceUrl: "https://rocketreach.co/esri-email-format" }
    );
    // The stated table (flast) wins; inference is only a fallback.
    expect(bundle.rows[0]).toMatchObject({ pattern: "flast", emailDomain: "esri.com" });
  });
});

describe("extractCandidateEmails", () => {
  it("captures mailto hrefs and visible-text emails, de-duplicated and lowercased", () => {
    const emails = extractCandidateEmails(
      `<a href="mailto:Jane.Doe@Acme.com">Jane</a> contact john.smith@acme.com or JANE.DOE@ACME.COM`
    );
    expect(emails.sort()).toEqual(["jane.doe@acme.com", "john.smith@acme.com"]);
  });
});

describe("inferPatternFromExampleEmails", () => {
  it("requires two distinct agreeing examples on the same business domain", () => {
    expect(inferPatternFromExampleEmails(["jane.doe@acme.com"])).toBeNull();
    expect(
      inferPatternFromExampleEmails(["jane.doe@acme.com", "john.smith@acme.com"])
    ).toMatchObject({ pattern: "first.last", emailDomain: "acme.com", confidence: "MEDIUM" });
  });

  it("infers separator variants (f.last, first_last)", () => {
    expect(
      inferPatternFromExampleEmails(["j.doe@acme.com", "m.smith@acme.com"])
    ).toMatchObject({ pattern: "f.last" });
    expect(
      inferPatternFromExampleEmails(["jane_doe@acme.com", "john_smith@acme.com"])
    ).toMatchObject({ pattern: "first_last" });
  });

  it("never infers ambiguous separatorless forms, personal domains, or role mailboxes", () => {
    // jsmith / johnsmith are ambiguous without names → no inference.
    expect(inferPatternFromExampleEmails(["jsmith@acme.com", "mdoe@acme.com"])).toBeNull();
    // personal domains excluded.
    expect(inferPatternFromExampleEmails(["jane.doe@gmail.com", "john.smith@gmail.com"])).toBeNull();
    // role mailboxes carry no name structure.
    expect(inferPatternFromExampleEmails(["info@acme.com", "sales@acme.com"])).toBeNull();
  });
});

describe("EmailFormatDiscoveryService", () => {
  it("parses a direct public source URL without a configured search provider", async () => {
    const fetchPage = vi.fn(async () => ESRI_ROCKETREACH_TEXT);
    const service = new EmailFormatDiscoveryService({ searchProvider: null, fetchPage });

    const bundle = await service.findEvidence({
      companyName: "Esri",
      officialWebsiteDomain: "esri.com",
      sourceUrl: "https://rocketreach.co/esri-email-format_b5c60d6df42e0c51"
    });

    expect(fetchPage).toHaveBeenCalledWith("https://rocketreach.co/esri-email-format_b5c60d6df42e0c51");
    expect(bundle.domainEvidence?.[0]).toMatchObject({ emailDomain: "esri.com", observedPattern: "flast" });
    expect(bundle.patternEvidence?.[0]).toMatchObject({ pattern: "flast", emailDomain: "esri.com" });
  });

  it("warns instead of crashing when search is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = new EmailFormatDiscoveryService({ searchProvider: null, fetchPage: vi.fn() });

    const bundle = await service.findEvidence({ companyName: "No Search Co", officialWebsiteDomain: "example.com" });

    expect(bundle.domainEvidence).toEqual([]);
    expect(bundle.patternEvidence).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[prospect-email-discovery] No web search provider configured");
    warn.mockRestore();
  });
});
