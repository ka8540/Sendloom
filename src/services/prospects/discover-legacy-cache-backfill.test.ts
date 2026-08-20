import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { computeDiscoverFingerprint } from "@/services/prospects/discover-cache-fingerprint";
import {
  PrismaDiscoverLegacyCacheBackfillStore,
  runDiscoverLegacyCacheBackfill
} from "@/services/prospects/discover-legacy-cache-backfill";
import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import { parseDiscoverSharedCacheBackfillArgs } from "../../../scripts/backfill-discover-shared-cache";

const NOW = new Date("2026-08-20T20:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

type HistoricalSeed = {
  userId?: string;
  companyName?: string;
  domain?: string | null;
  linkedinUrl?: string | null;
  resultSource?: string | null;
  apifyRunId?: string | null;
  allocationSource?: string;
  completedAt?: Date;
  profileId?: string;
  title?: string;
  country?: string;
};

async function seedHistoricalSearch(prisma: FakePrisma, input: HistoricalSeed = {}) {
  const userId = input.userId ?? "user_A";
  const companyName = input.companyName ?? "Apple Inc.";
  const domain = input.domain === undefined ? "apple.com" : input.domain;
  const company = await prisma.prospectCompany.upsert({
    where: { userId_canonicalKey: { userId, canonicalKey: domain ? `domain:${domain}` : "name:apple" } },
    create: {
      userId,
      canonicalKey: domain ? `domain:${domain}` : "name:apple",
      name: companyName,
      normalizedName: "apple",
      officialName: companyName,
      officialDomain: domain,
      officialWebsiteDomain: domain,
      officialWebsite: domain ? `https://${domain}` : null,
      linkedinUrl: input.linkedinUrl ?? null,
      domainConfidence: domain ? "HIGH" : "UNAVAILABLE"
    },
    update: {}
  });
  const title = input.title ?? "Software Engineer";
  const category = title.includes("Recruiter") ? "RECRUITING" : "SOFTWARE_ENGINEERING";
  const position = await prisma.prospectCompanyPosition.upsert({
    where: { companyId_category: { companyId: company.id, category } },
    create: { companyId: company.id, category, displayName: category, rawTitles: [title] },
    update: {}
  });
  const profileId = input.profileId ?? "apple-swe-1";
  const country = input.country ?? "United States";
  const person = await prisma.prospectPerson.upsert({
    where: { userId_sourceProfileId: { userId, sourceProfileId: profileId } },
    create: {
      userId,
      companyId: company.id,
      positionId: position.id,
      sourceProfileId: profileId,
      firstName: "Private",
      lastName: "Owner",
      fullName: "Private Owner",
      currentTitle: title,
      normalizedTitle: title.toLowerCase(),
      location: country,
      country,
      state: null,
      city: null,
      linkedinUrl: `https://www.linkedin.com/in/${profileId}`,
      // These tenant fields must never be copied by the adapter.
      inferredEmail: `private-${profileId}@example.test`,
      emailStatus: "MANUAL_VERIFIED",
      emailConfidence: "HIGH",
      emailPattern: "first.last",
      emailSource: "MANUAL"
    },
    update: {}
  });
  const completedAt = input.completedAt ?? new Date(NOW.getTime() - DAY_MS);
  const search = await prisma.prospectSearch.create({
    data: {
      userId,
      companyId: company.id,
      requestedCompany: companyName,
      requestedDomain: domain,
      requestedLinkedin: input.linkedinUrl ?? null,
      requestedTitles: [title],
      requestedLocations: [country],
      maxResults: 10,
      status: "READY",
      resultSource: input.resultSource === undefined ? "PROVIDER" : input.resultSource,
      apifyRunId: input.apifyRunId === undefined ? "run-historical" : input.apifyRunId,
      apifyDatasetId: "dataset-historical",
      lastAttemptCompletedAt: completedAt,
      completedAt
    }
  });
  await prisma.prospectSearchPerson.create({
    data: {
      searchId: search.id,
      personId: person.id,
      userId,
      allocationOrder: 0,
      allocationSource: input.allocationSource ?? "PROVIDER"
    }
  });
  return { company, person, search };
}

function store(prisma: FakePrisma) {
  return new PrismaDiscoverLegacyCacheBackfillStore(prisma as unknown as PrismaClient);
}

describe("Discover historical shared-cache backfill", () => {
  it("defaults the CLI to dry-run and validates mutually exclusive/positive arguments", () => {
    expect(parseDiscoverSharedCacheBackfillArgs([])).toEqual({ apply: false, batchSize: 100, limit: null });
    expect(
      parseDiscoverSharedCacheBackfillArgs(["--apply", "--batch-size", "25", "--limit", "250"])
    ).toEqual({ apply: true, batchSize: 25, limit: 250 });
    expect(() => parseDiscoverSharedCacheBackfillArgs(["--apply", "--dry-run"])).toThrow(/either/i);
    expect(() => parseDiscoverSharedCacheBackfillArgs(["--limit", "0"])).toThrow(/positive integer/i);
    expect(() => parseDiscoverSharedCacheBackfillArgs(["--unknown"])).toThrow(/unknown argument/i);
  });

  it("dry-runs without writes, applies sanitized public fields, and is idempotent", async () => {
    const prisma = createFakePrisma();
    await seedHistoricalSearch(prisma);

    const dryRun = await runDiscoverLegacyCacheBackfill({
      store: store(prisma),
      options: { apply: false, batchSize: 1, limit: null },
      now: NOW,
      cacheVersion: "v1",
      cacheTtlDays: 30
    });
    expect(dryRun).toMatchObject({
      mode: "DRY_RUN",
      historicalSearchesScanned: 1,
      providerEligibleSearches: 1,
      cacheEntriesToCreate: 1,
      peopleToInsert: 1
    });
    expect(prisma._state.discoverCache).toHaveLength(0);
    expect(prisma._state.discoverCachePeople).toHaveLength(0);

    const first = await runDiscoverLegacyCacheBackfill({
      store: store(prisma),
      options: { apply: true, batchSize: 10, limit: null },
      now: NOW,
      cacheVersion: "v1",
      cacheTtlDays: 30
    });
    expect(first.peopleToInsert).toBe(1);
    expect(prisma._state.discoverCache).toHaveLength(1);
    expect(prisma._state.discoverCache[0]).toMatchObject({
      status: "READY",
      companyKey: "domain:apple.com",
      providerNextPage: 1,
      providerPagesFetched: 0,
      providerExhausted: false,
      lastProviderFetchAt: null,
      emailDomain: null,
      emailDomainConfidence: "UNAVAILABLE",
      emailPattern: null,
      patternConfidence: "UNAVAILABLE",
      emailFormatDiscoveryStatus: "NOT_ATTEMPTED"
    });
    const sharedPerson = prisma._state.discoverCachePeople[0];
    expect(sharedPerson).toMatchObject({
      sourceProfileId: "apple-swe-1",
      currentTitle: "Software Engineer",
      inferredEmail: null,
      emailStatus: "UNAVAILABLE",
      emailConfidence: "UNAVAILABLE",
      emailPattern: null,
      emailSource: null
    });
    expect(JSON.stringify({ entry: prisma._state.discoverCache[0], person: sharedPerson })).not.toMatch(
      /user_A|userId|private-apple-swe-1@example\.test|MANUAL_VERIFIED/
    );

    const second = await runDiscoverLegacyCacheBackfill({
      store: store(prisma),
      options: { apply: true, batchSize: 10, limit: null },
      now: NOW,
      cacheVersion: "v1",
      cacheTtlDays: 30
    });
    expect(second).toMatchObject({ cacheEntriesToMerge: 1, peopleToInsert: 0 });
    expect(prisma._state.discoverCache).toHaveLength(1);
    expect(prisma._state.discoverCachePeople).toHaveLength(1);
  });

  it("skips manual/import-like, weak-identity, and expired history", async () => {
    const prisma = createFakePrisma();
    await seedHistoricalSearch(prisma, {
      userId: "manual_user",
      profileId: "manual-person",
      resultSource: null,
      apifyRunId: null,
      allocationSource: "BACKFILL"
    });
    prisma._state.searches[0].apifyDatasetId = null;
    await seedHistoricalSearch(prisma, {
      userId: "weak_user",
      profileId: "weak-person",
      domain: null,
      resultSource: "PROVIDER"
    });
    await seedHistoricalSearch(prisma, {
      userId: "expired_user",
      profileId: "expired-person",
      completedAt: new Date(NOW.getTime() - 31 * DAY_MS)
    });

    const stats = await runDiscoverLegacyCacheBackfill({
      store: store(prisma),
      options: { apply: true, batchSize: 2, limit: null },
      now: NOW,
      cacheVersion: "v1",
      cacheTtlDays: 30
    });

    expect(stats).toMatchObject({
      historicalSearchesScanned: 3,
      skippedNoProviderProvenance: 1,
      skippedNoStrongCompanyIdentity: 1,
      skippedExpired: 1,
      peopleToInsert: 0
    });
    expect(prisma._state.discoverCache).toHaveLength(0);
  });

  it("keeps similar company names separated by their strong domains", async () => {
    const prisma = createFakePrisma();
    await seedHistoricalSearch(prisma, {
      userId: "user_one",
      companyName: "Acme Inc.",
      domain: "acme.com",
      profileId: "acme-one"
    });
    await seedHistoricalSearch(prisma, {
      userId: "user_two",
      companyName: "Acme Inc.",
      domain: "acme.co",
      profileId: "acme-two"
    });

    await runDiscoverLegacyCacheBackfill({
      store: store(prisma),
      options: { apply: true, batchSize: 10, limit: null },
      now: NOW,
      cacheVersion: "v1",
      cacheTtlDays: 30
    });

    expect(prisma._state.discoverCache.map((entry) => entry.companyKey).sort()).toEqual([
      "domain:acme.co",
      "domain:acme.com"
    ]);
    expect(new Set(prisma._state.discoverCachePeople.map((person) => person.cacheId)).size).toBe(2);
  });

  it("merges a missing person without downgrading a newer existing shared entry", async () => {
    const prisma = createFakePrisma();
    const historical = await seedHistoricalSearch(prisma, { profileId: "historical-new-person" });
    const computed = computeDiscoverFingerprint({
      company: {
        officialWebsiteDomain: "apple.com",
        officialDomain: "apple.com",
        normalizedName: "apple"
      },
      roles: ["Software Engineer"],
      locations: ["United States"],
      resultLimit: 10,
      cacheVersion: "v1"
    });
    const newerFetchedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const newerExpiresAt = new Date(newerFetchedAt.getTime() + 30 * DAY_MS);
    const existing = await prisma.discoverSearchCache.upsert({
      where: { fingerprint: computed.fingerprint },
      create: {
        fingerprint: computed.fingerprint,
        cacheVersion: "v1",
        companyKey: "domain:apple.com",
        companyName: "Apple Inc.",
        companyDomain: "apple.com",
        companyLinkedinUrl: null,
        normalizedRoles: computed.input.roles,
        normalizedLocations: computed.input.locations,
        resultLimit: 10,
        status: "READY",
        fetchedAt: newerFetchedAt,
        expiresAt: newerExpiresAt,
        resultCount: 1,
        providerNextPage: 9,
        providerPagesFetched: 8,
        providerExhausted: true,
        lastProviderFetchAt: newerFetchedAt,
        emailDomain: "apple.com",
        emailDomainConfidence: "HIGH",
        emailPattern: "flast",
        patternConfidence: "HIGH",
        emailFormatDiscoveryStatus: "FOUND"
      },
      update: {}
    });
    await prisma.discoverSearchCachePerson.create({
      data: {
        cacheId: existing.id,
        sortIndex: 0,
        sourceProfileId: "already-shared",
        firstName: "Already",
        lastName: "Shared",
        fullName: "Already Shared",
        currentTitle: "Software Engineer",
        normalizedTitle: "software engineer",
        positionCategory: "SOFTWARE_ENGINEERING",
        location: "United States",
        country: "United States",
        state: null,
        city: null,
        linkedinUrl: "https://www.linkedin.com/in/already-shared",
        inferredEmail: null,
        emailStatus: "UNAVAILABLE",
        emailConfidence: "UNAVAILABLE",
        emailPattern: null,
        emailSource: null
      }
    });

    const stats = await runDiscoverLegacyCacheBackfill({
      store: store(prisma),
      options: { apply: true, batchSize: 10, limit: null },
      now: NOW,
      cacheVersion: "v1",
      cacheTtlDays: 30
    });

    expect(stats).toMatchObject({ cacheEntriesToMerge: 1, peopleToInsert: 1 });
    expect(prisma._state.discoverCachePeople.map((person) => person.sourceProfileId).sort()).toEqual([
      "already-shared",
      historical.person.sourceProfileId
    ]);
    expect(prisma._state.discoverCache[0]).toMatchObject({
      status: "READY",
      fetchedAt: newerFetchedAt,
      expiresAt: newerExpiresAt,
      providerNextPage: 9,
      providerPagesFetched: 8,
      providerExhausted: true,
      lastProviderFetchAt: newerFetchedAt,
      emailDomain: "apple.com",
      emailDomainConfidence: "HIGH",
      emailPattern: "flast",
      patternConfidence: "HIGH",
      emailFormatDiscoveryStatus: "FOUND",
      resultCount: 2
    });
  });
});
