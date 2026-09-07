# Bright Data public people pool

Use Node 22.x. Set these server-only values in the local environment:

```dotenv
DISCOVER_PEOPLE_PROVIDER=public_search
WEB_SEARCH_PROVIDER=brightdata_google
BRIGHTDATA_API_KEY=<your key>
BRIGHTDATA_SERP_ZONE=<your SERP zone>
DISCOVER_PUBLIC_MAX_PAGES=10
DISCOVER_PUBLIC_MAX_RESULTS=100
```

Keep the existing local `DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY`, and normal
Sendloom configuration. Neither Bright Data credential is a browser variable.
The existing `PROSPECT_AI_ENABLED` and identity-call budget still apply.

A local migration, `20260907010000_discover_public_pool`, adds shared expansion
JSON and location provenance. It must be applied to an explicitly local test/dev
database before running this feature. No database migration was executed as part
of implementation. Do not run `npm run build` to validate: it deploys migrations.

Run the existing application, `npm run worker`, and `npm run scheduler` as separate
Node 22 processes. The worker consumes `discover-public-pool` jobs; the scheduler
recovers incomplete pools, including a request dying after a DB commit but before
enqueue. A Vercel request alone does not keep the worker running.

Initial Discover checks the shared processed cache and existing company pool,
then private reusable people, before calling Bright Data. Eligibility applies the
existing role-family/location policy, corrections and suppression. A partial
pool resumes its saved page. One lock-held page is processed and committed at a
time. Once enough eligible people exist, the request uses the existing allocation
and email materialization paths; the queued continuation is not awaited.

The worker uses the same provider adapter, public employment validator, batched
name/location normalizer and extracted existing email builder. Full pages contain
10 organic rows; deterministic rejection/deduplication can leave smaller AI
batches. Every normalization call has at most 10 candidates. Names and locations
share one structured AI request when needed. Clean names have a deterministic
fallback. Model output must match its temporary IDs, names must pass the existing
name contract, and geography must occur literally in compact snippet evidence.
Absent geography can fall back only to one requested country, never a requested
city/state. Explicit contrary countries fail closed. Historical snippet sections
are excluded from current-location evidence.

Pagination uses `start=0,10,...,90`, never `num=100`. Stored raw counts and canonical
profile IDs bound the crawl; empty/no-new-URL pages and configured caps stop it.
Ten pages do not promise 100 unique or valid people. LinkedIn locale hosts resolve
to the same case-normalized `/in/<slug>` identity. Names are never identity keys.
Later explicit former/contradictory evidence is retained as a denial in the shared
expansion state. Denied identities are filtered from reuse.

Redis owner-token leases renew while a page is processed. A request that cannot
acquire the lease fails with retryable generic discovery behavior instead of
running unlocked. Ownership is checked before committing. BullMQ deduplicates by
fingerprint; database unique keys and append deduplication protect retries.
Previously committed people survive provider failures. As with any remote API,
a crash after a successful remote response but before the DB commit can repeat
that page on retry; exactly-once external billing cannot be guaranteed.

Add More keeps its existing API and allocation grants. It selects stored unseen
eligible people first. It resumes expansion only for a deficit. A complete cached
Bright Data pool does not re-run automatic email-format discovery; a manual format
still takes precedence in materialization. Existing verified email and corrected
metadata are preserved by the existing merge/email rules.

The pre-existing provider implementations/tests remain available for compatibility;
`brightdata_google` does not call Playwright, You.com, or Apify. No live Bright Data,
OpenAI, Redis-worker or PostgreSQL integration test is required by the unit suite;
provider calls use sanitized fixtures and the repository's network-blocking setup.

## Local verification record

Node v22.23.2, sanitized test configuration, no live provider calls:

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Bright Data provider/pool and job tests | 64 | 0 | 0 |
| Focused Discover/prospect tests | 999 | 0 | 1 |
| Full npm test | 2926 | 0 | 1 |

`npm run typecheck -- --incremental false` passed. The skipped test is the explicit
opt-in Chromium fixture test. `git diff --check` passed. Local Prisma client
code was generated; no migration, build, production action, push or merge ran.
The service-level tests use the existing in-memory Prisma fixture and injected
locks. They verify orchestration and persistence behavior, not a live Redis or
PostgreSQL cluster. A live local worker/database smoke test remains to be done
after the local migration is applied and the worker/scheduler are started.

## Files changed by this implementation

Paths below are relative to `~/Documents/sendloom-public-people-discovery`.
Pre-existing changes in other files were preserved.

- `.env.example`
- `BRIGHTDATA_PUBLIC_POOL.md`
- `prisma/migrations/20260907010000_discover_public_pool/migration.sql`
- `prisma/schema.prisma`
- `src/lib/env.ts`
- `src/lib/queue.ts`
- `src/services/prospects/apify-profile-search.ts`
- `src/services/prospects/brightdata-google-search-provider.test.ts`
- `src/services/prospects/brightdata-google-search-provider.ts`
- `src/services/prospects/brightdata-public-pool.test.ts`
- `src/services/prospects/build-discover-dataset-people.ts`
- `src/services/prospects/discover-cache-service.ts`
- `src/services/prospects/discover-existing-person.ts`
- `src/services/prospects/discover-expansion-service.ts`
- `src/services/prospects/discover-name-contract.ts`
- `src/services/prospects/discover-person-name-normalization.ts`
- `src/services/prospects/discover-public-pool-job.test.ts`
- `src/services/prospects/discover-public-pool-job.ts`
- `src/services/prospects/linkedin-profile-url.ts`
- `src/services/prospects/prospect-discovery-provider.ts`
- `src/services/prospects/prospect-search-service.test.ts`
- `src/services/prospects/prospect-search-service.ts`
- `src/services/prospects/public-pool-eligibility.ts`
- `src/services/prospects/public-pool-page.ts`
- `src/services/prospects/public-profile-location.ts`
- `src/services/prospects/public-profile-search.ts`
- `src/services/prospects/web-search-provider.ts`
- `src/workers/scheduler.ts`
- `src/workers/worker.ts`

## Automatic background follow-up fix

The previous code already enqueued a BullMQ job after the first provider batch,
consumed it in `src/workers/worker.ts`, and recovered jobs in the separate
scheduler. `npm run dev` starts only Next.js. Inspection during this investigation
found one `next dev` process and zero worker/scheduler processes. This is not a
Vercel cron dependency. The old Add More code also called `fillPublicPool` directly
for a deficit, which could mask the missing consumer.

The two observed `peopleCount` fields measure user-owned allocations, not the
shared pool. Their staying at 30 does not prove the shared cache stayed at 30.
Do not change those fields to expose/allocate global people automatically.

### Start locally

Keep the dev server command from the request. In a SECOND terminal:

```sh
cd ~/Documents/sendloom-public-people-discovery
nvm use 22
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to the local test database}"
DATABASE_URL="$TEST_DATABASE_URL" \
DATABASE_URL_UNPOOLED="$TEST_DATABASE_URL" \
PROSPECT_GRAPH_ENABLED=true \
GRAPHQL_GRAPHIQL_ENABLED=true \
DISCOVER_PEOPLE_PROVIDER=public_search \
WEB_SEARCH_PROVIDER=brightdata_google \
npm run worker:discover
```

Use the same local Redis configuration as the dev server. The command loads
Next's `.env` files before importing environment-dependent services and preserves
explicit shell overrides. It requires the existing Bright Data key/zone, and
uses the configured OpenAI settings. It runs only the discovery consumer, not
campaign delivery or other workers. It includes startup and one-minute recovery,
so no additional scheduler or Vercel cron is needed for this command. Keep this
long-lived process running. The existing general worker uses the same consumer.

The worker logs `WORKER_STARTED`, `JOB_STARTED`, and then a record after each DB
commit, for example:

```text
[discover-background] {
  page: 3, providerStart: 20, providerResults: 10,
  linkedinCandidates: 10, uniqueCandidates: 8,
  processed: 8, stored: 8, poolSize: 27, exhausted: false
}
```

Counts may grow by fewer than ten after validation/deduplication. A final
`JOB_COMPLETED` means the worker reached its bounded target or exhaustion. Failures
emit safe event codes, retain completed batches, and retry from the saved cursor.

### Observe with Postman

Use the same authenticated GraphQL endpoint/session as the initial request:

```graphql
query DiscoverProgress($id: ID!) {
  prospectSearch(id: $id) {
    id
    status
    peopleCount
    company { id peopleCount }
    sharedPool {
      readyPeopleCount
      providerNextPage
      providerStart
      providerPagesFetched
      providerExhausted
      lastProviderFetchAt
    }
  }
}
```

Poll with the search ID, without sending Add More mutations. Watch
`sharedPool.readyPeopleCount` grow beyond ten and `providerStart` advance through
10, 20, 30, etc. `providerStart` is the NEXT offset; after all ten pages it is 100
and `providerExhausted` is true, so offset 100 will not be fetched. The search and
company allocation counts stay unchanged until Add More. A search that already
allocated 30 should continue to report 30 while its shared pool grows.

Add More now returns `PENDING`, zero added people, and a preparation message if
fewer than ten unused records exist and the provider is still open. It enqueues
(or reuses) the fingerprint job and does not call Bright Data or OpenAI, allocate
people, or reserve quota on that pending path. Retry with the same idempotency key
after the pool grows. If the provider is exhausted it allocates the remaining
smaller batch. The UI shows the preparation message instead of a no-more-results
dialog. Complete stored batches remain immediate allocation operations.

No new queue system or migration was introduced for this follow-up. Tests cover
the long-lived consumer/recovery loop, READY-before-enqueue ordering, pending
allocation/retry, per-commit progress, ownership of the new status field, and the
existing cursor/deduplication/batch/exhaustion behavior. A separate opt-in test uses
a disposable Redis UNIX socket, in-memory Prisma fixtures, and mocked provider
responses to verify actual BullMQ dispatch and duplicate job IDs without touching
the application's queue or making live provider calls.

### Follow-up verification (Node v22.23.2)

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Focused expansion/queue/consumer tests | 71 | 0 | 0 |
| Discover/public-search tests | 903 | 0 | 1 |
| Full npm test | 2932 | 0 | 2 |
| Separate disposable Redis consumer test | 1 | 0 | 0 |

Typecheck (`npm run typecheck -- --incremental false`) and `git diff --check`
passed. The default suite skips the browser fixture and the opt-in disposable
Redis test; the latter passed separately with real BullMQ/Redis dispatch, a fake
Prisma database, and mocked HTTP responses. No live Citi/Bright Data/OpenAI call,
application Redis operation, database migration, build, push, merge or deployment
was performed. The actual Citi pool should now be checked with the worker command
and the authenticated sharedPool query above.

### Exact files changed in this follow-up

- `BRIGHTDATA_PUBLIC_POOL.md`
- `package.json`
- `src/components/prospects/prospect-detail-view.tsx`
- `src/graphql/resolvers/discover-shared-pool.test.ts`
- `src/graphql/resolvers/prospect-search.ts`
- `src/graphql/schema.ts`
- `src/services/prospects/discover-cache-service.ts`
- `src/services/prospects/discover-expansion-service.test.ts`
- `src/services/prospects/discover-expansion-service.ts`
- `src/services/prospects/discover-public-pool-job.ts`
- `src/services/prospects/prospect-search-service.test.ts`
- `src/services/prospects/prospect-search-service.ts`
- `src/services/prospects/public-pool-page.ts`
- `src/workers/discover-worker.integration.test.ts`
- `src/workers/discover-worker.test.ts`
- `src/workers/discover-worker.ts`
- `src/workers/discover.ts`
- `src/workers/worker.ts`
