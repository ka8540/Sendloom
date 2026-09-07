import { describe, it, expect, vi } from 'vitest';
import { BrightDataGoogleSearchProvider, BrightDataSearchError } from './brightdata-google-search-provider';
import { canonicalizeLinkedInProfileUrl } from './linkedin-profile-url';

const provider = () => new BrightDataGoogleSearchProvider('sanitized-key', 'sanitized-zone');
describe('Bright Data Google adapter', () => {
  it('maps organic rows into the existing abstraction', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ organic: [{ link: 'https://np.linkedin.com/in/foo', title: 'Jane Doe', description: 'Public snippet', global_rank: 1 }] }));
    expect(await provider().search('raw query')).toEqual([{ url: 'https://np.linkedin.com/in/foo', title: 'Jane Doe', snippet: 'Public snippet' }]);
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
    expect(canonicalizeLinkedInProfileUrl(`https://${locale}.linkedin.com/IN/FOO/?tracking=x#about`)).toEqual({ linkedinUrl: 'https://linkedin.com/in/foo', sourceProfileId: 'foo' });
  });
  it('does not fetch outside bounded pages', async () => {
    expect(await provider().search('query', { page: 11 })).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
});
