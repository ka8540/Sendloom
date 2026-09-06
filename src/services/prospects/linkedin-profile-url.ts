/** Strict public person identity. Never used as a server-side fetch target. */
export function canonicalizeLinkedInProfileUrl(raw: string): { linkedinUrl: string; sourceProfileId: string } | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !/^(?:www\.|[a-z]{2}\.)?linkedin\.com$/i.test(url.hostname)) return null;
    const match = /^\/in\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]).normalize('NFC').toLowerCase();
    if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return null;
    return { linkedinUrl: `https://linkedin.com/in/${encodeURIComponent(slug)}`, sourceProfileId: slug };
  } catch { return null; }
}
