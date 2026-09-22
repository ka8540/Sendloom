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
 * Strict trusted-company URL boundary for provider targeting. Person profiles,
 * jobs, posts, search URLs, credentials, ports, and extra path segments are
 * rejected. Locale LinkedIn hosts are normalized to the canonical public host.
 */
export function canonicalizeLinkedinCompanyUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
    if (!/^(?:www\.|[a-z]{2,3}\.)?linkedin\.com$/i.test(parsed.hostname)) return null;
    const match = /^\/(company|school|showcase)\/([^/]+)\/?$/i.exec(parsed.pathname);
    if (!match) return null;
    const kind = match[1].toLowerCase();
    const slug = decodeURIComponent(match[2]).normalize("NFC").toLowerCase();
    if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return null;
    return `https://www.linkedin.com/${kind}/${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
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
