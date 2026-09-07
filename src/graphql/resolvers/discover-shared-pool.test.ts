import { it, expect } from 'vitest';
import { ProspectSearch } from './prospect-search';
import { createFakePrisma } from '@/services/prospects/__test-utils__/fake-prisma';
import type { GraphQLContext } from '@/graphql/context';
import type { ProspectSearch as Search } from '@prisma/client';
it('reports growth in the shared pool while allocated peopleCount remains ten', async () => {
  const db = createFakePrisma(); const context = { user: { id: 'owner' }, prisma: db } as unknown as GraphQLContext;
  const search = { id: 'search', userId: 'owner', cacheFingerprint: 'pool', totalProcessed: 10 } as Search;
  db._state.discoverCache.push({ id: 'cache', fingerprint: 'pool', expiresAt: new Date(Date.now() + 86400000),
    providerNextPage: 2, providerPagesFetched: 1, providerExhausted: false, publicExpansion: {}, lastProviderFetchAt: new Date() });
  for (let page = 1; page <= 4; page++) {
    db._state.discoverCachePeople.push(...Array.from({ length: 10 }, (_, i) => ({ cacheId: 'cache', sourceProfileId: `${page}-${i}` })));
    Object.assign(db._state.discoverCache[0], { providerNextPage: page + 1, providerPagesFetched: page });
    expect(await ProspectSearch.sharedPool(search, {}, context)).toMatchObject({ readyPeopleCount: page * 10,
      providerNextPage: page + 1, providerStart: page * 10, providerPagesFetched: page });
    expect(await ProspectSearch.peopleCount(search, {}, context)).toBe(10);
  }
  expect(JSON.stringify(await ProspectSearch.sharedPool(search, {}, context))).not.toMatch(/sourceProfileId|fingerprint/);
});
it('does not expose another user pool through a forged parent', async () => {
  const context = { user: { id: 'owner' } } as unknown as GraphQLContext;
  expect(await ProspectSearch.sharedPool({ userId: 'other', cacheFingerprint: 'private' } as Search, {}, context)).toBeNull();
});
