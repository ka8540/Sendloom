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
  const position = positionEvidence(headline) ?? positionEvidence(segments[0]) ?? (segments.length >= 2 ? positionEvidence(segments.slice(0, 2).join(' · ')) : null);
  const location = segments.slice(1).find(s => s.includes(',') && !/\b(?:at|previous|former|experience|education)\b/i.test(s))
    ?? (/\bLocation:\s*([^·|]+)/i.exec(snippet)?.[1]) ?? null;
  const profile = normalizeProfile({ ...identity, id: identity.sourceProfileId, fullName: match[1],
    headline, currentTitle: position?.title, currentCompany: position?.company, location });
  if (!profile) return null;
  // normalizeProfile accepts several actor fields; explicitly use evidenced position only.
  return { ...profile, currentTitle: position?.title ?? null, normalizedTitle: position ? normalizeTitle(position.title) : null, currentCompanyName: position?.company ?? null };
}
