import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), step: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { discoverSearchCache: { findMany: mocks.findMany } } }));
vi.mock('@/services/prospects/discover-public-pool-job', () => ({
  pendingPublicPoolWhere: () => ({}), publicExpansionEnabled: () => true, runPublicPoolStep: mocks.step
}));
import { GET, POST } from './route';
import { getEnv } from '@/lib/env';
let secret: string | undefined;
beforeEach(() => { secret = getEnv().CRON_SECRET; getEnv().CRON_SECRET = 'test-secret'; vi.clearAllMocks(); });
afterEach(() => { getEnv().CRON_SECRET = secret; });
it.each<Record<string, string>>([{}, { authorization: 'Bearer wrong' }, { 'x-cron-secret': 'wrong' }])('rejects missing/bad credentials', async headers => {
  expect((await GET(new Request('https://sendloom.net/api/cron/discover', { headers }))).status).toBe(403);
  expect(mocks.findMany).not.toHaveBeenCalled();
});
it('fails closed when server secret is missing', async () => {
  getEnv().CRON_SECRET = undefined;
  expect((await GET(new Request('https://sendloom.net/api/cron/discover'))).status).toBe(403);
});
it.each<Record<string, string>>([{ authorization: 'Bearer test-secret' }, { 'x-cron-secret': 'test-secret' }])('processes bounded work with valid credentials', async headers => {
  mocks.findMany.mockResolvedValueOnce([{ fingerprint: 'pool' }]).mockResolvedValueOnce([{ id: 'pool' }]);
  mocks.step.mockResolvedValue({ pagesProcessed: 1, peopleInserted: 6 });
  const response = await POST(new Request('https://sendloom.net/api/cron/discover', { headers }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, processedCaches: 1, pagesProcessed: 1, peopleInserted: 6, remainingWork: true });
  expect(mocks.step).toHaveBeenCalledOnce();
  expect(mocks.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 1 }));
});
it('returns no work and handles failures without leaking details', async () => {
  mocks.findMany.mockResolvedValue([]);
  const request = new Request('https://sendloom.net/api/cron/discover', { headers: { 'x-cron-secret': 'test-secret' } });
  expect(await (await GET(request)).json()).toMatchObject({ ok: true, remainingWork: false, pagesProcessed: 0 });
  mocks.findMany.mockRejectedValue(new Error('secret payload'));
  const response = await GET(request);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('secret');
});
