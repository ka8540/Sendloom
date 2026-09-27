import { normalizeTitle } from "@/services/prospects/prospect-normalization";

function quote(value: string): string {
  return `"${value.normalize("NFC").replace(/["\\\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}"`;
}

const TRAILING_COMPANY_SUFFIX = /(?:[\s,.]+(?:incorporated|inc|l\.l\.c|llc|limited|ltd|corporation|corp|company|co|gmbh|plc|llp|lp|sa|ag|pty))\.?\s*$/i;
const TRAILING_DOMAIN_SUFFIX = /\.(?:com|co|io|ai|net|org)\s*$/i;

export function publicCompanySearchAliases(companyName: string): string[] {
  const original = companyName.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!original) return [];
  const aliases = [original];
  let brand = original;
  while (TRAILING_COMPANY_SUFFIX.test(brand)) {
    brand = brand.replace(TRAILING_COMPANY_SUFFIX, "").replace(/[\s,.]+$/, "").trim();
  }
  if (brand && brand.toLowerCase() !== original.toLowerCase()) aliases.push(brand);
  const domainBrand = brand.replace(TRAILING_DOMAIN_SUFFIX, "").trim();
  if (domainBrand && !aliases.some((alias) => alias.toLowerCase() === domainBrand.toLowerCase())) aliases.push(domainBrand);
  return aliases.slice(0, 3);
}

function companyClause(companyName: string): string {
  const aliases = publicCompanySearchAliases(companyName);
  return aliases.length <= 1 ? quote(aliases[0] ?? companyName) : `(${aliases.map(quote).join(" OR ")})`;
}

export const MAX_PUBLIC_ROLE_TERMS = 5;

/** Tavily guidance: keep search queries under roughly 400 characters. */
export const MAX_TAVILY_QUERY_LENGTH = 380;

type PeopleQueryInput = {
  companyName: string;
  providerTitles: readonly string[];
  locations?: readonly string[];
};

function dedupeTitles(providerTitles: readonly string[]): string[] {
  const seen = new Set<string>();
  return providerTitles.filter((title) => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_PUBLIC_ROLE_TERMS);
}

function locationClause(locations?: readonly string[]): string | null {
  const unique = [...new Set((locations ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 3);
  return unique.length ? `(${unique.map(quote).join(" OR ")})` : null;
}

function assemblePeopleQuery(company: string, roles: readonly string[], location: string | null): string {
  return [company, `(${roles.join(" OR ")})`, ...(location ? [location] : [])].join(" ");
}

/** One bounded role-union query for Google/Bright SERP. Requested location is always retained. */
export function buildPublicPeopleRoleUnionQuery(input: PeopleQueryInput): string | null {
  const titles = dedupeTitles(input.providerTitles);
  if (!titles.length) return null;
  return [
    "site:linkedin.com/in",
    assemblePeopleQuery(companyClause(input.companyName), titles.map(quote), locationClause(input.locations))
  ].join(" ");
}

/** Tavily-safe query: no Google operators; include_domains already restricts to linkedin.com. */
export function buildTavilyPeopleQuery(input: PeopleQueryInput): string | null {
  const titles = dedupeTitles(input.providerTitles);
  if (!titles.length) return null;
  const company = companyClause(input.companyName);
  const location = locationClause(input.locations);
  // ponytail: drop role variants once the safe length limit would be exceeded; the first role is always kept.
  const roles: string[] = [];
  for (const title of titles) {
    const candidate = quote(title);
    if (roles.length > 0 && assemblePeopleQuery(company, [...roles, candidate], location).length > MAX_TAVILY_QUERY_LENGTH) break;
    roles.push(candidate);
  }
  return assemblePeopleQuery(company, roles, location);
}

/** Deterministic Tavily continuation plan: one broad union, then strongest titles individually. */
export function buildTavilyPeopleQueryPlan(input: {
  companyName: string;
  providerTitles: readonly string[];
  locations?: readonly string[];
  maxQueries: number;
}): string[] {
  const limit = Math.max(1, Math.floor(input.maxQueries));
  const seen = new Set<string>();
  const titles = input.providerTitles.map((title) => title.normalize("NFC").replace(/\s+/g, " ").trim())
    .filter((title) => {
      const key = normalizeTitle(title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const combined = buildTavilyPeopleQuery(input);
  if (!combined) return [];
  const plan = [combined];
  for (const title of titles) {
    if (plan.length >= limit) break;
    const query = buildTavilyPeopleQuery({ ...input, providerTitles: [title] });
    if (query && !plan.includes(query)) plan.push(query);
  }
  return plan.slice(0, limit);
}
