import type { WebSearchResult } from './web-search-provider';
import { canonicalizeLinkedInProfileUrl } from './linkedin-profile-url';
import { normalizeTitle } from './prospect-normalization';
import { normalizeProfile } from './apify-profile-search';

export function resultText(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
export function positionEvidence(text: string): { title: string; company: string } | null {
  const parts = text.split(/\s+at\s+|\s+[-–—|·]\s+/i);
  if (parts.length !== 2 || !parts.every(p => p.trim())) return null;
  return { title: parts[0].trim(), company: parts[1].trim() };
}

// You.com snippets are query-relevant page extracts, not a SERP card: they mix
// history sections, connection counts, boilerplate and locations in any order.
// Such segments can never supply the CURRENT position on their own.
const NON_POSITION_SEGMENT = /^(?:experience|education|location|skills|languages?|certifications?|courses|projects|activity|about|summary|view)\b/i;
const CONNECTIONS_SEGMENT = /\b\d[\d,]*\+?\s+connections?\b/i;
const EMPLOYMENT_TYPE_SEGMENT = /^(?:(?:full|part)[- ]?time|contract(?:or)?|freelance|internship|apprenticeship|self[- ]?employed|remote|hybrid|on[- ]?site)$/i;
/** Comma-separated segments are locations ("Chicago, Illinois, United States"), never a bare title or employer. */
const locationLike = (segment: string) => segment.includes(',');
/** Country-only fragments are location text; no employer or role is named by them. */
const COUNTRY_ONLY = /^(?:united states|usa|u\.?s\.?a\.?|canada|united kingdom|u\.?k\.?|netherlands|australia|germany|france)$/i;

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
  const identity = canonicalizeLinkedInProfileUrl(result.url);
  if (!identity) return null;
  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, '');
  const match = /^(.+?)\s+(?:[-–—]|\|)\s+(.+)$/.exec(title);
  if (!match || !/\p{L}/u.test(match[1])) return null;
  const headline = match[2];
  const snippet = resultText(result.snippet ?? '');
  const segments = snippet.split(/\s*[·|]\s*/);
  const position = positionEvidence(headline) ?? snippetPositionEvidence(snippet);
  const location = segments.find(s => s.includes(',') && !/\b(?:at|previous|former|experience|education)\b/i.test(s) && !NON_POSITION_SEGMENT.test(s))
    ?? (/\bLocation:\s*([^·|]+)/i.exec(snippet)?.[1]) ?? null;
  const profile = normalizeProfile({ ...identity, id: identity.sourceProfileId, fullName: match[1],
    headline, currentTitle: position?.title, currentCompany: position?.company, location });
  if (!profile) return null;
  // normalizeProfile accepts several actor fields; explicitly use evidenced position only.
  return { ...profile, currentTitle: position?.title ?? null, normalizedTitle: position ? normalizeTitle(position.title) : null, currentCompanyName: position?.company ?? null };
}
