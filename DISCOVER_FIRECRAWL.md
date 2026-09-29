# Firecrawl discovery implementation

The runtime order is permanent Postgres knowledge → Firecrawl → Tavily → Bright Data → Apify. Redis accelerates sanitized public-result reads; permanent people, provider provenance, and continuation live in Postgres. Private allocations remain tenant scoped. Canonical search identity and daily quota reservations are unchanged.

## Verified API contract

Official references reviewed for this implementation:

- [Search endpoint](https://docs.firecrawl.dev/api-reference/endpoint/search)
- [Search feature](https://docs.firecrawl.dev/features/search)
- [Error responses](https://docs.firecrawl.dev/api-reference/errors)

The client sends `POST https://api.firecrawl.dev/v2/search`, `Authorization: Bearer <server key>`, and JSON containing `query`, `limit`, `sources: ["web"]`, `includeDomains: ["linkedin.com"]`, `domainTools: false`, `highlights: false`, and `timeout`. Scraping stays disabled by omitting `scrapeOptions`; no returned URL is fetched. Only `success: true` with `data.web` as an array is accepted. Each usable row contains URL, title, description, and optional position; optional top-level `creditsUsed` is counted. Indexes, exchange tools, contacts, news, images, scrape fields, warnings, and arbitrary error bodies are discarded.

The official API supports limits 1–100, a 500-character query maximum, optional search `location`/`country`, and include/exclude domain filters. Its documented contract exposes no Search pagination/cursor. Sendloom supplies requested geography in the safely quoted query and continues to validate each person's location; search localization is never person evidence. The API's default timeout is 60 seconds; Sendloom uses 30 seconds by default, reduced to the remaining parent budget minus the 5-second cleanup reserve, with parent cancellation composed into the HTTP signal.

## Configuration

```dotenv
DISCOVER_FIRECRAWL_ENABLED=true
FIRECRAWL_API_KEYS=
FIRECRAWL_API_KEY=
DISCOVER_FIRECRAWL_TIMEOUT_MS=30000
DISCOVER_FIRECRAWL_MAX_RESULTS_PER_QUERY=50
DISCOVER_FIRECRAWL_MAX_QUERIES=5
DISCOVER_FIRECRAWL_MAX_QUERIES_PER_ACTION=2
DISCOVER_FIRECRAWL_SCRAPE_RESULTS=false
```

Operational CLI imports use Node’s `react-server` condition for the server-only marker: `npm run prospect:test` supplies it, and direct repair scripts use `tsx --conditions=react-server`.

Credentials are optional for application boot; an unavailable/disabled client allows the existing fallback chain. They are guarded by the Next `server-only` boundary and never stored or logged. Scraping cannot be enabled: `true` fails environment validation. The maximum result setting counts raw search rows, never authorized people.

## Authorized credential pool

One Firecrawl provider can use several authorized credentials. In Vercel, add the server-only variable `FIRECRAWL_API_KEYS` as a comma-separated string, for example `fc-key-one,fc-key-two,fc-key-three` (placeholders only). Whitespace and empty comma entries are ignored; duplicate keys are attempted once. A non-empty pool takes precedence over `FIRECRAWL_API_KEY`. An empty/unset pool falls back to that existing single-key setting. Neither variable needs the other to be configured.

For each query, keys are tried in their configured order. Key A exhausted → key B; key B invalid → key C; key C works → Firecrawl returns normally and stops trying keys. Only HTTP 401/403 (authentication/permission), 402 (documented insufficient credits/billing), and 429 (rate limit) allow another key attempt. Classification uses HTTP status, never arbitrary error-body text. Firecrawl rate limits are shared by all keys on the same team, so a second key on the same workspace does not provide independent rate-limit capacity; the pool supports the authorized workspaces you configure.

There is no sleep or immediate retry of the failed key, including when `Retry-After` is supplied. Another configured key is tried immediately, under one shared Firecrawl timeout and the parent's deadline minus its existing five-second cleanup reserve. Each attempt sends only the remaining timeout. Network errors/timeouts, parent cancellation/deadline, malformed responses, HTTP 400/422, and generic 5xx stop the pool and preserve existing failure behavior. If every eligible key fails, Firecrawl returns one final safe error and the provider chain can fall back to Tavily. The final key's category determines that error; credit exhaustion maps to the existing rate-limit fallback event.

Credential failover is separate from Discover query continuation. Query 2 with key A failing and key B succeeding is still one successful query: the query index and fetched counter advance once, and people persist/allocate once. No credential index is stored in Postgres or Redis, and no new migration is required. Success logs include only numeric `configuredKeyCount`, `keyAttempts`, zero-based `successfulKeySlot`, and `keyFailoverCount`; failover logs add fixed `AUTH`, `RATE_LIMIT`, or `QUOTA` reasons. Logs/errors/results contain no keys, key fragments/hashes, or Authorization headers. Only the successful response's `creditsUsed` is counted; failed attempts are not used to estimate billing.

## Queries and authorization

Firecrawl consumes the existing `DiscoverRoleIntelligenceService.buildProviderTitlePlan`; exact requested roles precede its authorized variants. Each distinct title becomes one query with `site:linkedin.com/in`, the resolved company using shared company-search aliases, and requested location clauses. Inputs use existing escaping and term bounds. Queries exceeding the API's length bound are omitted without truncating company/location constraints. There is no Firecrawl synonym or employer-alias database.

The shared Firecrawl/Tavily metadata validator reuses strict LinkedIn URL canonicalization, `validateCurrentEmployment`, public location extraction, and identity deduplication. The orchestrator normalizes names, classifies titles, and applies existing role/location authorization before persistence. This retains existing policy even when vector intelligence is disabled. Historical/retired evidence, contradictory employers or geography, role-category mismatches, and duplicate identities do not authorize people. Compact employer aliases must already satisfy the existing company policy; an unfamiliar acronym is insufficient evidence.

## Persistence, allocation, and continuation

Every successful query commits all valid unique public people, ordered `FIRECRAWL` membership, and its cursor together in a Postgres transaction. If 25 people validate and the UI requests 10, all 25 persist and only 10 are allocated. Subsequent Add More actions use the remaining 10 and 5 without provider calls. A partial durable batch ends that action; there is no paid top-up.

`DiscoverProviderBatch` stores `firecrawlNextQueryIndex`, `firecrawlQueriesFetched`, and `firecrawlExhausted`. Successful empty/rejected queries advance the index. The provider exhausts only when the bounded generated plan is fully consumed. Caps, cancellation, parent deadlines, transport failures, and persistence failures do not exhaust it. Later explicit Add More starts at the saved index, never zero, after unused durable matching people are consumed. Redis loss, application restarts, or instance replacement cannot reset this state.

Initial background discovery resumes successful partial Firecrawl/Tavily work in additional bounded segments under the same parent deadline until the target is met or the plan is consumed. This fixes the proven partial-results plus action-cap premature-READY path for both providers. A deadline with unfinished work yields a retryable timeout and retains all committed people and progress. Add More intentionally executes one bounded provider action; unfinished continuation belongs to the next explicit click.

Provider switching is state driven. As in the existing provider chain, a successful positive exhausted batch ends that action and is consumed first; a later explicit opportunity proceeds downstream. Exhausted empty results allow immediate fallback. Availability failures also allow fallback while parent budget remains, without consuming or exhausting the failed query. Firecrawl is not retried repeatedly inside the same initial background attempt after falling back.

## Failure categories and costs

Fixed categories are `FIRECRAWL_AUTH_ERROR`, `FIRECRAWL_RATE_LIMIT`, `FIRECRAWL_TIMEOUT`, `FIRECRAWL_MALFORMED_RESPONSE`, and `FIRECRAWL_PROVIDER_ERROR`. HTTP 401/403 map to authentication, 402 credit exhaustion and 429 map to the rate-limit fallback event, and 408/504 to timeout. Invalid JSON/envelopes map to malformed response; non-empty arrays containing only malformed entries fail without advancing. Partially malformed arrays discard unusable entries. A successful empty web array advances normally.

After bounded credential failover, classified Firecrawl availability failures use Tavily for the current action. There is no same-key retry loop or wait. A future explicit opportunity can retry the same Firecrawl query. Parent cancellation stops provider routing. Retries, continuation segments, and fallbacks never reserve another user daily slot.

Structured logs contain fixed event names, query indices, counts, intent/company keys, exhaustion, and credit usage. They contain no names, emails, profile URLs, payloads, keys, or provider-supplied error messages.

## Rollout

Apply migration `20260929010000_discover_firecrawl_provider_chain` before deploying the new code. Existing rows receive zero/false Firecrawl progress and `providerChainVersion=1`; their downstream cursors remain untouched and they skip Firecrawl. New rows default to version 2 and start with Firecrawl. The version is necessary to distinguish a legacy batch from a new batch whose first Firecrawl request failed and temporarily progressed downstream: both otherwise have zero Firecrawl progress. Inferring legacy status from downstream progress would permanently suppress Firecrawl recovery for new batches.

Deprecated `DiscoverSearchCache` tables and fingerprint versions are unchanged. Only whole-chain durable exhaustion can cache an empty intent as definitive, so a single provider's successful empty result cannot suppress downstream continuation.

## Verification

Tests use the existing fake Prisma, injected transports, and role services. They cover contract/limits, no scraping or tools, safe failure categories, company/employment/role/location rejection, canonical identity, cross-provider deduplication, surplus persistence, private allocation, Firecrawl-first order, saved cursors, caps/deadlines, true exhaustion, legacy rollout, Redis flush, Add More 10/10/5 consumption, replay/quota behavior, and automatic Firecrawl/Tavily background continuation.

Run `npm test`, `npm run typecheck`, and `npx prisma validate`. Apply the migration and perform the narrow non-production smoke check from README before production rollout. Fake services cannot verify live search recall, account rate limits, credit billing, or real database transaction timing.
