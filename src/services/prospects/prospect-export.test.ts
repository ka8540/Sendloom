import { read, utils } from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { createFakePrisma, type FakePrisma } from "@/services/prospects/__test-utils__/fake-prisma";
import {
  PROSPECT_EXPORT_HEADERS,
  buildProspectExportWorkbook,
  createProspectImport,
  resolveProspectSelection
} from "@/services/prospects/prospect-export";

vi.mock("@/services/imports", () => ({
  createImport: vi.fn(
    async (
      fileName: string,
      fileType: string,
      content: Buffer,
      userId: string,
      options: { pendingFieldSelection?: boolean } = {}
    ) => ({
      id: "import_1",
      fileName,
      fileType,
      storagePath: `users/${userId}/imports/import_1/${fileName}`,
      status: options.pendingFieldSelection ? "UPLOADING" : "PROCESSED",
      rowCount: read(content, { type: "buffer" }).Sheets.Prospects ? 1 : 0,
      columns: []
    })
  )
}));

function makePrisma() {
  // FakePrisma now ships a real user-scoped suppression model (used by the
  // Discover delivery-failure overlay); seed rows through its shared state.
  const prisma = createFakePrisma();
  return { prisma, suppressions: prisma._state.suppressions };
}

function seedCompany(prisma: FakePrisma) {
  prisma._state.companies.push({
    id: "company_1",
    userId: "user_1",
    name: "Esri",
    normalizedName: "esri",
    officialDomain: "esri.com",
    officialWebsiteDomain: "esri.com",
    officialWebsite: "https://www.esri.com",
    linkedinUrl: null,
    domainConfidence: "HIGH",
    emailDomain: "esri.com",
    emailDomainConfidence: "HIGH",
    emailPattern: "first.last",
    patternConfidence: "HIGH",
    createdAt: new Date(),
    updatedAt: new Date()
  });
  prisma._state.positions.push(
    {
      id: "pos_eng",
      companyId: "company_1",
      category: "SOFTWARE_ENGINEERING",
      displayName: "Software Engineering",
      rawTitles: ["Software Engineer"],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: "pos_hr",
      companyId: "company_1",
      category: "HUMAN_RESOURCES",
      displayName: "Human Resources",
      rawTitles: ["Recruiter"],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  );
}

function seedPerson(prisma: FakePrisma, overrides: Record<string, unknown>) {
  const id = String(overrides.id ?? `person_${prisma._state.people.length + 1}`);
  prisma._state.people.push({
    id,
    userId: "user_1",
    companyId: "company_1",
    positionId: "pos_eng",
    sourceProfileId: `source_${id}`,
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    currentTitle: "Software Engineer",
    normalizedTitle: "software engineer",
    location: "London, United Kingdom",
    country: "United Kingdom",
    state: null,
    city: "London",
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    inferredEmail: `${id}@esri.com`,
    emailStatus: "INFERRED_HIGH",
    emailConfidence: "HIGH",
    emailPattern: "first.last",
    emailSource: "PATTERN",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
}

function seedLocationSearch(prisma: FakePrisma, id: string, location: string, personIds: string[]) {
  prisma._state.searches.push({
    id,
    userId: "user_1",
    companyId: "company_1",
    requestedCompany: "Esri",
    requestedTitles: ["Software Engineer"],
    requestedLocations: [location],
    maxResults: 10,
    status: "READY",
    totalProcessed: personIds.length,
    totalFound: personIds.length,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  personIds.forEach((personId, index) => {
    prisma._state.searchPeople.push({
      id: `${id}_allocation_${index}`,
      searchId: id,
      personId
    });
  });
}

function seedFilteredSelectionGraph(prisma: FakePrisma) {
  seedCompany(prisma);
  seedPerson(prisma, {
    id: "india_ai_engineer",
    positionId: "pos_eng",
    fullName: "Aisha Rao",
    firstName: "Aisha",
    lastName: "Rao",
    currentTitle: "AI Platform Engineer",
    normalizedTitle: "ai platform engineer",
    location: "Bengaluru, India",
    city: "Bengaluru",
    country: "India"
  });
  seedPerson(prisma, {
    id: "india_backend_engineer",
    positionId: "pos_eng",
    fullName: "Dev Patel",
    firstName: "Dev",
    lastName: "Patel",
    currentTitle: "Backend Engineer",
    normalizedTitle: "backend engineer",
    location: "Pune, India",
    city: "Pune",
    country: "India"
  });
  seedPerson(prisma, {
    id: "india_recruiter",
    positionId: "pos_hr",
    fullName: "Mira Shah",
    firstName: "Mira",
    lastName: "Shah",
    currentTitle: "AI Recruiter",
    normalizedTitle: "ai recruiter",
    location: "Mumbai, India",
    city: "Mumbai",
    country: "India"
  });
  seedPerson(prisma, {
    id: "us_ai_engineer",
    positionId: "pos_eng",
    fullName: "Sam Rivera",
    firstName: "Sam",
    lastName: "Rivera",
    currentTitle: "AI Engineer",
    normalizedTitle: "ai engineer",
    location: "Austin, United States",
    city: "Austin",
    country: "United States"
  });
  seedLocationSearch(prisma, "search_india", "India", [
    "india_ai_engineer",
    "india_backend_engineer",
    "india_recruiter"
  ]);
  seedLocationSearch(prisma, "search_us", "United States", ["us_ai_engineer"]);
}

describe("prospect export selection resolution", () => {
  it("exports only selected owned prospects in the selected company", async () => {
    const { prisma } = makePrisma();
    seedCompany(prisma);
    seedPerson(prisma, { id: "person_1" });
    seedPerson(prisma, { id: "person_other_user", userId: "user_2" });

    await expect(
      resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
        companyId: "company_1",
        mode: "EXPLICIT",
        selectedIds: ["person_1", "person_other_user"]
      })
    ).rejects.toThrow(/selected prospects/i);

    const resolved = await resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "EXPLICIT",
      selectedIds: ["person_1"]
    });
    expect(resolved.review).toMatchObject({ selectedCount: 1, exportableCount: 1 });
    expect(resolved.rows[0]).toMatchObject({ email: "person_1@esri.com", company: "Esri" });
  });

  it("ALL_MATCHING respects the category and excluded IDs", async () => {
    const { prisma } = makePrisma();
    seedCompany(prisma);
    seedPerson(prisma, { id: "eng_1", positionId: "pos_eng" });
    seedPerson(prisma, { id: "eng_2", positionId: "pos_eng" });
    seedPerson(prisma, { id: "hr_1", positionId: "pos_hr" });

    const resolved = await resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "ALL_MATCHING",
      positionCategory: "SOFTWARE_ENGINEERING",
      excludedIds: ["eng_2"]
    });

    expect(resolved.review).toMatchObject({ selectedCount: 1, exportableCount: 1 });
    expect(resolved.rows.map((row) => row.email)).toEqual(["eng_1@esri.com"]);
  });

  it.each([
    {
      name: "India location",
      input: { location: " India " },
      expected: ["india_ai_engineer@esri.com", "india_backend_engineer@esri.com", "india_recruiter@esri.com"]
    },
    {
      name: "another location",
      input: { location: "United States" },
      expected: ["us_ai_engineer@esri.com"]
    },
    {
      name: "text search",
      input: { search: "AI" },
      expected: ["india_ai_engineer@esri.com", "india_recruiter@esri.com", "us_ai_engineer@esri.com"]
    },
    {
      name: "role and location",
      input: { positionCategory: "SOFTWARE_ENGINEERING" as const, location: "India" },
      expected: ["india_ai_engineer@esri.com", "india_backend_engineer@esri.com"]
    },
    {
      name: "role, location, and text search",
      input: { positionCategory: "SOFTWARE_ENGINEERING" as const, location: "India", search: "AI" },
      expected: ["india_ai_engineer@esri.com"]
    }
  ])("ALL_MATCHING resolves the same People result set for $name", async ({ input, expected }) => {
    const { prisma } = makePrisma();
    seedFilteredSelectionGraph(prisma);

    const resolved = await resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "ALL_MATCHING",
      ...input
    });

    expect(resolved.review.selectedCount).toBe(expected.length);
    expect(resolved.rows.map((row) => row.email).sort()).toEqual([...expected].sort());
  });

  it("applies excluded IDs inside a role + location + search ALL_MATCHING scope", async () => {
    const { prisma } = makePrisma();
    seedFilteredSelectionGraph(prisma);

    const resolved = await resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "ALL_MATCHING",
      positionCategory: "SOFTWARE_ENGINEERING",
      location: "India",
      search: "Engineer",
      excludedIds: ["india_ai_engineer"]
    });

    expect(resolved.review.selectedCount).toBe(1);
    expect(resolved.rows.map((row) => row.email)).toEqual(["india_backend_engineer@esri.com"]);
  });

  it("repairs stale unavailable rows while skipping suppressed, invalid, and duplicate emails", async () => {
    const { prisma, suppressions } = makePrisma();
    seedCompany(prisma);
    seedPerson(prisma, { id: "ok", inferredEmail: "ok@esri.com" });
    seedPerson(prisma, { id: "dup", inferredEmail: "OK@ESRI.COM" });
    seedPerson(prisma, { id: "unavailable", inferredEmail: null, emailStatus: "UNAVAILABLE" });
    seedPerson(prisma, { id: "invalid", inferredEmail: "invalid@esri.com", emailStatus: "INVALID" });
    seedPerson(prisma, { id: "suppressed_status", inferredEmail: "blocked@esri.com", emailStatus: "SUPPRESSED" });
    seedPerson(prisma, { id: "suppressed_table", inferredEmail: "table@esri.com" });
    suppressions.push({ userId: "user_1", email: "table@esri.com" });

    const resolved = await resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "ALL_MATCHING"
    });

    expect(resolved.review).toMatchObject({
      selectedCount: 6,
      exportableCount: 2,
      unavailableEmailCount: 1,
      suppressedCount: 2,
      duplicateEmailCount: 1
    });
    expect(resolved.rows.map((row) => row.email)).toEqual(["ok@esri.com", "ada.lovelace@esri.com"]);
  });

  it("uses the canonical company format for stale recruiter exports", async () => {
    const { prisma } = makePrisma();
    seedCompany(prisma);
    seedPerson(prisma, {
      id: "christy",
      positionId: "pos_hr",
      firstName: "Christy",
      lastName: "Stouffer",
      fullName: "Christy Stouffer",
      inferredEmail: null,
      emailStatus: "UNAVAILABLE",
      emailConfidence: "UNAVAILABLE",
      emailPattern: null,
      emailSource: null
    });

    const resolved = await resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "ALL_MATCHING",
      positionCategory: "HUMAN_RESOURCES"
    });

    expect(resolved.rows[0]?.email).toBe("christy.stouffer@esri.com");
    expect(resolved.rows[0]?.emailStatus).toBe("INFERRED_HIGH");
  });

  it("enforces the 5000-row export maximum", async () => {
    const { prisma } = makePrisma();
    seedCompany(prisma);
    for (let index = 0; index < 5001; index += 1) {
      seedPerson(prisma, { id: `p_${index}`, inferredEmail: `p_${index}@esri.com` });
    }

    await expect(
      resolveProspectSelection(prisma as unknown as PrismaClient, "user_1", {
        companyId: "company_1",
        mode: "ALL_MATCHING"
      })
    ).rejects.toThrow(/5,000/);
  });
});

describe("prospect export workbook", () => {
  it("contains the expected headers and no internal IDs", () => {
    const workbook = read(
      buildProspectExportWorkbook([
        {
          firstName: "Ada",
          lastName: "Lovelace",
          fullName: "Ada Lovelace",
          email: "ada@esri.com",
          jobTitle: "Engineer",
          positionCategory: "Software Engineering",
          company: "Esri",
          location: "London",
          linkedinUrl: "https://linkedin.com/in/ada",
          emailStatus: "INFERRED_HIGH",
          emailConfidence: "HIGH",
          emailPattern: "first.last",
          emailSource: "PATTERN"
        }
      ]),
      { type: "buffer", cellFormula: true }
    );
    const rows = utils.sheet_to_json<string[]>(workbook.Sheets.Prospects, { header: 1 });
    expect(rows[0]).toEqual([...PROSPECT_EXPORT_HEADERS]);
    expect(JSON.stringify(rows)).not.toMatch(/userId|database|sourceProfileId|apify/i);
  });

  it("prevents formula injection in exported strings", () => {
    const workbook = read(
      buildProspectExportWorkbook([
        {
          firstName: "=cmd",
          lastName: "+last",
          fullName: "-full",
          email: "@mail.example",
          jobTitle: "Engineer",
          positionCategory: "Software Engineering",
          company: "Esri",
          location: "London",
          linkedinUrl: "https://linkedin.com/in/test",
          emailStatus: "INFERRED_HIGH",
          emailConfidence: "HIGH",
          emailPattern: "first.last",
          emailSource: "PATTERN"
        }
      ]),
      { type: "buffer", cellFormula: true }
    );
    const sheet = workbook.Sheets.Prospects;
    expect(sheet.A2.f).toBeUndefined();
    expect(sheet.A2.v).toBe("'=cmd");
    expect(sheet.B2.v).toBe("'+last");
    expect(sheet.C2.v).toBe("'-full");
    expect(sheet.D2.v).toBe("'@mail.example");
  });
});

describe("prospect import creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stages exactly one pending import, reuses the import service, and creates no sequence", async () => {
    const imports = await import("@/services/imports");
    const { prisma } = makePrisma();
    seedCompany(prisma);
    seedPerson(prisma, { id: "person_1" });

    const result = await createProspectImport(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "EXPLICIT",
      selectedIds: ["person_1"]
    });

    // Exactly one import record, staged as pending field selection.
    expect(imports.createImport).toHaveBeenCalledTimes(1);
    expect(imports.createImport).toHaveBeenCalledWith(
      expect.stringMatching(/sendloom-esri-all-prospects-\d{4}-\d{2}-\d{2}\.xlsx/),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      expect.any(Buffer),
      "user_1",
      { pendingFieldSelection: true }
    );
    expect(result).toMatchObject({ importId: "import_1", rowCount: 1 });
    // The user is routed to the Imports page with the pending import preselected.
    expect(result.viewUrl).toContain("/imports?pendingImportId=import_1");
    // No sequence is created as part of adding to imports.
    expect((prisma._state as Record<string, unknown>).campaigns).toBeUndefined();
  });

  it("stages only the current filtered ALL_MATCHING scope", async () => {
    const imports = await import("@/services/imports");
    const { prisma } = makePrisma();
    seedFilteredSelectionGraph(prisma);

    const result = await createProspectImport(prisma as unknown as PrismaClient, "user_1", {
      companyId: "company_1",
      mode: "ALL_MATCHING",
      positionCategory: "SOFTWARE_ENGINEERING",
      location: "India",
      search: "AI"
    });

    expect(result.review.selectedCount).toBe(1);
    const content = vi.mocked(imports.createImport).mock.calls[0]?.[2];
    const workbook = read(content, { type: "buffer" });
    const rows = utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Prospects);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Email).toBe("india_ai_engineer@esri.com");
  });
});
