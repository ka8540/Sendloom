import { describe, it, expect, vi } from 'vitest';
import { BrightDataGoogleSearchProvider, BrightDataSearchError, getOrganicResultUrl } from './brightdata-google-search-provider';
import { canonicalizeLinkedInProfileUrl } from './linkedin-profile-url';

const provider = () => new BrightDataGoogleSearchProvider('sanitized-key', 'sanitized-zone');
describe('Bright Data Google adapter', () => {
  it('maps organic rows into the existing abstraction', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ organic: [{ link: 'https://np.linkedin.com/in/foo', title: 'Jane Doe', description: 'Public snippet', global_rank: 1 }] }));
    expect(await provider().search('raw query')).toEqual([{ url: 'https://np.linkedin.com/in/foo', rawUrl: 'https://np.linkedin.com/in/foo',
      urlSource: 'DIRECT', displayedUrl: null, title: 'Jane Doe', snippet: 'Public snippet' }]);
  });
  it.each([
    [{ link: 'https://www.linkedin.com/in/link-person' }, 'https://www.linkedin.com/in/link-person'],
    [{ url: 'https://www.linkedin.com/in/url-person' }, 'https://www.linkedin.com/in/url-person'],
    [{ href: 'https://www.linkedin.com/in/href-person' }, 'https://www.linkedin.com/in/href-person'],
    [{ target_url: 'https://www.linkedin.com/in/target-person' }, 'https://www.linkedin.com/in/target-person']
  ])('normalizes a known provider URL field from %j', (row, expected) => {
    expect(getOrganicResultUrl(row)).toMatchObject({ rawUrl: expected });
  });
  it('resolves the actual Bright Data /goto CAES shape through one manual Google hop', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ organic: [{ link: '/goto?url=CAESopaque', title: 'Jane Doe', description: 'Software Engineer at Acme' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://us.linkedin.com/in/jane-doe?trk=result' } }));
    expect(await provider().search('query')).toEqual([{ url: 'https://us.linkedin.com/in/jane-doe?trk=result', rawUrl: '/goto?url=CAESopaque',
      urlSource: 'GOOGLE_REDIRECT', displayedUrl: null, title: 'Jane Doe', snippet: 'Software Engineer at Acme' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('https://www.google.com/goto?url=CAESopaque');
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
  });
  it('does not request redirect-shaped URLs on any non-Google host', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ organic: [{ link: 'https://evil.example/goto?url=CAESopaque', title: 'Unsafe wrapper' }] }));
    expect(await provider().search('query')).toMatchObject([{ url: 'https://evil.example/goto?url=CAESopaque', urlSource: 'DIRECT' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps a missing organic URL as a countable rejected row', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ organic: [{ title: 'Jane Doe', description: 'Software Engineer' }] }));
    expect(await provider().search('query')).toEqual([{ url: '', rawUrl: null, urlSource: 'DIRECT', displayedUrl: null,
      title: 'Jane Doe', snippet: 'Software Engineer' }]);
  });
  it.each([1, 2, 3, 10])('encodes query once and uses start offset for page %i', async page => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ organic: [] }));
    const query = 'site:linkedin.com/in "A & B" ("Software Engineer" OR "Software Developer")';
    await provider().search(query, { page });
    const [endpoint, options] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(options!.body as string); const url = new URL(body.url);
    expect(endpoint).toBe('https://api.brightdata.com/request');
    expect(options).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer sanitized-key', 'Content-Type': 'application/json' } });
    expect(body).toMatchObject({ zone: 'sanitized-zone', format: 'raw' });
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: query, start: String((page - 1) * 10), hl: 'en', gl: 'us', pws: '0', udm: '14', brd_json: 'json' });
    expect(url.searchParams.has('num')).toBe(false);
  });
  it.each([[401, 'AUTHENTICATION'], [403, 'AUTHENTICATION'], [429, 'TRANSIENT'], [500, 'TRANSIENT'], [503, 'TRANSIENT'], [400, 'HTTP']])('sanitizes HTTP %i', async (status, kind) => {
    vi.mocked(fetch).mockResolvedValue(new Response('private-provider-payload', { status: Number(status) }));
    await expect(provider().search('query')).rejects.toMatchObject({ kind, message: 'Web search request failed.' });
  });
  it.each(['not json', '{}', '{"organic":null}', '{"organic":{}}', '{"organic":[{}]}'])('rejects malformed provider content %s', async payload => {
    vi.mocked(fetch).mockResolvedValue(new Response(payload));
    await expect(provider().search('query')).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE' });
  });
  it('distinguishes genuine exhaustion', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ organic: [] }));
    expect(await provider().search('query')).toEqual([]);
  });
  it('sanitizes transport failures', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('sanitized-key private URL'));
    await expect(provider().search('query')).rejects.toEqual(new BrightDataSearchError('TRANSIENT'));
  });
  it('fails closed without configuration', async () => {
    await expect(new BrightDataGoogleSearchProvider('', '').search('query')).rejects.toMatchObject({ kind: 'CONFIGURATION' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['www', 'np', 'in', 'uk'])('canonicalizes locale host %s', locale => {
    expect(canonicalizeLinkedInProfileUrl(`https://${locale}.linkedin.com/IN/FOO/?tracking=x#about`)).toEqual({ linkedinUrl: 'https://www.linkedin.com/in/foo', sourceProfileId: 'foo' });
  });
  it('does not fetch outside bounded pages', async () => {
    expect(await provider().search('query', { page: 11 })).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
});
