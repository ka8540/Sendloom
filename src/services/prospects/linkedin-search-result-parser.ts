import { normalizeProfile, type NormalizedProfile } from "@/services/prospects/apify-profile-search";
import type { BrightOrganicResult } from "@/services/prospects/brightdata-google-search-provider";
import { resolveLinkedInProfileUrl } from "@/services/prospects/linkedin-profile-url";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";

export function resultText(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;|\u00a0/g, " ").replace(/[‐‑‒−]/g, "-").replace(/\s+/g, " ").trim();
}

const ROLE_LIKE = /\b(?:engineer(?:ing)?|developer|programmer|architect|recruiter|scientist|analyst|designer|manager|director|lead|specialist|consultant|administrator|executive|officer|president|founder|intern|researcher|sales|marketing|product|operations|security|data|software|frontend|backend|full[ -]?stack|devops|sre|accountant|attorney)\b/i;
export const CONNECTIONS_SEGMENT = /\b\d[\d,]*\+?\s+connections?\b/i;
export const EMPLOYMENT_TYPE_SEGMENT = /^(?:(?:full|part)[- ]?time|contract(?:or)?|freelance|internship|apprenticeship|self[- ]?employed|remote|hybrid|on[- ]?site)$/i;
export const COUNTRY_ONLY = /^(?:united states|usa|u\.?s\.?(?:a\.?)?|canada|united kingdom|u\.?k\.?|netherlands|australia|germany|france)$/i;
export const locationLike = (segment: string) => segment.includes(",");

function orientPosition(first: string, second: string): { title: string; company: string } {
  return ROLE_LIKE.test(second) && !ROLE_LIKE.test(first)
    ? { title: second, company: first }
    : { title: first, company: second };
}

export type PositionEvidence = {
  title: string;
  company: string;
  connector: "AT" | "AT_SIGN" | "SEPARATOR" | "PARENTHESES";
};

export function positionEvidenceDetails(text: string): PositionEvidence | null {
  const value = resultText(text);
  const atSign = /^(.+?)\s*@\s*(.+)$/.exec(value);
  if (atSign?.[1]?.trim() && atSign[2]?.trim()) return { title: atSign[1].trim(), company: atSign[2].trim(), connector: "AT_SIGN" };
  const at = /^(.+?)\s+at\s+(.+)$/i.exec(value);
  if (at?.[1]?.trim() && at[2]?.trim()) return { title: at[1].trim(), company: at[2].trim(), connector: "AT" };
  const parenthesized = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(value);
  if (parenthesized?.[1]?.trim() && parenthesized[2]?.trim()) {
    return { ...orientPosition(parenthesized[1].trim(), parenthesized[2].trim()), connector: "PARENTHESES" };
  }
  const separated = /^(.+?)\s+[-–—]\s+(.+)$/.exec(value)
    ?? /^(.+?)\s*[|·:]\s*(.+)$/.exec(value)
    ?? /^(.+?),\s+(.+)$/.exec(value);
  if (!separated?.[1]?.trim() || !separated[2]?.trim()) return null;
  return { ...orientPosition(separated[1].trim(), separated[2].trim()), connector: "SEPARATOR" };
}

function snippetPositionEvidence(snippet: string): { title: string; company: string } | null {
  const segments = snippet.split(/\s*[·|]\s*/).map((segment) => segment.trim());
  const usable = (value: string) => Boolean(value) && !CONNECTIONS_SEGMENT.test(value) && !EMPLOYMENT_TYPE_SEGMENT.test(value)
    && !locationLike(value) && !COUNTRY_ONLY.test(value);
  for (const segment of segments) {
    if (!usable(segment)) continue;
    const position = positionEvidenceDetails(segment);
    if (position) return position;
  }
  for (let index = 0; index + 1 < segments.length; index += 1) {
    if (!usable(segments[index]) || !usable(segments[index + 1])) continue;
    const position = positionEvidenceDetails(`${segments[index]} · ${segments[index + 1]}`);
    if (position) return position;
  }
  return null;
}

export function parseLinkedInSearchResult(result: BrightOrganicResult): NormalizedProfile | null {
  const resolution = resolveLinkedInProfileUrl(result.url, result.displayedUrl);
  if (!resolution.ok) return null;
  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, "");
  const match = /^(.+?)\s+(?:[-–—]|\|)\s+(.+)$/.exec(title);
  const fullName = match?.[1]?.trim() ?? title.trim();
  if (!/\p{L}/u.test(fullName)) return null;
  const headline = match?.[2]?.trim() ?? "";
  const snippet = resultText(result.snippet ?? "");
  const position = positionEvidenceDetails(headline) ?? snippetPositionEvidence(snippet);
  const profile = normalizeProfile({
    ...resolution.identity,
    id: resolution.identity.sourceProfileId,
    fullName,
    headline: headline || null,
    currentTitle: position?.title,
    currentCompany: position?.company
  });
  if (!profile) return null;
  return {
    ...profile,
    currentTitle: position?.title ?? null,
    normalizedTitle: position ? normalizeTitle(position.title) : null,
    currentCompanyName: position?.company ?? null
  };
}
