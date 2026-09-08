import { describe, expect, it } from 'vitest';
import { canonicalizeLinkedInProfileUrl, inspectGoogleResultRedirect, resolveLinkedInProfileUrl } from './linkedin-profile-url';

describe('LinkedIn public profile URL resolution', () => {
  it.each([
    'https://www.linkedin.com/in/john-smith',
    'https://linkedin.com/in/john-smith/',
    'http://www.linkedin.com/in/john-smith',
    'https://us.linkedin.com/in/john-smith',
    'https://uk.linkedin.com/in/john-smith',
    'https://www.linkedin.com/in/john-smith/?trk=public_profile#about'
  ])('accepts and canonicalizes %s', raw => {
    expect(canonicalizeLinkedInProfileUrl(raw)).toEqual({
      linkedinUrl: 'https://www.linkedin.com/in/john-smith', sourceProfileId: 'john-smith'
    });
  });

  it.each([
    ['https://www.linkedin.com/company/amazon', 'nonProfilePath'],
    ['https://www.linkedin.com/jobs/view/123', 'nonProfilePath'],
    ['https://www.linkedin.com/search/results/people/', 'nonProfilePath'],
    ['https://example.com/in/john-smith', 'nonLinkedinHost'],
    ['not a url', 'invalidUrl'],
    [null, 'missingUrl']
  ])('rejects %s as %s', (raw, reason) => {
    expect(resolveLinkedInProfileUrl(raw)).toEqual({ ok: false, reason });
  });

  it.each(['q', 'url', 'target_url'])('extracts a LinkedIn destination from Google %s wrapper', param => {
    const destination = 'https://www.linkedin.com/in/john-smith?trk=google';
    const raw = `https://www.google.com/url?${param}=${encodeURIComponent(destination)}&sa=t`;
    expect(resolveLinkedInProfileUrl(raw)).toEqual({ ok: true, source: 'REDIRECT', identity: {
      linkedinUrl: 'https://www.linkedin.com/in/john-smith', sourceProfileId: 'john-smith'
    } });
  });

  it('recognizes an opaque relative Google redirect without pretending it can decode it', () => {
    expect(inspectGoogleResultRedirect('/goto?url=CAESopaque')).toMatchObject({ destination: null, opaque: true });
    expect(resolveLinkedInProfileUrl('/goto?url=CAESopaque')).toEqual({ ok: false, reason: 'redirectDecodeFailed' });
  });

  it('uses an unambiguous displayed profile URL only as a fallback', () => {
    expect(resolveLinkedInProfileUrl('/goto?url=CAESopaque', 'linkedin.com › in › john-smith')).toEqual({
      ok: true, source: 'DISPLAYED', identity: { linkedinUrl: 'https://www.linkedin.com/in/john-smith', sourceProfileId: 'john-smith' }
    });
    expect(resolveLinkedInProfileUrl('', 'LinkedIn › john-smith')).toEqual({ ok: false, reason: 'missingUrl' });
  });
});
