import { describe, expect, it, vi } from "vitest";

import {
  ApifyProfileSearchService,
  buildActorInput,
  companyNamesAliasMatch,
  currentCompanyMatches,
  dedupeProfiles,
  normalizeProfile,
  processDatasetItems,
  readDatasetItemsWithRetry,
  type ApifyRunner,
  type NormalizedProfile,
  type RawProfile
} from "@/services/prospects/apify-profile-search";

/**
 * Fixture matching the CURRENT harvestapi/linkedin-profile-search dataset-item
 * schema (verified against a real run): the title lives in
 * `currentPosition[0].position`, the employer URL in `companyLinkedinUrl`, and
 * the location is an object with `linkedinText`/`parsed`. The employer slug is
 * LinkedIn's canonical alias ("examplecorp") which can differ from the vanity
 * slug the search was queried with ("example-corp").
 */
function harvestApiItem(overrides: Record<string, unknown> = {}): RawProfile {
  return {
    id: "ACoAAExample123",
    publicIdentifier: "jane-doe-1",
    linkedinUrl: "https://www.linkedin.com/in/jane-doe-1",
    firstName: "Jane",
    lastName: "Doe",
    emails: [],
    headline: "Software engineer",
    openToWork: false,
    location: {
      linkedinText: "Plano, Texas, United States",
      countryCode: "US",
      parsed: {
        text: "Plano, TX, United States",
        country: "United States",
        state: "Texas",
        city: "Plano"
      }
    },
    currentPosition: [
      {
        position: "Software Engineer III",
        location: "Plano, Texas, United States",
        employmentType: "Full-time",
        companyName: "Example Corp & Co.",
        companyLinkedinUrl: "https://www.linkedin.com/company/examplecorp/",
        companyId: "1068",
        companyUniversalName: "examplecorp"
      }
    ],
    experience: [
      {
        position: "Software Engineer III",
        companyName: "Example Corp & Co.",
        companyLinkedinUrl: "https://www.linkedin.com/company/examplecorp/"
      }
    ],
    ...overrides
  };
}

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

  it("requests exactly 10 items on a single page for a fixed Discover search (#2, #3)", () => {
    const input = buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 10 });
    expect(input.maxItems).toBe(10);
    expect(input.takePages).toBe(1);
  });

  it("omits currentCompanies when no LinkedIn company URL is known", () => {
    const input = buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 10 });
    expect(input.currentCompanies).toBeUndefined();
  });

  it("defaults startPage to 1 but honors a continuation page for Add 10 more (#14)", () => {
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 25 }).startPage).toBe(1);
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 25, startPage: 3 }).startPage).toBe(3);
    // Never below 1, always an integer.
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 25, startPage: 0 }).startPage).toBe(1);
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

  it("parses the current harvestapi dataset-item schema (#parser-8)", () => {
    const profile = normalizeProfile(harvestApiItem());

    expect(profile).toMatchObject({
      sourceProfileId: "ACoAAExample123",
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      currentTitle: "Software Engineer III",
      city: "Plano",
      state: "Texas",
      country: "United States",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe-1",
      currentCompanyName: "Example Corp & Co.",
      currentCompanyUrl: "https://www.linkedin.com/company/examplecorp/"
    });
  });

  it("keeps a usable profile when optional fields are missing (#parser-11)", () => {
    const profile = normalizeProfile(
      harvestApiItem({ headline: null, location: null, currentPosition: [], experience: [] })
    );
    expect(profile).not.toBeNull();
    expect(profile!.currentTitle).toBeNull();
    expect(profile!.location).toBeNull();
  });
});

describe("companyNamesAliasMatch", () => {
  it("matches the documented same-employer aliases (#company-13,14,16)", () => {
    expect(companyNamesAliasMatch("JPMorgan Chase & Co.", "JPMorgan Chase")).toBe(true);
    expect(companyNamesAliasMatch("JPMorgan Chase & Co.", "JPMorgan")).toBe(true);
    expect(companyNamesAliasMatch("JPMorgan Chase & Co.", "J.P. Morgan")).toBe(true);
    expect(companyNamesAliasMatch("JPMorgan Chase & Co.", "JPMorganChase")).toBe(true);
    expect(companyNamesAliasMatch("Ernst & Young", "Ernst and Young")).toBe(true);
  });

  it("rejects unrelated companies and lookalike prefixes (#company-17)", () => {
    expect(companyNamesAliasMatch("JPMorgan Chase & Co.", "Goldman Sachs")).toBe(false);
    expect(companyNamesAliasMatch("Apple", "Applebee's")).toBe(false);
    expect(companyNamesAliasMatch("Meta", "Metallica")).toBe(false);
    expect(companyNamesAliasMatch("GE", "Genentech")).toBe(false);
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

  it("excludes a profile when no current-company signal is comparable", () => {
    expect(currentCompanyMatches({ ...base, currentCompanyName: null }, { companyName: "Apple" })).toBe(false);
  });

  it("accepts LinkedIn slug aliases that differ only by punctuation (#company-15)", () => {
    const profile = {
      ...base,
      currentCompanyName: "Example Corp & Co.",
      currentCompanyUrl: "https://www.linkedin.com/company/examplecorp/"
    };
    expect(
      currentCompanyMatches(profile, {
        companyName: "Example Corp & Co.",
        linkedinCompanyUrl: "https://www.linkedin.com/company/example-corp/"
      })
    ).toBe(true);
  });

  it("falls back to alias-tolerant name matching when slugs disagree (#company-16)", () => {
    const profile = {
      ...base,
      currentCompanyName: "JPMorgan Chase & Co.",
      currentCompanyUrl: "https://www.linkedin.com/company/jpmc-careers/"
    };
    expect(
      currentCompanyMatches(profile, {
        companyName: "JPMorgan Chase",
        linkedinCompanyUrl: "https://www.linkedin.com/company/jpmorgan-chase/"
      })
    ).toBe(true);
    // An unrelated employer stays rejected even with a slug present (#company-17).
    expect(
      currentCompanyMatches(
        { ...profile, currentCompanyName: "Goldman Sachs", currentCompanyUrl: "https://www.linkedin.com/company/goldman-sachs/" },
        { companyName: "JPMorgan Chase", linkedinCompanyUrl: "https://www.linkedin.com/company/jpmorgan-chase/" }
      )
    ).toBe(false);
  });
});

describe("processDatasetItems", () => {
  const target = {
    companyName: "Example Corp & Co.",
    linkedinCompanyUrl: "https://www.linkedin.com/company/example-corp/"
  };

  it("processes a full batch and reports per-stage diagnostics", () => {
    const items = [
      harvestApiItem(),
      harvestApiItem(), // duplicate of the first
      harvestApiItem({ id: "p2", publicIdentifier: "bob", linkedinUrl: "https://www.linkedin.com/in/bob", firstName: "Bob" }),
      harvestApiItem({
        id: "p3",
        linkedinUrl: "https://www.linkedin.com/in/eve",
        firstName: "Eve",
        currentPosition: [{ position: "Engineer", companyName: "Other Company", companyLinkedinUrl: "https://www.linkedin.com/company/other-company/" }],
        experience: []
      }),
      { garbage: true } // malformed item must not fail the batch (#parser-10)
    ];

    const { profiles, diagnostics } = processDatasetItems(items, target, 10);

    expect(profiles.map((profile) => profile.firstName).sort()).toEqual(["Bob", "Jane"]);
    expect(diagnostics).toEqual({
      itemsReturned: 5,
      parsedCandidates: 4,
      rejectedBySchema: 1,
      duplicateItems: 1,
      companyMatched: 2,
      rejectedByCompany: 1
    });
  });

  it("produces rejection counts instead of throwing on an all-rejected batch (#parser-12)", () => {
    const { profiles, diagnostics } = processDatasetItems([{ bad: 1 }, { alsoBad: 2 }], target, 10);
    expect(profiles).toHaveLength(0);
    expect(diagnostics.rejectedBySchema).toBe(2);
  });
});

describe("readDatasetItemsWithRetry", () => {
  it("retries a transiently empty dataset read with bounded backoff (#run-4)", async () => {
    const reads: RawProfile[][] = [[], [], [harvestApiItem()]];
    let call = 0;
    const delays: number[] = [];
    const items = await readDatasetItemsWithRetry(async () => reads[call++] ?? [], {
      sleep: async (ms) => {
        delays.push(ms);
      }
    });
    expect(items).toHaveLength(1);
    expect(call).toBe(3);
    expect(delays).toEqual([500, 1000]); // short exponential backoff
  });

  it("gives up after the bounded attempts and returns the empty read", async () => {
    let calls = 0;
    const items = await readDatasetItemsWithRetry(
      async () => {
        calls += 1;
        return [];
      },
      { attempts: 3, sleep: async () => {} }
    );
    expect(items).toEqual([]);
    expect(calls).toBe(3); // never polls forever
  });

  it("returns immediately when the first read has items", async () => {
    let calls = 0;
    const items = await readDatasetItemsWithRetry(async () => {
      calls += 1;
      return [harvestApiItem()];
    });
    expect(calls).toBe(1);
    expect(items).toHaveLength(1);
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

  it("surfaces the Apify free-tier run limit instead of silently returning zero people", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run-limited",
        datasetId: null,
        items: [],
        status: "SUCCEEDED",
        statusMessage: "free user run limit reached"
      }))
    };
    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });

    await expect(
      service.searchProfiles({ companyName: "Applied Materials", jobTitles: ["Software Engineer"], locations: [], maxResults: 25 })
    ).rejects.toThrow(/free user run limit reached.*Apify plan/i);
  });

  it("throws when the run reaches a non-success terminal status", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({ runId: "run-x", datasetId: null, items: [], status: "ABORTED", statusMessage: null }))
    };
    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });

    await expect(
      service.searchProfiles({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 10 })
    ).rejects.toThrow(/did not complete \(status ABORTED\)/i);
  });

  it("allows a genuine zero-result run that succeeded without a limit message", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({ runId: "run-empty", datasetId: "ds", items: [], status: "SUCCEEDED", statusMessage: null }))
    };
    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });

    const result = await service.searchProfiles({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 10 });
    expect(result.profiles).toHaveLength(0);
    expect(result.totalFound).toBe(0);
  });

  it("keeps all people from a real-schema run queried by a punctuation-variant slug (#run-3)", async () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      harvestApiItem({
        id: `p${index}`,
        publicIdentifier: `person-${index}`,
        linkedinUrl: `https://www.linkedin.com/in/person-${index}`
      })
    );
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({ runId: "run1", datasetId: "ds1", items, status: "SUCCEEDED", statusMessage: null }))
    };
    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });

    const result = await service.searchProfiles({
      companyName: "Example Corp & Co.",
      companyLinkedinUrl: "https://www.linkedin.com/company/example-corp/",
      jobTitles: ["Software Engineer"],
      locations: ["United States"],
      maxResults: 10
    });

    // The provider's 10 items become 10 eligible profiles — never silently 0.
    expect(result.profiles).toHaveLength(10);
    expect(result.diagnostics).toMatchObject({
      itemsReturned: 10,
      companyMatched: 10,
      rejectedByCompany: 0,
      rejectedBySchema: 0
    });
  });

  it("reads a stored dataset by dataset id without starting a new run (#repair-37,38)", async () => {
    const fetchDatasetItems = vi.fn(async (datasetId: string) =>
      datasetId === "stored-ds" ? [harvestApiItem()] : []
    );
    const run = vi.fn();
    const runner: ApifyRunner = { run, fetchDatasetItems };
    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });

    const items = await service.fetchStoredDatasetItems("stored-ds");
    expect(items).toHaveLength(1);
    expect(fetchDatasetItems).toHaveBeenCalledWith("stored-ds");
    expect(run).not.toHaveBeenCalled();
  });
});
