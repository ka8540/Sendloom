import { companyNamesAliasMatch, type NormalizedProfile } from './apify-profile-search';
import { resultText, positionEvidence } from './linkedin-search-result-parser';
import type { WebSearchResult } from './web-search-provider';
export type CurrentEmploymentEvidence = {
  decision: 'CURRENT' | 'FORMER' | 'CONTRADICTORY' | 'INSUFFICIENT'; confidence: number;
  reason: 'CURRENT_HEADLINE' | 'HISTORICAL_EMPLOYMENT' | 'COMPANY_MISMATCH' | 'INSUFFICIENT_EVIDENCE';
};
/** Negative evidence wins even over a stale positive headline. Query words are never inspected. */
export function validateCurrentEmployment(result: WebSearchResult, profile: NormalizedProfile, companyName: string): CurrentEmploymentEvidence {
  const clauses = resultText(`${result.title} · ${result.snippet ?? ''}`).split(/[·|;]/);
  for (const clause of clauses) {
    const historical = /\b(?:former(?:ly)?|previously|worked|past|left|retired|no longer)\b\s*(?::|at|with|from)?\s*(.*)/i.exec(clause)
      ?? /\bex[-\s]+(.*)/i.exec(clause);
    const dated = /(.+?)\s+[(\[]?(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/i.exec(clause)
      ?? /(.+?)\s+(?:until|through)\s+(?:19|20)\d{2}\b/i.exec(clause)
      ?? /(.+?)\s+alumni?\b/i.exec(clause);
    const employer = (historical?.[1] ?? dated?.[1])?.split(/\s+(?:at|with|from)\s+|\s+[-–—]\s+/i).pop();
    if (employer && companyNamesAliasMatch(employer.trim(), companyName)) {
      return { decision: 'FORMER', confidence: 1, reason: 'HISTORICAL_EMPLOYMENT' };
    }
  }
  const snippetPosition = positionEvidence(resultText(result.snippet ?? '').split(/\s*[·|]\s*/)[0]);
  if (snippetPosition && !companyNamesAliasMatch(snippetPosition.company, companyName))
    return { decision: 'CONTRADICTORY', confidence: 0, reason: 'COMPANY_MISMATCH' };
  if (!profile.currentTitle || !profile.currentCompanyName || /\b(former|previous|ex-|worked|past|seeking|aspiring|interested|opportunities|internship applicant)\b/i.test(profile.currentTitle))
    return { decision: 'INSUFFICIENT', confidence: 0, reason: 'INSUFFICIENT_EVIDENCE' };
  if (!companyNamesAliasMatch(profile.currentCompanyName, companyName))
    return { decision: 'CONTRADICTORY', confidence: 0, reason: 'COMPANY_MISMATCH' };
  return { decision: 'CURRENT', confidence: 0.95, reason: 'CURRENT_HEADLINE' };
}
