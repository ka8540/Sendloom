import { companyNamesAliasMatch, type NormalizedProfile } from './apify-profile-search';
import { publicPoolRoleMatches } from './public-pool-eligibility';
import {
  CONNECTIONS_SEGMENT,
  COUNTRY_ONLY,
  EMPLOYMENT_TYPE_SEGMENT,
  locationLike,
  positionEvidenceDetails,
  resultText
} from './linkedin-search-result-parser';
import type { WebSearchResult } from './web-search-provider';

export type EmploymentDecision = 'CURRENT' | 'FORMER' | 'CONTRADICTORY' | 'INSUFFICIENT';
export type EmploymentReason =
  | 'CURRENT_HEADLINE_AT_COMPANY'
  | 'CURRENT_HEADLINE_AT_SIGN'
  | 'CURRENT_ROLE_COMPANY_ASSOCIATION'
  | 'CURRENT_SNIPPET_ASSOCIATION'
  | 'FORMER_REQUESTED_COMPANY'
  | 'EXPLICIT_OTHER_CURRENT_EMPLOYER'
  | 'INSUFFICIENT_COMPANY_EVIDENCE'
  | 'INVALID_CONTRADICTORY_COMPANY_FRAGMENT';

export type EmploymentSignal = {
  source: 'TITLE' | 'SNIPPET' | 'STRUCTURED';
  kind: 'AT' | 'AT_SIGN' | 'SEPARATOR' | 'PARENTHESES' | 'NEARBY_ASSOCIATION';
  company: string;
  role: string;
  score: number;
  explicitCurrent: boolean;
};

export type CurrentEmploymentEvidence = {
  decision: EmploymentDecision;
  confidence: number;
  reason: EmploymentReason;
  requestedCompanySignals: EmploymentSignal[];
  contradictorySignals: EmploymentSignal[];
  historicalSignals: string[];
  extractedEmployers: string[];
  rejectedEmployerFragments: string[];
};

type EmploymentProfileFields = Pick<NormalizedProfile, 'headline' | 'currentTitle' | 'currentCompanyName'>;

const HISTORICAL_MARKER = /\b(?:former(?:ly)?|previously|prior|past|worked\s+at|experience\s+at|before\s+joining|alumni|left|retired|no\s+longer)\b|\bex[-\s]+|\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present)\b|\buntil\s+(?:19|20)\d{2}\b/i;
const CURRENT_MARKER = /\b(?:currently|current(?:ly)?\s+(?:works?|employed)|now\s+(?:at|with)|present)\b/i;
const ROLE_LIKE = /\b(?:engineer(?:ing)?|developer|programmer|architect|recruiter|scientist|analyst|designer|manager|director|lead|specialist|consultant|administrator|executive|officer|president|founder|intern|researcher|sales|marketing|product|operations|security|data|software|frontend|backend|full[ -]?stack|devops|sre|accountant|attorney)\b/i;
const BOILERPLATE = /^(?:view\s+(?:profile|full profile)|experience|education|skills|followers?|\d[\d,]*\+?\s+(?:connections?|followers?))$/i;
const EDUCATION = /\b(?:alumni|university|college|school|academy|bachelor|master(?:'s)?|ph\.?d|degree|computer science)\b/i;
const LOCATION = /\b(?:greater\s+.+\s+area|united states|usa|u\.s\.a?\.?|canada|united kingdom|u\.k\.?|remote|worldwide)\b/i;
const DURATION_OR_DATE = /^(?:present\s+)?\d+\s*(?:months?|years?|mos?|yrs?)$|\b(?:19|20)\d{2}\b|\b\d+\s*(?:months?|years?)\b/i;
const JOB_ONLY = /^(?:(?:senior|sr\.?|junior|jr\.?|staff|principal|lead|head|chief)\s+)*(?:full[ -]?stack\s+)?(?:software|backend|frontend|data|security|application|web|mobile|cloud|platform|devops)?\s*(?:engineer|developer|programmer|architect|recruiter|scientist|analyst|designer|manager|director|specialist|consultant|intern)s?$/i;
const GENERIC_FIELD = /^(?:data security|software engineering|software development|full[ -]?stack development|web development|information technology)$/i;
const PROSE_OR_VERB = /\b(?:building|helping|working|developing|creating|leading|joined|joins|providing|focused|specializing|seeking|interested)\b/i;

function cleanCompanyCandidate(candidate: string): string {
  return resultText(candidate)
    .replace(/^(?:company|employer|organization)\s*:\s*/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
}

/** Reject obvious SERP fragments before they can become contradictory employers. */
export function isPlausibleCompanyName(candidate: string): boolean {
  const value = cleanCompanyCandidate(candidate);
  if (!value || value.length < 2 || value.length > 80 || !/\p{L}/u.test(value)) return false;
  if (value.split(/\s+/).length > 7 || /https?:|www\.|@/i.test(value)) return false;
  if (BOILERPLATE.test(value) || CONNECTIONS_SEGMENT.test(value) || EMPLOYMENT_TYPE_SEGMENT.test(value)) return false;
  const corporateComma = /,\s*(?:incorporated|inc\.?|llc|ltd\.?|corp\.?|corporation|co\.?|company|plc|llp|lp|gmbh)\s*$/i.test(value);
  if (COUNTRY_ONLY.test(value) || LOCATION.test(value) || (locationLike(value) && !corporateComma)) return false;
  if (DURATION_OR_DATE.test(value) || EDUCATION.test(value) || JOB_ONLY.test(value) || GENERIC_FIELD.test(value)) return false;
  if (PROSE_OR_VERB.test(value) || /[.!?].+\s/.test(value)) return false;
  return true;
}

function clauses(text: string): string[] {
  return resultText(text).split(/\s*(?:[;]|(?<=[.!?])\s+)\s*/).map(part => part.trim()).filter(Boolean);
}

function companyMentioned(text: string, companyName: string): boolean {
  const tokens = resultText(text).replace(/[()[\]{}]/g, ' ').split(/\s+/).filter(Boolean);
  for (let size = 1; size <= Math.min(6, tokens.length); size++) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const candidate = tokens.slice(start, start + size).join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.&,-]+$/gu, '');
      if (candidate && companyNamesAliasMatch(candidate, companyName)) return true;
    }
  }
  return false;
}

function roleIsUsable(role: string, requestedRoles: string[]): boolean {
  const cleaned = resultText(role).replace(/^(?:currently|current|now)\s+/i, '');
  if (HISTORICAL_MARKER.test(cleaned)) return false;
  return ROLE_LIKE.test(cleaned) || (requestedRoles.length > 0 && publicPoolRoleMatches(cleaned, requestedRoles));
}

function scoreFor(source: EmploymentSignal['source'], kind: EmploymentSignal['kind'], explicitCurrent: boolean): number {
  const base = source === 'TITLE'
    ? (kind === 'AT' || kind === 'AT_SIGN' ? 100 : 92)
    : source === 'SNIPPET'
      ? (kind === 'AT' || kind === 'AT_SIGN' ? 82 : 74)
      : 68;
  return base + (explicitCurrent && source !== 'TITLE' ? 20 : 0);
}

function currentReason(signal: EmploymentSignal): EmploymentReason {
  if (signal.source === 'TITLE' && signal.kind === 'AT') return 'CURRENT_HEADLINE_AT_COMPANY';
  if (signal.source === 'TITLE' && signal.kind === 'AT_SIGN') return 'CURRENT_HEADLINE_AT_SIGN';
  if (signal.source === 'SNIPPET') return 'CURRENT_SNIPPET_ASSOCIATION';
  return 'CURRENT_ROLE_COMPANY_ASSOCIATION';
}

function analyze(
  result: WebSearchResult,
  profile: EmploymentProfileFields,
  companyName: string,
  requestedRoles: string[]
): Omit<CurrentEmploymentEvidence, 'decision' | 'confidence' | 'reason'> {
  const requestedCompanySignals: EmploymentSignal[] = [];
  const contradictorySignals: EmploymentSignal[] = [];
  const historicalSignals: string[] = [];
  const extractedEmployers: string[] = [];
  const rejectedEmployerFragments: string[] = [];
  const seenSignals = new Set<string>();

  const addPosition = (text: string, source: EmploymentSignal['source']) => {
    const value = resultText(text);
    if (!value || HISTORICAL_MARKER.test(value)) return;
    const position = positionEvidenceDetails(value);
    if (!position || !roleIsUsable(position.title, requestedRoles)) return;
    const company = cleanCompanyCandidate(position.company);
    extractedEmployers.push(company);
    if (!isPlausibleCompanyName(company)) {
      rejectedEmployerFragments.push(company);
      return;
    }
    // LinkedIn/Google headlines are the freshest unqualified source; a clean
    // position there is explicit current evidence even without the word "now".
    const explicitCurrent = source === 'TITLE' || CURRENT_MARKER.test(value);
    const signal: EmploymentSignal = {
      source,
      kind: position.connector,
      company,
      role: resultText(position.title),
      score: scoreFor(source, position.connector, explicitCurrent),
      explicitCurrent
    };
    const key = `${source}:${signal.kind}:${signal.role.toLowerCase()}:${company.toLowerCase()}`;
    if (seenSignals.has(key)) return;
    seenSignals.add(key);
    (companyNamesAliasMatch(company, companyName) ? requestedCompanySignals : contradictorySignals).push(signal);
  };

  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, '');
  const headline = resultText(profile.headline ?? '') || /^.+?\s+(?:[-–—]|\|)\s+(.+)$/.exec(title)?.[1]?.trim() || title;
  const headlineParts = (HISTORICAL_MARKER.test(headline)
    ? headline.split(/\s*[|·]\s*|\s+[-–—]\s+(?=(?:former|previous|prior|past|ex-))/i)
    : clauses(headline)).map(part => part.trim()).filter(Boolean);
  for (const part of headlineParts) {
    if (HISTORICAL_MARKER.test(part)) historicalSignals.push(part);
    else addPosition(part, 'TITLE');
  }

  const snippetClauses = clauses(result.snippet ?? '').flatMap(part => part.split(/\s*[·|]\s*/))
    .map(part => part.trim()).filter(Boolean);
  for (const part of snippetClauses) {
    if (HISTORICAL_MARKER.test(part)) {
      historicalSignals.push(part);
      continue;
    }
    addPosition(part, 'SNIPPET');
  }

  // SERP layouts often put role and employer in neighboring dot/pipe sections,
  // sometimes with an employment-type token between them. This is positive
  // requested-company evidence only; it never manufactures an other employer.
  const nearbySegments = resultText(result.snippet ?? '').split(/\s*[.!?·|]\s*/)
    .map(segment => segment.trim()).filter(segment => segment && !HISTORICAL_MARKER.test(segment)
      && !EMPLOYMENT_TYPE_SEGMENT.test(segment) && !CONNECTIONS_SEGMENT.test(segment)
      && !COUNTRY_ONLY.test(segment) && !locationLike(segment));
  for (let roleIndex = 0; roleIndex < nearbySegments.length; roleIndex++) {
    const role = nearbySegments[roleIndex].replace(/^experience\s*:\s*/i, '').trim();
    if (!roleIsUsable(role, requestedRoles) || positionEvidenceDetails(role)) continue;
    const company = nearbySegments.find((segment, companyIndex) => companyIndex !== roleIndex
      && Math.abs(companyIndex - roleIndex) <= 2 && companyMentioned(segment.replace(/^experience\s*:\s*/i, ''), companyName));
    if (company) requestedCompanySignals.push({ source: 'SNIPPET', kind: 'NEARBY_ASSOCIATION',
      company: companyName, role, score: 70, explicitCurrent: false });
  }

  if (profile.currentTitle && profile.currentCompanyName && !HISTORICAL_MARKER.test(profile.currentTitle)) {
    const company = cleanCompanyCandidate(profile.currentCompanyName);
    extractedEmployers.push(company);
    if (!isPlausibleCompanyName(company)) rejectedEmployerFragments.push(company);
    else if (roleIsUsable(profile.currentTitle, requestedRoles)) {
      const signal: EmploymentSignal = { source: 'STRUCTURED', kind: 'SEPARATOR', company,
        role: profile.currentTitle, score: scoreFor('STRUCTURED', 'SEPARATOR', false), explicitCurrent: false };
      (companyNamesAliasMatch(company, companyName) ? requestedCompanySignals : contradictorySignals).push(signal);
    }
  }

  return {
    requestedCompanySignals,
    contradictorySignals,
    historicalSignals: [...new Set(historicalSignals)],
    extractedEmployers: [...new Set(extractedEmployers.filter(Boolean))],
    rejectedEmployerFragments: [...new Set(rejectedEmployerFragments.filter(Boolean))]
  };
}

export function validateCurrentEmployment(
  result: WebSearchResult,
  profile: NormalizedProfile,
  companyName: string,
  requestedRoles: string[] = []
): CurrentEmploymentEvidence {
  const evidence = analyze(result, profile, companyName, requestedRoles);
  const requested = [...evidence.requestedCompanySignals].sort((a, b) => b.score - a.score)[0];
  const contradictory = [...evidence.contradictorySignals].sort((a, b) => b.score - a.score)[0];
  const historicalRequested = evidence.historicalSignals.some(signal => companyMentioned(signal, companyName));

  // A lower-priority snippet or parser guess cannot erase an explicit requested-
  // company headline. Only a stronger, explicitly-current contradiction wins.
  if (requested && (!contradictory || contradictory.score <= requested.score || !contradictory.explicitCurrent)) {
    return { ...evidence, decision: 'CURRENT', confidence: Math.min(1, requested.score / 100), reason: currentReason(requested) };
  }
  if (contradictory && (!requested || contradictory.score > requested.score)) {
    return { ...evidence, decision: 'CONTRADICTORY', confidence: Math.min(1, contradictory.score / 100),
      reason: 'EXPLICIT_OTHER_CURRENT_EMPLOYER' };
  }
  if (historicalRequested) {
    return { ...evidence, decision: 'FORMER', confidence: 0.95, reason: 'FORMER_REQUESTED_COMPANY' };
  }
  return { ...evidence, decision: 'INSUFFICIENT', confidence: 0,
    reason: evidence.rejectedEmployerFragments.length ? 'INVALID_CONTRADICTORY_COMPANY_FRAGMENT' : 'INSUFFICIENT_COMPANY_EVIDENCE' };
}

export function strongCurrentAssociation(result: WebSearchResult, companyName: string): boolean {
  const emptyProfile: EmploymentProfileFields = { headline: null, currentTitle: null, currentCompanyName: null };
  return analyze(result, emptyProfile, companyName, []).requestedCompanySignals.some(signal => signal.score >= 70);
}
