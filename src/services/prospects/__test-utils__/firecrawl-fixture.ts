import type { PrismaClient } from "@prisma/client";
import { vi } from "vitest";

import { ApifyProfileSearchService } from "../apify-profile-search";
import type { BrightProfileSearchProvider } from "../brightdata-public-profile-search";
import { DiscoverPeopleProviderOrchestrator } from "../discover-people-provider-orchestrator";
import { DiscoverRoleIntelligenceService } from "../discover-role-intelligence-service";
import { FirecrawlPublicProfileSearchService } from "../firecrawl-public-profile-search";
import { FirecrawlSearchProvider } from "../firecrawl-search-provider";
import { RoleClassificationService } from "../role-classification-service";
import type { TavilyProfileSearchProvider } from "../tavily-public-profile-search";
import { emptyPublicProfileDiagnostics } from "../public-profile-search-metadata";
import type { FakePrisma } from "./fake-prisma";
import { createMockAi } from "./mock-ai";

export function firecrawlRow(id: string, companyName = "Apple", title = "Software Engineer", location = "United States") {
  return { url: `https://www.linkedin.com/in/${id}`, title: `Jane Doe - ${title} at ${companyName} | LinkedIn`, description: location, position: 1 };
}

export function firecrawlFixture(prisma: FakePrisma, options: {
  pages?: unknown[]; tavilyPerAction?: number; perAction?: number; maxQueries?: number; plan?: string[];
  tavily?: TavilyProfileSearchProvider; bright?: BrightProfileSearchProvider;
} = {}) {
  let page = 0;
  const fetcher = vi.fn(async () => {
    const value = options.pages?.[page++] ?? [];
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    return Response.json({ success: true, data: { web: value }, creditsUsed: 2 });
  });
  const firecrawl = new FirecrawlPublicProfileSearchService(new FirecrawlSearchProvider({ enabled: true, apiKey: "test-firecrawl-key", fetcher: fetcher as typeof fetch }));
  const tavily = options.tavily ?? { configured: true, searchProfiles: vi.fn(async () => ({ profiles: [], diagnostics: { ...emptyPublicProfileDiagnostics(), rawTavilyResults: 0, creditsUsed: 0 } })) };
  const bright = options.bright ?? { configured: false, searchProfiles: vi.fn(async () => { throw new Error("Unexpected Bright call"); }) };
  const runner = { run: vi.fn(async () => ({ runId: null, datasetId: null, items: [] })) };
  const apify = new ApifyProfileSearchService({ token: "test", runner });
  const roleClassifier = new RoleClassificationService(prisma as unknown as PrismaClient, createMockAi({ enabled: false }).client);
  const roleIntelligence = new DiscoverRoleIntelligenceService(roleClassifier, {
    enabled: false, embedTitles: async () => { throw new Error("Unavailable embeddings"); }
  } as never, {} as never, { enabled: false, embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536, semanticVersion: "v1", maxApifyTitlesPerRole: 5, maxApifyTitlesTotal: 8 });
  vi.spyOn(roleIntelligence, "buildProviderTitlePlan").mockResolvedValue(options.plan ?? ["Software Engineer", "Software Developer", "Backend Engineer", "Full Stack Engineer", "Systems Engineer"]);
  const orchestrator = new DiscoverPeopleProviderOrchestrator({
    firecrawl, tavily, bright, apify, roleClassifier, roleIntelligence,
    tavilyMaxQueries: 5, tavilyMaxQueriesPerAction: options.tavilyPerAction ?? 5,
    firecrawlMaxQueries: options.maxQueries ?? 5, firecrawlMaxQueriesPerAction: options.perAction ?? 2
  });
  return { orchestrator, fetcher, firecrawl, tavily, bright, apify, runner, roleClassifier, roleIntelligence };
}
