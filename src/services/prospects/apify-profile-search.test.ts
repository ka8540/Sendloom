import { describe, expect, it, vi } from "vitest";

import {
  ApifyProfileSearchService,
  buildActorInput,
  currentCompanyMatches,
  dedupeProfiles,
  normalizeProfile,
  type ApifyRunner,
  type NormalizedProfile
} from "@/services/prospects/apify-profile-search";

describe("buildActorInput", () => {
  it("maps company/title/location and always keeps takePages >= 1", () => {
    const input = buildActorInput({
      companyName: "Apple",
      companyLinkedinUrl: "https://www.linkedin.com/company/apple/",
      jobTitles: ["Software Engineer", "Recruiter"],
      locations: ["United States"],
      maxResults: 25
    });

    expect(input).toMatchObject({
      profileScraperMode: "Full",
      currentCompanies: ["https://www.linkedin.com/company/apple/"],
      currentJobTitles: ["Software Engineer", "Recruiter"],
      locations: ["United States"],
      maxItems: 25,
      takePages: 1,
      startPage: 1,
      autoQuerySegmentation: false
    });
  });

  it("computes takePages from maxResults (25 per page)", () => {
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 60 }).takePages).toBe(3);
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 1 }).takePages).toBe(1);
  });

  it("omits currentCompanies when no LinkedIn company URL is known", () => {
    const input = buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 10 });
    expect(input.currentCompanies).toBeUndefined();
  });
});

describe("normalizeProfile", () => {
  it("extracts only the fields Sendloom needs from a raw profile", () => {
    const profile = normalizeProfile({
      id: "abc123",
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      headline: "Senior Software Engineer at Apple",
      location: { linkedinText: "Cupertino, California, United States" },
      currentPosition: [{ title: "Senior Software Engineer", companyName: "Apple", companyLinkedinUrl: "https://www.linkedin.com/company/apple/" }],
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
      // Sensitive fields that must be discarded:
      profilePicture: "https://example.com/photo.jpg",
      phoneNumber: "+1-555-1234",
      personalEmail: "jane@gmail.com"
    });

    expect(profile).not.toBeNull();
    expect(profile).toMatchObject({
      sourceProfileId: "abc123",
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      currentTitle: "Senior Software Engineer",
      city: "Cupertino",
      country: "United States",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
      currentCompanyName: "Apple"
    });
    // No sensitive fields leak through normalization.
    expect(Object.keys(profile!)).not.toContain("profilePicture");
    expect(Object.keys(profile!)).not.toContain("phoneNumber");
    expect(Object.keys(profile!)).not.toContain("personalEmail");
  });

  it("returns null without a profile URL or name", () => {
    expect(normalizeProfile({ firstName: "Jane" })).toBeNull();
    expect(normalizeProfile({ linkedinUrl: "https://www.linkedin.com/in/x" })).toBeNull();
  });
});

describe("currentCompanyMatches", () => {
  const base: NormalizedProfile = {
    sourceProfileId: "1",
    firstName: "Jane",
    lastName: "Doe",
    fullName: "Jane Doe",
    currentTitle: "Engineer",
    normalizedTitle: "engineer",
    location: null,
    city: null,
    state: null,
    country: null,
    linkedinUrl: "https://www.linkedin.com/in/jane",
    currentCompanyName: "Apple",
    currentCompanyUrl: null
  };

  it("excludes a profile whose current company differs", () => {
    expect(currentCompanyMatches({ ...base, currentCompanyName: "Google" }, { companyName: "Apple" })).toBe(false);
    expect(currentCompanyMatches(base, { companyName: "Apple" })).toBe(true);
  });

  it("keeps a profile when no company signal is comparable", () => {
    expect(currentCompanyMatches({ ...base, currentCompanyName: null }, { companyName: "Apple" })).toBe(true);
  });
});

describe("dedupeProfiles", () => {
  it("removes duplicate profiles by source id", () => {
    const profile = { ...(({ sourceProfileId: "1" } as unknown) as NormalizedProfile) };
    const result = dedupeProfiles([profile, profile, { ...profile, sourceProfileId: "2" } as NormalizedProfile]);
    expect(result).toHaveLength(2);
  });
});

describe("ApifyProfileSearchService.searchProfiles", () => {
  it("normalizes, dedupes, and excludes company mismatches", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run1",
        datasetId: "ds1",
        items: [
          { id: "1", firstName: "Jane", lastName: "Doe", headline: "Engineer", currentPosition: [{ companyName: "Apple" }], linkedinUrl: "https://www.linkedin.com/in/jane" },
          { id: "1", firstName: "Jane", lastName: "Doe", headline: "Engineer", currentPosition: [{ companyName: "Apple" }], linkedinUrl: "https://www.linkedin.com/in/jane" },
          { id: "2", firstName: "Bob", lastName: "Lee", headline: "Engineer", currentPosition: [{ companyName: "Google" }], linkedinUrl: "https://www.linkedin.com/in/bob" }
        ]
      }))
    };

    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });
    const result = await service.searchProfiles({
      companyName: "Apple",
      jobTitles: ["Engineer"],
      locations: ["United States"],
      maxResults: 25
    });

    expect(result.runId).toBe("run1");
    expect(result.totalFound).toBe(3);
    // Bob (Google) excluded, Jane deduped to one.
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].firstName).toBe("Jane");
  });
});
