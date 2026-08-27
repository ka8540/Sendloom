import { describe, expect, it, vi } from "vitest";

import {
  ApifyProfileSearchService,
  buildActorInput,
  companyNamesAliasMatch,
  currentCompanyMatches,
  dedupeProfiles,
  extractLabelledSnippetLocation,
  normalizeProfile,
  processDatasetItems,
  readDatasetItemsWithRetry,
  type ApifyRunner,
  type NormalizedProfile,
  type RawProfile
} from "@/services/prospects/apify-profile-search";

/**
 * Fixture matching the legacy harvestapi dataset-item schema. It remains a
 * backwards-compatibility guard: the title lives in
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

function rtxRecruiterItem(
  index: number,
  title: string,
  companyName?: string | null,
  companyLinkedinUrl?: string | null
): RawProfile {
  return harvestApiItem({
    id: `rtx-${index}`,
    publicIdentifier: `rtx-recruiter-${index}`,
    linkedinUrl: `https://www.linkedin.com/in/rtx-recruiter-${index}`,
    firstName: `Recruiter${index}`,
    lastName: "Example",
    headline: title,
    currentPosition: [
      {
        position: title,
        ...(companyName ? { companyName } : {}),
        ...(companyLinkedinUrl ? { companyLinkedinUrl } : {})
      }
    ],
    experience: []
  });
}

describe("buildActorInput", () => {
  it("maps a company URL, structured role variants, location, and depth", () => {
    const input = buildActorInput({
      companyName: "Stripe",
      companyLinkedinUrl: "https://www.linkedin.com/company/stripe",
      jobTitles: ["Software Engineer"],
      locations: ["San Francisco"],
      maxResults: 25
    });

    expect(input).toEqual({
      currentCompanies: ["https://www.linkedin.com/company/stripe"],
      currentJobTitles: ["Software Engineer"],
      locations: ["San Francisco"],
      maxItems: 25
    });
  });

  it("falls back to the company name and preserves an empty location array", () => {
    expect(
      buildActorInput({ companyName: "Stripe", jobTitles: ["Software Engineer"], locations: [], maxResults: 25 })
    ).toEqual({
      currentCompanies: ["Stripe"],
      currentJobTitles: ["Software Engineer"],
      locations: [],
      maxItems: 25
    });
  });

  it("keeps multiple role variants as distinct structured values", () => {
    const input = buildActorInput({
      companyName: "Stripe",
      jobTitles: ["Software Engineer", "Software Developer", "Backend Engineer"],
      locations: [],
      maxResults: 25
    });
    expect(input.currentJobTitles).toEqual([
      "Software Engineer",
      "Software Developer",
      "Backend Engineer"
    ]);
  });

  it("floors and clamps maxItems to the supported 1..120 range", () => {
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 120.9 }).maxItems).toBe(120);
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 999 }).maxItems).toBe(120);
    expect(buildActorInput({ companyName: "X", jobTitles: ["a"], locations: [], maxResults: 0 }).maxItems).toBe(1);
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

  // Ingestion is the ONLY place raw provider name fields are parsed, so a
  // malformed display name must be canonical before it can reach the shared
  // cache, a user's ProspectPerson row, or email generation.
  const ingest = (fields: Record<string, unknown>) =>
    normalizeProfile({ id: "p1", linkedinUrl: "https://www.linkedin.com/in/p1", ...fields });

  it.each([
    ["Jared Cho M.B.A.", "Jared", "Cho"],
    ["Jared Cho MBA", "Jared", "Cho"],
    ["Jared Cho, Ph.D.", "Jared", "Cho"],
    ["Jared M. Cho", "Jared", "Cho"],
    ["Jared Michael Cho", "Jared", "Cho"],
    ["\u{1F680} Jared Cho", "Jared", "Cho"],
    ["Jared Cho \u{1F3AF}", "Jared", "Cho"],
    ["Li Ma", "Li", "Ma"]
  ])("canonicalizes the display name %s at ingestion", (fullName, first, last) => {
    const profile = ingest({ fullName });
    expect(profile?.firstName).toBe(first);
    expect(profile?.lastName).toBe(last);
    expect(profile?.identityStatus).toBe("COMPLETE");
  });

  it("repairs a polluted structured last name", () => {
    const profile = ingest({ firstName: "Jared", lastName: "Cho M.B.A.", fullName: "Jared Cho M.B.A." });
    expect(profile?.firstName).toBe("Jared");
    expect(profile?.lastName).toBe("Cho");
    expect(profile?.fullName).toBe("Jared Cho");
  });

  it("records a parenthetical alias without fusing it into a name component", () => {
    const profile = ingest({ firstName: "Jared", lastName: "(Yiming) Cho", fullName: "Jared (Yiming) Cho" });
    expect(profile?.firstName).toBe("Jared");
    expect(profile?.lastName).toBe("Cho");
    expect(profile?.alternateFirstNames).toEqual(["Yiming"]);
    expect(profile?.fullName).toBe("Jared (Yiming) Cho");
  });

  it("flags an initial-only surname as ambiguous instead of inventing one", () => {
    const profile = ingest({ firstName: "Jared", lastName: "C.", fullName: "Jared C." });
    expect(profile?.firstName).toBe("Jared");
    expect(profile?.lastName).toBe("");
    expect(profile?.identityStatus).toBe("AMBIGUOUS");
    expect(profile?.fullName).toBe("Jared C.");
  });

  it("rejects an item whose name is only decoration", () => {
    expect(ingest({ fullName: "\u{1F680}\u{1F3AF}" })).toBeNull();
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

  it("normalizes the new actor's string currentPosition/currentCompany fields", () => {
    const profile = normalizeProfile({
      ok: true,
      recordType: "profile",
      profileUrl: "https://www.linkedin.com/in/example",
      publicIdentifier: "example",
      fullName: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      headline: "Senior Software Engineer @ Stripe",
      location: "San Francisco Bay Area",
      currentPosition: "Senior Software Engineer",
      currentCompany: "Stripe",
      charged: true
    });

    expect(profile).toMatchObject({
      sourceProfileId: "example",
      linkedinUrl: "https://www.linkedin.com/in/example",
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      currentTitle: "Senior Software Engineer",
      currentCompanyName: "Stripe",
      location: "San Francisco Bay Area"
    });
  });

  it("uses only a strongly labelled snippet location as fallback evidence", () => {
    const profile = normalizeProfile({
      ok: true,
      recordType: "profile",
      profileUrl: "https://www.linkedin.com/in/lseg-valid",
      fullName: "Valid Candidate",
      currentPosition: "Global Head of Talent Acquisition",
      currentCompany: "London Stock Exchange Group (LSEG)",
      location: null,
      snippet: "Experience: LSEG · Location: New York, United States · 500+ connections"
    });

    expect(profile).toMatchObject({
      location: "New York, United States",
      city: "New York",
      country: "United States"
    });
    expect(Object.keys(profile!)).not.toContain("snippet");
  });

  it("does not turn arbitrary snippet geography into candidate location", () => {
    const weakSnippet = "LSEG · 5K followers · New York ... United States · View Profile";
    const profile = normalizeProfile({
      recordType: "profile",
      profileUrl: "https://in.linkedin.com/in/lseg-missing-location",
      fullName: "Missing Location",
      currentPosition: "Talent Acquisition Partner",
      currentCompany: "LSEG",
      location: null,
      snippet: weakSnippet
    });

    expect(extractLabelledSnippetLocation(weakSnippet)).toBeNull();
    expect(profile).toMatchObject({ location: null, city: null, state: null, country: null });
  });

  it("stops labelled snippet extraction at a connection count", () => {
    expect(extractLabelledSnippetLocation("Location: United States 500+ connections")).toBe("United States");
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
    expect(companyNamesAliasMatch("LSEG", "LSEG (London Stock Exchange Group)")).toBe(true);
    expect(companyNamesAliasMatch("LSEG", "London Stock Exchange Group (LSEG)")).toBe(true);
    expect(companyNamesAliasMatch("LSEG", "London Stock Exchange Group")).toBe(true);
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
    alternateFirstNames: [],
    identityStatus: "COMPLETE",
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

  it("keeps public-index candidates strict when employer metadata is missing or unrelated", () => {
    const target = {
      companyName: "RTX Corporation",
      linkedinCompanyUrl: "https://www.linkedin.com/company/rtx/"
    };

    expect(
      currentCompanyMatches(
        {
          ...base,
          currentCompanyName: "RTX Corporation",
          currentCompanyUrl: "https://www.linkedin.com/company/rtx/"
        },
        target
      )
    ).toBe(true);
    expect(currentCompanyMatches({ ...base, currentCompanyName: null, currentCompanyUrl: null }, target)).toBe(false);
    expect(
      currentCompanyMatches(
        {
          ...base,
          currentCompanyName: "Microsoft",
          currentCompanyUrl: "https://www.linkedin.com/company/microsoft/"
        },
        target
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
      profileRows: 4,
      diagnosticItems: 0,
      diagnosticCodes: [],
      temporaryDiagnosticItems: 0,
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

  it("accepts matching employers and rejects public-index rows with unrelated or missing employers", () => {
    const strictRtxTarget = {
      companyName: "RTX Corporation",
      linkedinCompanyUrl: "https://www.linkedin.com/company/rtx/"
    };
    const validItems = [
      rtxRecruiterItem(1, "Recruiter", "RTX Corporation", "https://www.linkedin.com/company/rtx/"),
      rtxRecruiterItem(2, "Technical Recruiter", "RTX Corporation", "https://www.linkedin.com/company/rtx/"),
      rtxRecruiterItem(3, "Engineering Recruiter", "RTX Corporation", "https://www.linkedin.com/company/rtx/"),
      rtxRecruiterItem(4, "Talent Acquisition Recruiter", "RTX Corporation", "https://www.linkedin.com/company/rtx/"),
      rtxRecruiterItem(5, "Talent Acquisition Specialist", "RTX Corporation", "https://www.linkedin.com/company/rtx/"),
      rtxRecruiterItem(6, "Campus Recruiter", "RTX Corporation", "https://www.linkedin.com/company/rtx/"),
      rtxRecruiterItem(7, "Executive Technology Recruiting Leader", "Raytheon", "https://www.linkedin.com/company/raytheon/"),
      rtxRecruiterItem(8, "Talent Acquisition Business Partner", "Raytheon Technologies"),
      rtxRecruiterItem(9, "Recruiting Leader", "Raytheon"),
      rtxRecruiterItem(10, "Senior Recruiter")
    ];

    const validOnly = processDatasetItems(validItems, strictRtxTarget, 25);
    expect(validOnly.profiles).toHaveLength(6);
    expect(validOnly.diagnostics).toMatchObject({
      itemsReturned: 10,
      parsedCandidates: 10,
      rejectedBySchema: 0,
      duplicateItems: 0,
      companyMatched: 6,
      rejectedByCompany: 4
    });

    const withExplicitUnrelatedEmployer = processDatasetItems(
      [
        ...validItems,
        rtxRecruiterItem(11, "Recruiter", "Microsoft", "https://www.linkedin.com/company/microsoft/")
      ],
      strictRtxTarget,
      25
    );
    expect(withExplicitUnrelatedEmployer.profiles).toHaveLength(6);
    expect(withExplicitUnrelatedEmployer.diagnostics).toMatchObject({
      itemsReturned: 11,
      companyMatched: 6,
      rejectedByCompany: 5
    });
  });

  it("keeps LSEG current-company validation authoritative over arbitrary page mentions", () => {
    const item = (id: string, currentCompany: string, snippet: string): RawProfile => ({
      ok: true,
      recordType: "profile",
      profileUrl: `https://www.linkedin.com/in/${id}`,
      publicIdentifier: id,
      fullName: `Candidate ${id}`,
      currentPosition: "Recruiter",
      currentCompany,
      location: "New York, United States",
      snippet
    });
    const { profiles, diagnostics } = processDatasetItems(
      [
        item("lseg", "London Stock Exchange Group (LSEG)", "Experience: LSEG · Location: New York, United States"),
        item("capital-one", "Capital One", "LSEG · United States · View Profile"),
        item("lutron", "Lutron Electronics", "LSEG · New York · View Profile"),
        item("irenic", "Irenic Capital Management LP", "LSEG · United States · View Profile")
      ],
      { companyName: "LSEG" },
      25
    );

    expect(profiles.map((profile) => profile.sourceProfileId)).toEqual(["lseg"]);
    expect(diagnostics).toMatchObject({
      profileRows: 4,
      parsedCandidates: 4,
      companyMatched: 1,
      rejectedByCompany: 3
    });
  });

  it("filters a NO_RESULTS diagnostic before ingestion", () => {
    const { profiles, diagnostics } = processDatasetItems(
      [
        {
          ok: false,
          charged: false,
          recordType: "diagnostic",
          code: "NO_RESULTS",
          requestsMade: 3
        }
      ],
      target,
      25
    );

    expect(profiles).toEqual([]);
    expect(diagnostics).toMatchObject({
      itemsReturned: 1,
      profileRows: 0,
      diagnosticItems: 1,
      diagnosticCodes: ["NO_RESULTS"],
      temporaryDiagnosticItems: 0,
      parsedCandidates: 0,
      rejectedBySchema: 0
    });
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

  it("treats a NO_RESULTS diagnostic row as a successful zero-profile run", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run-no-results",
        datasetId: "ds-no-results",
        items: [{ ok: false, charged: false, recordType: "diagnostic", code: "NO_RESULTS", requestsMade: 3 }],
        status: "SUCCEEDED"
      }))
    };
    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });

    const result = await service.searchProfiles({
      companyName: "Stripe",
      jobTitles: ["Software Engineer"],
      locations: [],
      maxResults: 25
    });

    expect(result.profiles).toEqual([]);
    expect(result.totalFound).toBe(0);
    expect(result.diagnostics).toMatchObject({
      itemsReturned: 1,
      profileRows: 0,
      diagnosticItems: 1,
      diagnosticCodes: ["NO_RESULTS"],
      temporaryDiagnosticItems: 0
    });
  });

  it("fails safely on a temporary public-index diagnostic", async () => {
    const runner: ApifyRunner = {
      run: vi.fn(async () => ({
        runId: "run-refused",
        datasetId: "ds-refused",
        items: [{ ok: false, charged: false, recordType: "diagnostic", code: "RATE_LIMITED" }],
        status: "SUCCEEDED"
      }))
    };
    const service = new ApifyProfileSearchService({ token: "test-token", actorId: "actor", runner });

    await expect(
      service.searchProfiles({ companyName: "Stripe", jobTitles: ["Engineer"], locations: [], maxResults: 25 })
    ).rejects.toThrow("temporarily unavailable");
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
