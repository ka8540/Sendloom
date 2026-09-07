import { recognizePublicLocation } from './discover-location-matching';
import { parseLocation } from './prospect-normalization';

/** Discard history before looking for geography; never feed full biographies to AI. */
export function publicLocationEvidence(snippet: string, companyName?: string): string | null {
  const current = snippet.split(/\b(?:experience|education|previously|formerly|worked|past employment)\b|\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/i)[0];
  const escapedCompany = companyName?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutCompany = escapedCompany ? current.replace(new RegExp(escapedCompany, 'gi'), ' · ') : current;
  const segments = withoutCompany.replace(/Read more/gi, '').split(/[·|;!?]|\.{1,3}\s*|\b(?:university|college|school)\b\s*/i);
  for (const segment of segments) {
    const text = segment.replace(/^\s*(?:months?|years?|Location:)\s*/i, '').trim();
    const direct = recognizePublicLocation(text);
    if (direct) return direct;
    // Only a compact suffix separated from prose is eligible. A title/company
    // prefix cannot become part of a city; uncertain prose supplies no city.
    const words = text.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const suffix = words.slice(i).join(' ');
      if (!suffix.includes(',')) continue;
      if (i > 0 && !/[,:]$/.test(words[i - 1])) continue;
      const plausible = recognizePublicLocation(suffix);
      if (plausible) return plausible;
    }
  }
  return null;
}
export function requestedCountryFallback(locations: readonly string[]): string | null {
  if (locations.length !== 1 || locations[0].includes(',')) return null;
  const recognized = recognizePublicLocation(locations[0]);
  const parsed = parseLocation(recognized);
  return recognized && parsed.country && !parsed.city && !parsed.state ? recognized : null;
}
/** An AI result must remain a literal compact portion of the supplied evidence. */
export function validatePublicLocation(value: unknown, evidence: string | null): string | null {
  if (typeof value !== 'string' || !evidence) return null;
  const clean = recognizePublicLocation(value);
  if (!clean || !evidence.toLowerCase().includes(clean.toLowerCase())) return null;
  return clean;
}
