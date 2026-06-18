import type { PrismaClient } from "@prisma/client";

import { ApifyProfileSearchService } from "@/services/prospects/apify-profile-search";
import { CompanyResolutionService } from "@/services/prospects/company-resolution-service";
import { EmailPatternService } from "@/services/prospects/email-pattern-service";
import { OpenAiProspectClient, type AiClient } from "@/services/prospects/prospect-ai";
import { ProspectSearchService } from "@/services/prospects/prospect-search-service";
import { RoleClassificationService } from "@/services/prospects/role-classification-service";

export type ProspectServices = {
  prospectSearch: ProspectSearchService;
  companyResolution: CompanyResolutionService;
  roleClassifier: RoleClassificationService;
  emailPattern: EmailPatternService;
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
  const emailPattern = new EmailPatternService(ai);

  const prospectSearch = new ProspectSearchService({
    prisma,
    apify,
    companyResolution,
    roleClassifier,
    emailPattern
  });

  return { prospectSearch, companyResolution, roleClassifier, emailPattern };
}
