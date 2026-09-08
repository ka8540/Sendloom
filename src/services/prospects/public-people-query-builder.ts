import { normalizeTitle } from "./prospect-normalization";

function quote(value: string): string {
  return `"${value.normalize("NFC").replace(/["\\\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}"`;
}

const TRAILING_COMPANY_SUFFIX = /(?:[\s,.]+(?:incorporated|inc|l\.l\.c|llc|limited|ltd|corporation|corp|company|co|gmbh|plc|llp|lp|sa|ag|pty))\.?\s*$/i;
const TRAILING_DOMAIN_SUFFIX = /\.(?:com|co|io|ai|net|org)\s*$/i;

/** Generic search aliases keep the legal name while also allowing its public brand form. */
export function publicCompanySearchAliases(companyName: string): string[] {
  const original = companyName.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!original) return [];
  const aliases = [original];
  let withoutLegalSuffix = original;
  while (TRAILING_COMPANY_SUFFIX.test(withoutLegalSuffix))
    withoutLegalSuffix = withoutLegalSuffix.replace(TRAILING_COMPANY_SUFFIX, '').replace(/[\s,.]+$/, '').trim();
  if (withoutLegalSuffix && withoutLegalSuffix.toLowerCase() !== original.toLowerCase()) aliases.push(withoutLegalSuffix);
  const withoutDomainSuffix = withoutLegalSuffix.replace(TRAILING_DOMAIN_SUFFIX, '').trim();
  if (withoutDomainSuffix && !aliases.some(alias => alias.toLowerCase() === withoutDomainSuffix.toLowerCase())) aliases.push(withoutDomainSuffix);
  return aliases.slice(0, 3);
}

function companyClause(companyName: string): string {
  const aliases = publicCompanySearchAliases(companyName);
  if (aliases.length <= 1) return quote(aliases[0] ?? companyName);
  return `(${aliases.map(quote).join(' OR ')})`;
}

export function buildPublicPeopleSearchQuery(input: { companyName: string; jobTitle: string; location?: string | null }): string {
  return ['site:linkedin.com/in', companyClause(input.companyName), quote(input.jobTitle),
    ...(input.location?.trim() ? [quote(input.location)] : [])].join(' ');
}


export const MAX_PUBLIC_ROLE_TERMS = 5;

/** The existing provider plan is already ranked and family-filtered, with exact roles first. */
export function buildPublicPeopleRoleUnionQuery(input: {
  companyName: string;
  providerTitles: readonly string[];
}): string | null {
  const seen = new Set<string>();
  const titles = input.providerTitles.filter(title => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_PUBLIC_ROLE_TERMS);
  if (!titles.length) return null;
  return `site:linkedin.com/in ${companyClause(input.companyName)} (${titles.map(quote).join(" OR ")})`;
}
