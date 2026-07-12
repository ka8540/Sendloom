// Turn the current user's OWN Discover rows into ranked company / role /
// location suggestions. Pure: the resolver fetches the user-scoped rows (only
// ever `where: { userId }`) and hands them here, so nothing in this module can
// read another user's data. It never calls a provider, Apify, or AI — every
// suggestion is a value the user has already used.

import {
  companyMatchAliases,
  DEFAULT_SUGGESTION_LIMIT,
  rankSuggestions,
  titleCaseLabel,
  type RankedSuggestion,
  type SuggestionEntry
} from "@/services/prospects/discover-suggestions";
import { normalizeRoleGroupToken } from "@/services/prospects/discover-role-group-key";

export type DiscoverSuggestionType = "COMPANY" | "ROLE" | "LOCATION";

/** The subset of ProspectCompany columns suggestions read. */
export type SuggestionCompanyRow = {
  id: string;
  name: string;
  officialName?: string | null;
  normalizedName?: string | null;
  canonicalKey?: string | null;
  officialDomain?: string | null;
  officialWebsiteDomain?: string | null;
  emailDomain?: string | null;
  linkedinUrl?: string | null;
};

/** The subset of ProspectSearch columns suggestions read. */
export type SuggestionSearchRow = {
  companyId?: string | null;
  requestedCompany?: string | null;
  requestedDomain?: string | null;
  requestedLinkedin?: string | null;
  requestedTitles?: unknown;
  requestedLocations?: unknown;
};

export type DiscoverSuggestionResult = {
  companies: RankedSuggestion[];
  roles: RankedSuggestion[];
  locations: RankedSuggestion[];
};

// Priorities keep resolved/current-company values above raw or broader ones when
// they tie on match rank (see rankSuggestions).
const PRIORITY_RESOLVED_COMPANY = 2;
const PRIORITY_RAW_COMPANY = 1;
const PRIORITY_CURRENT_COMPANY = 2;
const PRIORITY_OTHER_COMPANY = 1;

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstDomain(company: SuggestionCompanyRow): string | null {
  return company.officialDomain ?? company.officialWebsiteDomain ?? company.emailDomain ?? null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function companyIdentity(company: SuggestionCompanyRow): string {
  return company.canonicalKey ? `key:${company.canonicalKey}` : `id:${company.id}`;
}

function companyNameIdentity(value: string): string {
  const spaced = companyMatchAliases(value)[0] ?? "";
  return spaced
    .replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc)\b/g, " ")
    .replace(/\band\s*$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function unresolvedIdentity(search: SuggestionSearchRow): string | null {
  const name = clean(search.requestedCompany);
  const domain = clean(search.requestedDomain);
  const nameKey = name ? companyNameIdentity(name) : "";
  const domainKey = domain ? normalizeRoleGroupToken(domain).replace(/^https?:\/\//, "").replace(/^www\./, "") : "";
  return nameKey || domainKey ? `raw:${nameKey}|${domainKey}` : null;
}

/**
 * Build company entries from resolved ProspectCompany rows plus the raw company
 * strings the user typed on searches that never resolved. Resolved companies
 * carry a domain, id, and canonicalKey (so selecting one can preserve backend
 * dedupe identity) and outrank raw strings on ties. Matching includes the domain
 * and official name; correction is limited to the display name so we never emit
 * "Did you mean stripe.com?".
 */
export function buildCompanyEntries(
  companies: readonly SuggestionCompanyRow[],
  searches: readonly SuggestionSearchRow[]
): SuggestionEntry[] {
  type MutableCompanyEntry = SuggestionEntry & { matchKeys: string[]; correctionKeys: string[] };
  const byIdentity = new Map<string, MutableCompanyEntry>();
  const byCompanyId = new Map<string, MutableCompanyEntry>();

  for (const company of companies) {
    const displayName = clean(company.officialName) ?? clean(company.name);
    if (!displayName) {
      continue;
    }
    const matchKeys = [
      company.name,
      company.officialName ?? "",
      company.normalizedName ?? "",
      company.officialDomain ?? "",
      company.officialWebsiteDomain ?? "",
      company.emailDomain ?? "",
      company.canonicalKey ?? "",
      company.linkedinUrl ?? ""
    ].filter(Boolean);
    const entry: MutableCompanyEntry = {
      value: displayName,
      detail: firstDomain(company),
      companyId: company.id,
      canonicalKey: company.canonicalKey ?? null,
      matchKeys,
      correctionKeys: [company.name, company.officialName ?? ""].filter(Boolean),
      punctuationTolerant: true,
      priority: PRIORITY_RESOLVED_COMPANY
    };
    byIdentity.set(companyIdentity(company), entry);
    byCompanyId.set(company.id, entry);
  }

  // Every historical request is searchable. Linked requests add their original
  // name/domain/LinkedIn text as aliases of the canonical company; unresolved
  // draft/failed requests become standalone suggestions.
  for (const search of searches) {
    const raw = clean(search.requestedCompany);
    const requestedDomain = clean(search.requestedDomain);
    const requestedLinkedin = clean(search.requestedLinkedin);
    const linked = search.companyId ? byCompanyId.get(search.companyId) : null;
    if (linked) {
      linked.matchKeys.push(
        ...[raw, requestedDomain, requestedLinkedin].filter((value): value is string => Boolean(value))
      );
      if (raw) {
        linked.correctionKeys.push(raw);
      }
      continue;
    }
    const identity = unresolvedIdentity(search);
    if (!identity || !raw) {
      continue;
    }
    const existing = byIdentity.get(identity);
    if (existing) {
      existing.matchKeys.push(
        ...[raw, requestedDomain, requestedLinkedin].filter((value): value is string => Boolean(value))
      );
      continue;
    }
    byIdentity.set(identity, {
      value: raw,
      detail: requestedDomain,
      matchKeys: [raw, requestedDomain ?? "", requestedLinkedin ?? ""].filter(Boolean),
      correctionKeys: [raw],
      punctuationTolerant: true,
      priority: PRIORITY_RAW_COMPANY
    });
  }

  // De-dupe unresolved aliases that identify an already-resolved company by
  // normalized display name + domain fallback, while stable company identities
  // (canonical key / id) remain authoritative.
  const accepted: MutableCompanyEntry[] = [];
  for (const entry of byIdentity.values()) {
    const nameKey = companyNameIdentity(entry.value);
    const domainKey = normalizeRoleGroupToken(entry.detail ?? "").replace(/^www\./, "");
    const duplicate = accepted.find((candidate) => {
      if (companyNameIdentity(candidate.value) !== nameKey) {
        return false;
      }
      const candidateDomain = normalizeRoleGroupToken(candidate.detail ?? "").replace(/^www\./, "");
      return !domainKey || !candidateDomain || domainKey === candidateDomain;
    });
    if (duplicate) {
      duplicate.matchKeys.push(...entry.matchKeys);
      duplicate.correctionKeys.push(...entry.correctionKeys);
      continue;
    }
    accepted.push(entry);
  }
  return accepted.map((entry) => {
    entry.matchKeys = [...new Set(entry.matchKeys)];
    entry.correctionKeys = [...new Set(entry.correctionKeys)];
    return entry;
  });
}

/**
 * Distinct role (or location) labels across the user's searches, counted by
 * usage and, when `currentCompanyId` is given, boosted for the company being
 * viewed so the inside-company card surfaces that company's roles/locations
 * first. First-seen casing is preserved for display.
 */
function buildLabelEntries(
  searches: readonly SuggestionSearchRow[],
  field: "requestedTitles" | "requestedLocations",
  currentCompanyId: string | null
): SuggestionEntry[] {
  type Acc = { value: string; count: number; fromCurrentCompany: boolean };
  const byKey = new Map<string, Acc>();

  for (const search of searches) {
    const labels = toStringArray(search[field]);
    const isCurrent = Boolean(currentCompanyId) && search.companyId === currentCompanyId;
    for (const label of labels) {
      // Suggestions always display a CLEAN, title-cased label — a stored
      // "SOftware Engineer" surfaces (and is inserted) as "Software Engineer".
      const display = titleCaseLabel(label);
      const key = normalizeRoleGroupToken(display);
      if (!display || !key) {
        continue;
      }
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        existing.fromCurrentCompany = existing.fromCurrentCompany || isCurrent;
      } else {
        byKey.set(key, { value: display, count: 1, fromCurrentCompany: isCurrent });
      }
    }
  }

  return [...byKey.values()].map((acc) => ({
    value: acc.value,
    count: acc.count,
    priority: acc.fromCurrentCompany ? PRIORITY_CURRENT_COMPANY : PRIORITY_OTHER_COMPANY
  }));
}

/**
 * Rank the user's known companies/roles/locations against `query`, computing
 * only the requested `types`. `companyId` (inside-company card) prioritizes the
 * current company's roles/locations. Results are capped per type at `limit`.
 */
export function buildDiscoverSuggestions(input: {
  query: string;
  types: DiscoverSuggestionType[];
  companyId?: string | null;
  companies: readonly SuggestionCompanyRow[];
  searches: readonly SuggestionSearchRow[];
  limit?: number;
}): DiscoverSuggestionResult {
  const limit = input.limit ?? DEFAULT_SUGGESTION_LIMIT;
  const wants = new Set(input.types);
  const result: DiscoverSuggestionResult = { companies: [], roles: [], locations: [] };

  if (wants.has("COMPANY")) {
    result.companies = flatten(rankSuggestions(buildCompanyEntries(input.companies, input.searches), input.query, { limit }));
  }
  if (wants.has("ROLE")) {
    const entries = buildLabelEntries(input.searches, "requestedTitles", input.companyId ?? null);
    result.roles = flatten(rankSuggestions(entries, input.query, { limit }));
  }
  if (wants.has("LOCATION")) {
    const entries = buildLabelEntries(input.searches, "requestedLocations", input.companyId ?? null);
    result.locations = flatten(rankSuggestions(entries, input.query, { limit }));
  }

  return result;
}

/** Flatten matches + optional correction into one ordered list (correction last). */
function flatten(ranked: { matches: RankedSuggestion[]; correction: RankedSuggestion | null }): RankedSuggestion[] {
  return ranked.correction ? [...ranked.matches, ranked.correction] : ranked.matches;
}
