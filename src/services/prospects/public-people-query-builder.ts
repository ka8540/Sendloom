import { normalizeTitle } from "./prospect-normalization";

function quote(value: string): string {
  return `"${value.normalize("NFC").replace(/["\\\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}"`;
}
export function buildPublicPeopleSearchQuery(input: { companyName: string; jobTitle: string; location?: string | null }): string {
  return ['site:linkedin.com/in', quote(input.companyName), quote(input.jobTitle),
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
  return `site:linkedin.com/in ${quote(input.companyName)} (${titles.map(quote).join(" OR ")})`;
}
