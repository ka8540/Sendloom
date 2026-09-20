import { normalizeCompanyName, normalizeDomain } from "@/services/prospects/prospect-normalization";

export type CanonicalCompanyIdentityInput = {
  linkedinCompanyUrl?: string | null;
  linkedinUrl?: string | null;
  officialWebsiteDomain?: string | null;
  officialDomain?: string | null;
  normalizedName?: string | null;
  name?: string | null;
};

export function normalizeLinkedinCompanySlug(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const match = url.match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Stable, tenant-local company identity used by Discover persistence. A
 * normalized official domain wins because display names such as "Walmart" and
 * "Walmart Inc." are aliases, while similar names on different domains are not.
 * A trusted LinkedIn company slug is the fallback only when no official domain
 * exists. Name fallback is reserved for companies that genuinely have neither.
 */
export function getCanonicalCompanyKey(input: CanonicalCompanyIdentityInput): string {
  const domain = normalizeDomain(input.officialWebsiteDomain ?? input.officialDomain ?? null);
  if (domain) {
    return `domain:${domain}`;
  }

  const linkedinSlug = normalizeLinkedinCompanySlug(
    input.linkedinCompanyUrl ?? input.linkedinUrl
  );
  if (linkedinSlug) {
    return `linkedin:${linkedinSlug}`;
  }

  const normalizedName = normalizeCompanyName(input.normalizedName ?? input.name ?? "");
  return `name:${normalizedName || "unresolved"}`;
}
