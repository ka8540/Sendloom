import { normalizeCompanyName, normalizeDomain } from "@/services/prospects/prospect-normalization";

export type CanonicalCompanyIdentityInput = {
  officialWebsiteDomain?: string | null;
  officialDomain?: string | null;
  emailDomain?: string | null;
  normalizedName?: string | null;
  name?: string | null;
};

/**
 * Stable, tenant-local company identity used by Discover persistence. A
 * normalized official domain wins because display names such as "Walmart" and
 * "Walmart Inc." are aliases, while similar names on different domains are not.
 * Name fallback is reserved for companies that genuinely have no resolved
 * domain yet.
 */
export function getCanonicalCompanyKey(input: CanonicalCompanyIdentityInput): string {
  const domain = normalizeDomain(
    input.officialWebsiteDomain ?? input.officialDomain ?? input.emailDomain ?? null
  );
  if (domain) {
    return `domain:${domain}`;
  }

  const normalizedName = normalizeCompanyName(input.normalizedName ?? input.name ?? "");
  return `name:${normalizedName || "unresolved"}`;
}
