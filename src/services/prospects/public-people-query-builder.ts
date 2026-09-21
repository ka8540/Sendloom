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

/** One bounded role-union query. Requested location is always retained. */
export function buildPublicPeopleRoleUnionQuery(input: {
  companyName: string;
  providerTitles: readonly string[];
  locations?: readonly string[];
}): string | null {
  const seen = new Set<string>();
  const titles = input.providerTitles.filter((title) => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_PUBLIC_ROLE_TERMS);
  if (!titles.length) return null;
  const locations = [...new Set((input.locations ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 3);
  return [
    "site:linkedin.com/in",
    companyClause(input.companyName),
    `(${titles.map(quote).join(" OR ")})`,
    ...(locations.length ? [`(${locations.map(quote).join(" OR ")})`] : [])
  ].join(" ");
}
