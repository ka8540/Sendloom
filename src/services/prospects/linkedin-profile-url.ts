export type LinkedInProfileIdentity = { linkedinUrl: string; sourceProfileId: string };
export type LinkedInUrlSource = 'DIRECT' | 'REDIRECT' | 'DISPLAYED';
export type LinkedInUrlRejectionReason =
  | 'missingUrl'
  | 'invalidUrl'
  | 'nonLinkedinHost'
  | 'nonProfilePath'
  | 'redirectDecodeFailed';

export type LinkedInProfileUrlResolution =
  | { ok: true; identity: LinkedInProfileIdentity; source: LinkedInUrlSource }
  | { ok: false; reason: LinkedInUrlRejectionReason };

const GOOGLE_REDIRECT_PATHS = new Set(['/url', '/goto']);
const GOOGLE_DESTINATION_PARAMS = ['q', 'url', 'target_url'] as const;

function usefulString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function isGoogleHost(hostname: string): boolean {
  return /^(?:www\.)?google\.com$/i.test(hostname);
}

function asUrl(raw: string): URL | null {
  try { return new URL(raw); }
  catch {
    if (!raw.startsWith('/')) return null;
    try { return new URL(raw, 'https://www.google.com'); } catch { return null; }
  }
}

/** Recognizes only Google's result redirect endpoints; callers must never request other hosts. */
export function inspectGoogleResultRedirect(raw: unknown): {
  wrapperUrl: URL;
  destination: string | null;
  opaque: boolean;
} | null {
  const value = usefulString(raw);
  if (!value) return null;
  const url = asUrl(value);
  if (!url || !isGoogleHost(url.hostname) || !GOOGLE_REDIRECT_PATHS.has(url.pathname.toLowerCase())) return null;
  for (const param of GOOGLE_DESTINATION_PARAMS) {
    const destination = usefulString(url.searchParams.get(param));
    if (!destination) continue;
    if (/^https?:\/\//i.test(destination)) return { wrapperUrl: url, destination, opaque: false };
    return { wrapperUrl: url, destination: null, opaque: true };
  }
  return { wrapperUrl: url, destination: null, opaque: true };
}

function identityFromUrl(url: URL): LinkedInProfileUrlResolution {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
    return { ok: false, reason: 'invalidUrl' };
  if (!/^(?:www\.|[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname))
    return { ok: false, reason: 'nonLinkedinHost' };
  const match = /^\/in\/([^/]+)\/?$/i.exec(url.pathname);
  if (!match) return { ok: false, reason: 'nonProfilePath' };
  let slug: string;
  try { slug = decodeURIComponent(match[1]).normalize('NFC').toLowerCase(); }
  catch { return { ok: false, reason: 'invalidUrl' }; }
  if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return { ok: false, reason: 'nonProfilePath' };
  return { ok: true, source: 'DIRECT', identity: {
    linkedinUrl: `https://www.linkedin.com/in/${encodeURIComponent(slug)}`,
    sourceProfileId: slug
  } };
}

function displayedUrl(value: unknown): string | null {
  const raw = usefulString(value);
  if (!raw) return null;
  const normalized = raw.replace(/\s*›\s*/g, '/').replace(/^https?:\/\//i, '').replace(/^\/+/, '');
  if (!/^(?:www\.|[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(normalized)) return null;
  return `https://${normalized}`;
}

function resolveOne(raw: string, source: LinkedInUrlSource): LinkedInProfileUrlResolution {
  const redirect = inspectGoogleResultRedirect(raw);
  if (redirect) {
    if (!redirect.destination) return { ok: false, reason: 'redirectDecodeFailed' };
    const destination = asUrl(redirect.destination);
    if (!destination) return { ok: false, reason: 'redirectDecodeFailed' };
    const result = identityFromUrl(destination);
    return result.ok ? { ...result, source: 'REDIRECT' } : result;
  }
  const url = asUrl(raw);
  if (!url) return { ok: false, reason: 'invalidUrl' };
  const result = identityFromUrl(url);
  return result.ok ? { ...result, source } : result;
}

/** Strict, path-based public person identity. Never used as a profile fetch target. */
export function resolveLinkedInProfileUrl(raw: unknown, displayed: unknown = null): LinkedInProfileUrlResolution {
  const value = usefulString(raw);
  if (value) {
    const primary = resolveOne(value, 'DIRECT');
    if (primary.ok) return primary;
    const fallback = displayedUrl(displayed);
    return fallback ? resolveOne(fallback, 'DISPLAYED') : primary;
  }
  const fallback = displayedUrl(displayed);
  return fallback ? resolveOne(fallback, 'DISPLAYED') : { ok: false, reason: 'missingUrl' };
}

export function canonicalizeLinkedInProfileUrl(raw: unknown): LinkedInProfileIdentity | null {
  const result = resolveLinkedInProfileUrl(raw);
  return result.ok ? result.identity : null;
}
