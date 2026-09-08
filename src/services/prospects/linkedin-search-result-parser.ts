import { recognizePublicLocation } from "./discover-location-matching";
import type { WebSearchResult } from './web-search-provider';
import { resolveLinkedInProfileUrl } from './linkedin-profile-url';
import { normalizeTitle } from './prospect-normalization';
import { normalizeProfile } from './apify-profile-search';

export function resultText(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;|\u00a0/g, ' ').replace(/[‐‑‒−]/g, '-').replace(/\s+/g, ' ').trim();
}

const ROLE_LIKE = /\b(?:engineer(?:ing)?|developer|programmer|architect|recruiter|scientist|analyst|designer|manager|director|lead|specialist|consultant|administrator|executive|officer|president|founder|intern|researcher|sales|marketing|product|operations|security|data|software|frontend|backend|full[ -]?stack|devops|sre|accountant|attorney)\b/i;

function orientPosition(first: string, second: string): { title: string; company: string } {
  const firstLooksLikeRole = ROLE_LIKE.test(first);
  const secondLooksLikeRole = ROLE_LIKE.test(second);
  return secondLooksLikeRole && !firstLooksLikeRole
    ? { title: second, company: first }
    : { title: first, company: second };
}

export type PositionEvidence = { title: string; company: string; connector: 'AT' | 'AT_SIGN' | 'SEPARATOR' | 'PARENTHESES' };

export function positionEvidenceDetails(text: string): PositionEvidence | null {
  const value = resultText(text);
  const atSign = /^(.+?)\s*@\s*(.+)$/.exec(value);
  if (atSign?.[1]?.trim() && atSign[2]?.trim()) {
    return { title: atSign[1].trim(), company: atSign[2].trim(), connector: 'AT_SIGN' };
  }
  const at = /^(.+?)\s+at\s+(.+)$/i.exec(value);
  if (at?.[1]?.trim() && at[2]?.trim()) {
    return { title: at[1].trim(), company: at[2].trim(), connector: 'AT' };
  }
  const parenthesized = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(value);
  if (parenthesized?.[1]?.trim() && parenthesized[2]?.trim()) {
    return { ...orientPosition(parenthesized[1].trim(), parenthesized[2].trim()), connector: 'PARENTHESES' };
  }
  const separated = /^(.+?)\s+[-–—]\s+(.+)$/.exec(value)
    ?? /^(.+?)\s*[|·:]\s*(.+)$/.exec(value)
    ?? /^(.+?),\s+(.+)$/.exec(value);
  if (!separated?.[1]?.trim() || !separated[2]?.trim()) return null;
  return { ...orientPosition(separated[1].trim(), separated[2].trim()), connector: 'SEPARATOR' };
}

export function positionEvidence(text: string): { title: string; company: string } | null {
  const position = positionEvidenceDetails(text);
  return position ? { title: position.title, company: position.company } : null;
}

// You.com snippets are query-relevant page extracts, not a SERP card: they mix
// history sections, connection counts, boilerplate and locations in any order.
// Such segments can never supply the CURRENT position on their own.
const NON_POSITION_SEGMENT = /^(?:experience|education|location|skills|languages?|certifications?|courses|projects|activity|about|summary|view)\b/i;
export const CONNECTIONS_SEGMENT = /\b\d[\d,]*\+?\s+connections?\b/i;
export const EMPLOYMENT_TYPE_SEGMENT = /^(?:(?:full|part)[- ]?time|contract(?:or)?|freelance|internship|apprenticeship|self[- ]?employed|remote|hybrid|on[- ]?site)$/i;
/** Comma-separated segments are locations ("Chicago, Illinois, United States"), never a bare title or employer. */
export const locationLike = (segment: string) => segment.includes(',');
/** Country-only fragments are location text; no employer or role is named by them. */
export const COUNTRY_ONLY = /^(?:united states|usa|u\.?s\.?a\.?|canada|united kingdom|u\.?k\.?|netherlands|australia|germany|france)$/i;

function usableSegment(segment: string): boolean {
  const value = segment.trim();
  return Boolean(value) && !NON_POSITION_SEGMENT.test(value) && !CONNECTIONS_SEGMENT.test(value)
    && !EMPLOYMENT_TYPE_SEGMENT.test(value);
}

/**
 * Extract current position evidence from snippet segments. Every segment is
 * tried first ("Location · Software Engineer at Optiver · 500+ connections"),
 * then ADJACENT pairs cover "Title · Company" splits ("Software Engineer ·
 * Optiver · Location"). Skipped segments never join across (a filtered
 * "Full-time" must not stitch "Optiver" to "Software Engineer"), and a
 * location-like or country-only segment is never manufactured into a title.
 */
export function snippetPositionEvidence(snippet: string): { title: string; company: string } | null {
  const segments = snippet.split(/\s*[·|]\s*/);
  for (const segment of segments) {
    if (!usableSegment(segment)) continue;
    const position = positionEvidence(segment);
    if (position && !locationLike(position.title) && !locationLike(position.company)
      && !COUNTRY_ONLY.test(position.title)) return position;
  }
  for (let index = 0; index + 1 < segments.length; index++) {
    const first = segments[index];
    const second = segments[index + 1];
    if (!usableSegment(first) || !usableSegment(second)) continue;
    if (locationLike(first) || locationLike(second) || COUNTRY_ONLY.test(first.trim())) continue;
    const position = positionEvidence(`${first} · ${second}`);
    if (position) return position;
  }
  return null;
}
/** Only the headline or leading snippet position can supply a current job. */
export function parseLinkedInSearchResult(result: WebSearchResult) {
  const resolution = resolveLinkedInProfileUrl(result.url, result.displayedUrl);
  if (!resolution.ok) return null;
  const identity = resolution.identity;
  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, '');
  const match = /^(.+?)\s+(?:[-–—]|\|)\s+(.+)$/.exec(title);
  const fullName = match?.[1]?.trim() ?? title.trim();
  if (!/\p{L}/u.test(fullName)) return null;
  const headline = match?.[2]?.trim() ?? '';
  const snippet = resultText(result.snippet ?? '');
  const segments = snippet.split(/\s*[·|]\s*/);
  const position = positionEvidence(headline) ?? snippetPositionEvidence(snippet);
  const location = segments.map(s => recognizePublicLocation(s)).find(Boolean) ?? null;
  const profile = normalizeProfile({ ...identity, id: identity.sourceProfileId, fullName,
    headline: headline || null, currentTitle: position?.title, currentCompany: position?.company, location });
  if (!profile) return null;
  // normalizeProfile accepts several actor fields; explicitly use evidenced position only.
  return { ...profile, currentTitle: position?.title ?? null, normalizedTitle: position ? normalizeTitle(position.title) : null, currentCompanyName: position?.company ?? null };
}
