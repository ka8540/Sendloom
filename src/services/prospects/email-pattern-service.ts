// Backward-compatible module path. Prospect email inference now lives in the
// evidence-first email-domain service because the employee email domain and the
// local-part pattern must be selected together.
export {
  EmailDomainService as EmailPatternService,
  buildEmailFormatSearchQueries,
  inferPatternFromEmailSample
} from "@/services/prospects/email-domain-service";
export type {
  CompanyEmailInferenceResult as EmailPatternResult,
  EmailDomainEvidence,
  EmailEvidenceBundle as EmailPatternEvidenceSource,
  EmailPatternEvidence,
  InferCompanyEmailInput as InferEmailPatternInput
} from "@/services/prospects/email-domain-service";
