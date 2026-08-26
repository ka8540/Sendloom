import type { PrismaClient } from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { createDiscoverSearchCompletedNotification } from "@/lib/notifications";
import { ApifyProfileSearchService } from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { DiscoverSearchCacheService } from "@/services/prospects/discover-cache-service";
import { DiscoverExpansionService } from "@/services/prospects/discover-expansion-service";
import { createDiscoverRoleIntelligenceService } from "@/services/prospects/discover-role-intelligence-service";
import { CompositeEmailEvidenceProvider, EmailDomainService } from "@/services/prospects/email-domain-service";
import { EmailFormatDiscoveryService } from "@/services/prospects/email-format-discovery-service";
import { OpenAIEmailFormatDiscoveryService } from "@/services/prospects/openai-email-format-discovery";
import { OpenAiProspectClient, type AiClient } from "@/services/prospects/prospect-ai";
import { ProspectSearchService } from "@/services/prospects/prospect-search-service";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";

export type ProspectServices = {
  prospectSearch: ProspectSearchService;
  discoverExpansion: DiscoverExpansionService;
  companyResolution: CompanyResolutionService;
  roleClassifier: RoleClassificationService;
  emailDomain: EmailDomainService;
};

/**
 * Build the prospect service graph with real provider implementations. Tests
 * construct the individual services directly with mock dependencies instead.
 */
export function createProspectServices(prisma: PrismaClient, aiClient?: AiClient): ProspectServices {
  const ai = aiClient ?? new OpenAiProspectClient();
  const apify = new ApifyProfileSearchService();
  const companyResolution = new CompanyResolutionService(ai);
  const roleClassifier = new RoleClassificationService(prisma, ai);
  // Parse deterministic public/source-URL evidence first. AI web search is the
  // fallback only when those structured claims cannot select a format safely.
  const emailEvidence = new CompositeEmailEvidenceProvider([
    new EmailFormatDiscoveryService({ warnWhenUnconfigured: false }),
    new OpenAIEmailFormatDiscoveryService()
  ]);
  const emailDomain = new EmailDomainService(prisma, ai, emailEvidence);
  const discoverCache = new DiscoverSearchCacheService({ prisma });
  const roleIntelligence = createDiscoverRoleIntelligenceService(prisma, roleClassifier);

  const prospectSearch = new ProspectSearchService({
    prisma,
    apify,
    companyResolution,
    roleClassifier,
    roleIntelligence,
    emailDomain,
    discoverCache,
    // Safe, best-effort retry/processing audit trail (server-side only).
    audit: recordAuditEvent,
    notifyCompleted: async (searchId) => {
      await createDiscoverSearchCompletedNotification(searchId, prisma);
    }
  });

  // "Add 10 more" reuses the same Apify + role classifier + shared cache (which
  // also supplies provider continuation state) and the same daily quota service.
  const discoverExpansion = new DiscoverExpansionService({
    prisma,
    apify,
    roleClassifier,
    roleIntelligence,
    cache: discoverCache
  });

  return { prospectSearch, discoverExpansion, companyResolution, roleClassifier, emailDomain };
}
