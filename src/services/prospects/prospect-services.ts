import type { PrismaClient } from "@prisma/client";

import { ApifyProfileSearchService } from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { CompositeEmailEvidenceProvider, EmailDomainService } from "@/services/prospects/email-domain-service";
import { EmailFormatDiscoveryService } from "@/services/prospects/email-format-discovery-service";
import { OpenAIEmailFormatDiscoveryService } from "@/services/prospects/openai-email-format-discovery";
import { OpenAiProspectClient, type AiClient } from "@/services/prospects/prospect-ai";
import { ProspectSearchService } from "@/services/prospects/prospect-search-service";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";

export type ProspectServices = {
  prospectSearch: ProspectSearchService;
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
  // Primary email-format evidence comes from GPT web search; the deterministic
  // source-URL parser remains as the manual/paste fallback.
  const emailEvidence = new CompositeEmailEvidenceProvider([
    new OpenAIEmailFormatDiscoveryService(),
    new EmailFormatDiscoveryService()
  ]);
  const emailDomain = new EmailDomainService(prisma, ai, emailEvidence);

  const prospectSearch = new ProspectSearchService({
    prisma,
    apify,
    companyResolution,
    roleClassifier,
    emailDomain
  });

  return { prospectSearch, companyResolution, roleClassifier, emailDomain };
}
