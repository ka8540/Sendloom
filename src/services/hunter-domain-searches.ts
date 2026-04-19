import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { normalizeHunterDomain, type HunterResultRow } from "@/lib/hunter";

const hunterResultRowSchema = z.object({
  email: z.string(),
  name: z.string(),
  position: z.string().nullable(),
  confidence: z.number().nullable(),
  source: z.string()
});

const hunterDomainSearchResultsSchema = z.array(hunterResultRowSchema);

export type HunterDomainSearchSummary = {
  id: string;
  domain: string;
  resultCount: number;
  updatedAt: string;
};

export type HunterDomainSearchDetail = HunterDomainSearchSummary & {
  results: HunterResultRow[];
};

function parseHunterDomainSearchResults(value: Prisma.JsonValue) {
  const parsed = hunterDomainSearchResultsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function isMissingHunterDomainSearchTableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021" &&
    typeof error.meta?.table === "string" &&
    error.meta.table.includes("HunterDomainSearch")
  );
}

function toHunterDomainSearchSummary(entry: {
  id: string;
  domain: string;
  resultCount: number;
  updatedAt: Date;
}): HunterDomainSearchSummary {
  return {
    id: entry.id,
    domain: entry.domain,
    resultCount: entry.resultCount,
    updatedAt: entry.updatedAt.toISOString()
  };
}

function toHunterDomainSearchDetail(entry: {
  id: string;
  domain: string;
  resultCount: number;
  updatedAt: Date;
  results: Prisma.JsonValue;
}): HunterDomainSearchDetail {
  return {
    ...toHunterDomainSearchSummary(entry),
    results: parseHunterDomainSearchResults(entry.results)
  };
}

export async function listHunterDomainSearchesForUser(userId: string, limit = 25) {
  try {
    const searches = await prisma.hunterDomainSearch.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        domain: true,
        resultCount: true,
        updatedAt: true
      }
    });

    return searches.map(toHunterDomainSearchSummary);
  } catch (error) {
    if (isMissingHunterDomainSearchTableError(error)) {
      return [];
    }

    throw error;
  }
}

export async function getHunterDomainSearchForUser(userId: string, searchId: string) {
  try {
    const search = await prisma.hunterDomainSearch.findFirst({
      where: {
        id: searchId,
        userId
      },
      select: {
        id: true,
        domain: true,
        resultCount: true,
        updatedAt: true,
        results: true
      }
    });

    if (!search) {
      return null;
    }

    return toHunterDomainSearchDetail(search);
  } catch (error) {
    if (isMissingHunterDomainSearchTableError(error)) {
      return null;
    }

    throw error;
  }
}

export async function saveHunterDomainSearchForUser(userId: string, domain: string, results: HunterResultRow[]) {
  const normalizedDomain = normalizeHunterDomain(domain);
  try {
    const savedSearch = await prisma.hunterDomainSearch.upsert({
      where: {
        userId_domain: {
          userId,
          domain: normalizedDomain
        }
      },
      update: {
        resultCount: results.length,
        results: results as unknown as Prisma.InputJsonValue
      },
      create: {
        userId,
        domain: normalizedDomain,
        resultCount: results.length,
        results: results as unknown as Prisma.InputJsonValue
      },
      select: {
        id: true,
        domain: true,
        resultCount: true,
        updatedAt: true
      }
    });

    return toHunterDomainSearchSummary(savedSearch);
  } catch (error) {
    if (isMissingHunterDomainSearchTableError(error)) {
      return null;
    }

    throw error;
  }
}
