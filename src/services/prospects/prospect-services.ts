import type { PrismaClient } from "@prisma/client";

import { recordAuditEvent } from "@/lib/audit";
import { createDiscoverSearchCompletedNotification } from "@/lib/notifications";
import { ApifyProfileSearchService } from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { DiscoverExpansionService } from "@/services/prospects/discover-expansion-service";
import { DiscoverPublicKnowledgeService } from "@/services/prospects/discover-public-knowledge-service";
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
  const discoverKnowledge = new DiscoverPublicKnowledgeService({ prisma });
  const roleIntelligence = createDiscoverRoleIntelligenceService(prisma, roleClassifier);

  const prospectSearch = new ProspectSearchService({
    prisma,
    apify,
    companyResolution,
    roleClassifier,
    roleIntelligence,
    emailDomain,
    discoverCache: discoverKnowledge,
    // Safe, best-effort retry/processing audit trail (server-side only).
    audit: recordAuditEvent,
    notifyCompleted: async (searchId) => {
      await createDiscoverSearchCompletedNotification(searchId, prisma);
    }
  });

  // Initial and expansion flows share one durable provider-ingestion choke
  // point. Redis accelerates it; Postgres remains authoritative.
  const discoverExpansion = new DiscoverExpansionService({
    prisma,
    apify,
    roleClassifier,
    roleIntelligence,
    cache: discoverKnowledge
  });

  return { prospectSearch, discoverExpansion, companyResolution, roleClassifier, emailDomain };
}
