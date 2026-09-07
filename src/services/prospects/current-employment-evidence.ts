import { companyNamesAliasMatch, type NormalizedProfile } from './apify-profile-search';
import { resultText, positionEvidence, snippetPositionEvidence, EMPLOYMENT_TYPE_SEGMENT,
  CONNECTIONS_SEGMENT, locationLike, COUNTRY_ONLY } from './linkedin-search-result-parser';
import type { WebSearchResult } from './web-search-provider';
export type CurrentEmploymentEvidence = {
  decision: 'CURRENT' | 'FORMER' | 'CONTRADICTORY' | 'INSUFFICIENT'; confidence: number;
  reason: 'CURRENT_HEADLINE' | 'HISTORICAL_EMPLOYMENT' | 'COMPANY_MISMATCH' | 'INSUFFICIENT_EVIDENCE' | 'ASSOCIATION_SNIPPET';
};

/**
 * A Google/LinkedIn SERP result often exposes a current-looking job only as a
 * keyword association ("Software Engineer · Experience: Datadog", or a headline
 * role adjacent to the company), without "Present"/"Currently". Rejecting those
 * as INSUFFICIENT destroys yield. We therefore promote INSUFFICIENT to CURRENT
 * only when the raw result carries BOTH a role and the requested company in
 * current-looking association. Company-history labels ("Experience:"), connection
 * counts, locations, and employment-type words are not roles; the title/sniplet
 * text is never trusted when FORMER or CONTRADICTORY evidence fired first.
 */
export function strongCurrentAssociation(result: WebSearchResult, companyName: string): boolean {
  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, '');
  const headline = /^.+?\s+(?:[-–—]|\|)\s+(.+)$/.exec(title)?.[1]?.trim() ?? '';
  const snippet = resultText(result.snippet ?? '');
  // 1. Headline explicitly says "<role> at <company>" (the requested company).
  const titlePosition = positionEvidence(headline);
  if (titlePosition?.title && companyNamesAliasMatch(titlePosition.company, companyName)) return true;
  // 2. Snippet pairs a usable role with the company ("Software Engineer · Datadog").
  const snippetPosition = snippetPositionEvidence(snippet);
  if (snippetPosition?.title && companyNamesAliasMatch(snippetPosition.company, companyName)) return true;
  // 3. A role and the requested company co-occurring in one result card
  //    ("Software Engineer · Experience: Datadog", "Optiver · Full-time · Software
  //    Engineer"). Sections, locations, employment types and the company itself
  //    are never roles. Precision stays with the existing role-validation stage.
  const sections = snippet.split(/\s*(?:[·|]|\.(?=\s|$))/).map(s => s.trim()).filter(Boolean);
  const stripped = sections.map(section => section.replace(/^[a-z]+:\s*/i, '').trim());
  const companyMentioned = stripped.some(part => part.length > 1 && companyNamesAliasMatch(part, companyName));
  if (!companyMentioned) return false;
  const role = titlePosition?.title
    ?? (companyNamesAliasMatch(headline, companyName) ? null : headline)
    ?? sections.find((section, index) => {
      const part = stripped[index];
      return part.length > 1 && /\p{L}/u.test(part)
        && !/^(?:experience|education|location|skills|activity|about|summary|view)\b/i.test(section)
        && !companyNamesAliasMatch(part, companyName)
        && !EMPLOYMENT_TYPE_SEGMENT.test(part)
        && !CONNECTIONS_SEGMENT.test(part)
        && !COUNTRY_ONLY.test(part)
        && !locationLike(part);
    });
  return typeof role === 'string' && role.length > 2
    && !/\b(former|previous|ex-|worked|past|seeking|aspiring|interested|opportunities)\b/i.test(role);
}
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
  if (!profile.currentTitle || !profile.currentCompanyName || /\b(former|previous|ex-|worked|past|seeking|aspiring|interested|opportunities|internship applicant)\b/i.test(profile.currentTitle)) {
    // No structured current position parsed, but a strong current-looking
    // role+company association in the raw result still qualifies (SERP snippets
    // rarely say "Present"). Unrelated snippets stay INSUFFICIENT.
    return strongCurrentAssociation(result, companyName)
      ? { decision: 'CURRENT', confidence: 0.8, reason: 'ASSOCIATION_SNIPPET' }
      : { decision: 'INSUFFICIENT', confidence: 0, reason: 'INSUFFICIENT_EVIDENCE' };
  }
  if (!companyNamesAliasMatch(profile.currentCompanyName, companyName))
    return { decision: 'CONTRADICTORY', confidence: 0, reason: 'COMPANY_MISMATCH' };
  return { decision: 'CURRENT', confidence: 0.95, reason: 'CURRENT_HEADLINE' };
}
