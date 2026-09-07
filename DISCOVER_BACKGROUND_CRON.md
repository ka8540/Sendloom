# Discover background expansion

Configure the existing cron-job.org service after deploying this change:

- URL: https://sendloom.net/api/cron/discover
- Method: POST (GET is also supported)
- Header: Authorization: Bearer <CRON_SECRET>
- Alternatively: x-cron-secret: <CRON_SECRET>
- Use the existing Vercel server environment secret; never put it in the URL.
- Frequency: every minute. Each successful call handles at most one cache/page.

This uses no Vercel Cron configuration and requires no new worker host or migration.
The route declares a 300-second Vercel execution ceiling to leave room for existing
validation calls to settle. Provider work receives a 45-second abort signal; the
existing validation/classification calls are awaited (not detached), and an aborted
page is never committed. Set the cron-job.org request timeout to the longest value
available for the account. A caller timeout does not mean Vercel stopped executing;
the shared Redis lock protects overlapping calls.

`runPublicPoolStep` is shared by this endpoint and `runPublicPoolJob`, which remains
the consumer used by `npm run worker:discover`. Cron takes only one step; the local
worker repeats steps. Both use the unchanged public page provider, validation,
normalization, email inference and transactional shared-cache persistence.

The DB scan includes unexpired Bright Data pools regardless of READY status, with
providerNextPage <= DISCOVER_PUBLIC_MAX_PAGES, resultCount below
DISCOVER_PUBLIC_MAX_RESULTS, and providerExhausted=false. The upper page bound is
inclusive because providerNextPage names the next page to fetch (11 is complete
when the maximum is 10). Oldest fetched pools get priority.

The existing renewable Redis fingerprint lease coordinates cron, BullMQ workers,
and initial-search expansion. Cron does not wait for a busy lease. Eligibility and
the selected page are checked again under that lease, and ownership is checked
before the existing DB transaction writes people/count/pagination. Failed attempts
can retry an uncommitted provider request; this is not an exactly-once guarantee
against an external provider after a crash. Cache identity dedupe and transactional
pagination make durable retries idempotent.

DiscoverSearchExpansion remains user-specific Add More allocation/quota state; it
is not a shared-pool job lock. Add More reads unused cache rows first and, when short,
uses the same single-page consumer for up to two provider pages before allocating.
It waits up to one second for a busy provider-page lease, re-reads the pool after
every attempt, and reserves quota once after acquiring the lease but before a paid
provider call. DB-only allocations use the same existing reservation.
Cron does not allocate user records or quota.

Response counters describe committed pages. remainingWork includes eligible pools
currently locked by another consumer. Logs use [discover-expansion-cron] and contain
page counters and cache/company identifiers, never credentials or provider payloads.

## Verification

- Public Bright Data Add More tests: 12 passed, covering DB-only allocation,
  on-demand fallback, partial pools, the two-page bound, quota ordering,
  exhaustion, idempotency, terminal limits, dedupe, and cron/worker contention.
- Shared cache, cron route/job, and worker regressions: 54 passed.
- GraphQL route and resolver regressions: 60 passed.
- Real Redis worker integration: passed with a disposable UNIX socket, in-memory
  DB and mocked Bright Data responses.
- Typecheck: passed.
- Broad Discover/provider run: 626 passed, four pre-existing Apify expansion tests
  failed, and the opt-in Redis test skipped there before passing separately. The
  same four failures reproduce on the unchanged pre-Add-More implementation.
