import { companyNamesAliasMatch, normalizeProfile, type NormalizedProfile } from "@/services/prospects/apify-profile-search";
import type { BrightOrganicResult } from "@/services/prospects/brightdata-google-search-provider";
import { resolveLinkedInProfileUrl } from "@/services/prospects/linkedin-profile-url";
import { normalizeTitle } from "@/services/prospects/prospect-normalization";
import { looksLikeRoleTitle } from "@/services/prospects/role-title-evidence";

export function resultText(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;|\u00a0/g, " ").replace(/[‐‑‒−]/g, "-").replace(/\s+/g, " ").trim();
}

export const CONNECTIONS_SEGMENT = /\b\d[\d,]*\+?\s+connections?\b/i;
export const EMPLOYMENT_TYPE_SEGMENT = /^(?:(?:full|part)[- ]?time|contract(?:or)?|freelance|internship|apprenticeship|self[- ]?employed|remote|hybrid|on[- ]?site)$/i;
export const COUNTRY_ONLY = /^(?:united states|usa|u\.?s\.?(?:a\.?)?|canada|united kingdom|u\.?k\.?|netherlands|australia|germany|france)$/i;
export const locationLike = (segment: string) => segment.includes(",");

export type PositionEvidenceOptions = { expectedCompanyName?: string };

function orientPosition(first: string, second: string, options: PositionEvidenceOptions): { title: string; company: string } {
  if (options.expectedCompanyName) {
    const firstMatches = companyNamesAliasMatch(first, options.expectedCompanyName);
    const secondMatches = companyNamesAliasMatch(second, options.expectedCompanyName);
    if (firstMatches && !secondMatches) return { title: second, company: first };
    if (secondMatches && !firstMatches) return { title: first, company: second };
  }
  return looksLikeRoleTitle(second) && !looksLikeRoleTitle(first)
    ? { title: second, company: first }
    : { title: first, company: second };
}

export type PositionEvidence = {
  title: string;
  company: string;
  connector: "AT" | "AT_SIGN" | "SEPARATOR" | "PARENTHESES";
};

export function positionEvidenceDetails(text: string, options: PositionEvidenceOptions = {}): PositionEvidence | null {
  const value = resultText(text);
  const atSign = /^(.+?)\s*@\s*(.+)$/.exec(value);
  if (atSign?.[1]?.trim() && atSign[2]?.trim()) return { title: atSign[1].trim(), company: atSign[2].trim(), connector: "AT_SIGN" };
  const at = /^(.+?)\s+at\s+(.+)$/i.exec(value);
  if (at?.[1]?.trim() && at[2]?.trim()) return { title: at[1].trim(), company: at[2].trim(), connector: "AT" };
  const parenthesized = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(value);
  if (parenthesized?.[1]?.trim() && parenthesized[2]?.trim()) {
    return { ...orientPosition(parenthesized[1].trim(), parenthesized[2].trim(), options), connector: "PARENTHESES" };
  }
  const separated = /^(.+?)\s+[-–—]\s+(.+)$/.exec(value)
    ?? /^(.+?)\s*[|·:]\s*(.+)$/.exec(value)
    ?? /^(.+?),\s+(.+)$/.exec(value);
  if (!separated?.[1]?.trim() || !separated[2]?.trim()) return null;
  return { ...orientPosition(separated[1].trim(), separated[2].trim(), options), connector: "SEPARATOR" };
}

export type SnippetPositionEvidence = { text: string; context: string; position: PositionEvidence | null };

function usableSnippetSegment(value: string): boolean {
  return Boolean(value) && !CONNECTIONS_SEGMENT.test(value) && !EMPLOYMENT_TYPE_SEGMENT.test(value)
    && !locationLike(value) && !COUNTRY_ONLY.test(value);
}

/** Preserve clause context so a historical marker cannot be lost when pairing segments. */
export function snippetPositionEvidenceDetails(snippet: string, options: PositionEvidenceOptions = {}): SnippetPositionEvidence[] {
  const evidence: SnippetPositionEvidence[] = [];
  const adjacent: SnippetPositionEvidence[] = [];
  for (const context of resultText(snippet).split(/\s*;\s*/).filter(Boolean)) {
    const segments = context.split(/\s*[·|]\s*/).map((segment) => segment.trim()).filter(Boolean);
    // Keep every standalone interpretation for employment validation, including
    // explicit connectors in titles with commas. Only pairing excludes location segments.
    const entries = segments.map((text) => ({ text, context: text, position: positionEvidenceDetails(text, options) }));
    evidence.push(...entries);
    for (let index = 0; index + 1 < entries.length; index += 1) {
      const first = entries[index];
      const second = entries[index + 1];
      // An explicit position already supplies its own employer. Pairing it
      // with another segment could manufacture a different employment claim.
      if (first.position || second.position || !usableSnippetSegment(first.text) || !usableSnippetSegment(second.text)) continue;
      const text = `${first.text} · ${second.text}`;
      const position = positionEvidenceDetails(text, options);
      if (position) adjacent.push({ text, context, position });
    }
  }
  return [...evidence, ...adjacent];
}

export function snippetPositionEvidence(snippet: string, options: PositionEvidenceOptions = {}): PositionEvidence | null {
  return snippetPositionEvidenceDetails(snippet, options)
    .find((entry) => entry.position && usableSnippetSegment(entry.text))?.position ?? null;
}

export function parseLinkedInSearchResult(result: BrightOrganicResult, options: PositionEvidenceOptions = {}): NormalizedProfile | null {
  const resolution = resolveLinkedInProfileUrl(result.url, result.displayedUrl);
  if (!resolution.ok) return null;
  const title = resultText(result.title).replace(/\s*(?:\||-)\s*LinkedIn\s*$/i, "");
  const match = /^(.+?)\s+(?:[-–—]|\|)\s+(.+)$/.exec(title);
  const fullName = match?.[1]?.trim() ?? title.trim();
  if (!/\p{L}/u.test(fullName)) return null;
  const headline = match?.[2]?.trim() ?? "";
  const snippet = resultText(result.snippet ?? "");
  const position = positionEvidenceDetails(headline, options) ?? snippetPositionEvidence(snippet, options);
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
