# Discover person-name normalization

Implementation and automated verification are complete on
`fix/discover-person-name-normalization`, based on fetched `origin/master`
commit `7f5f70d`. Worktree: `/private/tmp/sendloom-person-name-normalization`.
The original working directory and its uncommitted files were left untouched.
Nothing was merged into master or deployed.

## Root cause

The legacy deterministic parser classified an unknown credential as a complete
surname; its incomplete-identity AI fallback therefore never ran. Cache reuse
could bypass normalization, and email regeneration could keep an old guess when
its domain, pattern and confidence still matched despite a corrected name.
The old token handling also did not safely establish international name ordering.

## Architecture and OpenAI

`normalizeDiscoverPersonNames` is the canonical boundary. Conservative plain names
skip AI. Suspicious names are grouped into requests of up to 50 using the existing
`OpenAiProspectClient`, Responses strict JSON schema, Zod/domain validation,
`PROSPECT_AI_MODEL` defaults, and the existing person-identity budget where supplied.
Batching shares a request across a candidate page instead of issuing one request
per person. Calls have a 30-second timeout, `store: false`, and no web-search tools.
Inputs contain temporary IDs, original names and available public role/company
context; no email, requester identity or private outreach data is sent.

The source-bound validated snapshot survives provider ingestion, exact cache,
company-pool derived-cache writes, same-user reuse, Add More, historical reads,
export/Add to Imports, legacy cache backfill, and company-format regeneration.
Format-refresh normalization happens before its database transaction; concurrent
new names fail safely until they can be processed in another batch.

Output validation rejects untraceable tokens, invented transliterations, known
credentials/descriptors, contradictory context, malformed/duplicate/missing IDs
and inconsistent removed/name components. Unicode and legitimate name punctuation
are retained. Only high-confidence complete components can authorize inference;
non-Latin characters are never silently discarded to produce a partial ASCII name.
Unknown semantics still depend on the model's confidence and response validation.

On failed/invalid AI output, components are empty and inference is disabled. A
safe mononym/Unicode display survives; otherwise the display remains empty rather
than presenting guessed name fields. Original source text remains available.
`--retry-fallback` explicitly retries failed saved decisions. Logs report counts
and safe categories, never source names or model responses.

## Historical repair and migration

Both person tables receive two nullable TEXT columns:
- `sourceName`: preserves the complete source name for validation and retries.
- `nameNormalization`: stores versioned canonical fields, source binding, method,
  name-change state and eligibility; prevents reinterpretation on reuse.

No identity keys, allocation ownership/order or relationships change. The repair
cannot recover source text already discarded before this deployment.

The repair command uses the same production normalizer and email derivation.
It is dry-run by default; `--apply` is required for writes. `--batch-size`,
`--limit` (per store), `--after-person` and `--after-cache` provide bounded keyset
processing. Apply compares `updatedAt` to avoid overwriting concurrent changes.
It does not call Apify, charge Discover quota, create people or alter allocations.
Names that change regenerate only eligible inferred/pattern emails against the
current company format; uncertain names clear unsafe guesses. Verified,
non-pattern and terminal addresses are protected, including suppression records.
Healthy unchanged names retain their emails during the historical repair.
Saved normalization makes subsequent apply/dry-run plans idempotent.

Deploy migration and code first, verify provider/cache results, then run:

```sh
npx tsx scripts/repair-discover-person-names.ts --dry-run --batch-size 50 --limit 1000
```

Review aggregate counts before replacing `--dry-run` with `--apply`. Repeat the
same dry run afterward. The old identities script delegates to this command.

## Verification

- `npm test`: PASS — 188 suites, 2,697 tests. Forty new regression tests cover
  detection, structured validation, batched calls, failure fallback, provider,
  exact/company/local cache reuse, Add More, email safety, both historical stores,
  dry-run/apply and idempotency. Older fixtures were updated for the stricter
  name contract. Test fetch calls are blocked unless explicitly mocked.
- `npm run typecheck`: PASS.
- `npx prisma validate`: PASS with local placeholder environment configuration.
- `npx prisma generate`: PASS, Prisma Client 6.19.3.
- `npx next build`: PASS with Node 22.22.3 and local placeholder configuration.
- `git diff --check`: PASS.
- Live command smoke check (`--dry-run --batch-size 50 --limit 1`): BLOCKED — no
  database server at the checkout's local test address. After disabling Prisma's
  own error logging for this script, it emitted only `{"error":"repair_failed"}`.
  No live scan counts are available and no historical writes were applied.

Production UI/provider/cache verification and live historical repair remain
pending deployment and a configured database. Automated database doubles verify
repair behavior, including preserving identities/allocations, regenerating the
correct surname email, blocking suppression revival and zero second-run changes.

## Files changed

Core services:
- `src/services/prospects/discover-name-contract.ts`
- `src/services/prospects/discover-person-name-normalization.ts`
- `src/services/prospects/discover-person-name-repair.ts`
- `src/services/prospects/discover-person-name-backfill.ts`
- `src/services/prospects/apify-profile-search.ts`
- `src/services/prospects/discover-cache-service.ts`
- `src/services/prospects/discover-expansion-service.ts`
- `src/services/prospects/discover-legacy-cache-backfill.ts`
- `src/services/prospects/prospect-search-service.ts`
- `src/services/prospects/prospect-ai.ts`
- `src/services/prospects/email-generation-service.ts`
- `src/services/prospects/prospect-person-email.ts`
- `src/services/prospects/prospect-export.ts`
- `src/graphql/loaders.ts`
- `src/graphql/resolvers/person.ts`

Schema, operational entry points and documentation:
- `prisma/schema.prisma`
- `prisma/migrations/20260905120000_discover_person_name_normalization/migration.sql`
- `scripts/repair-discover-person-names.ts`
- `scripts/repair-discover-person-identities.ts`
- `README.md`, `DOCUMENTATION.md`, this report

Tests:
- `src/services/prospects/discover-person-name-normalization.test.ts`
- `src/services/prospects/__test-utils__/mock-name-ai.ts`
- `src/services/prospects/apify-profile-search.test.ts`
- `src/services/prospects/discover-cache-service.test.ts`
- `src/services/prospects/discover-expansion-service.test.ts`
- `src/services/prospects/prospect-search-service.test.ts`
- `src/services/prospects/email-generation-service.test.ts`
- `src/graphql/graphql.test.ts`
- `src/test/no-network.ts`, `vitest.config.ts`
