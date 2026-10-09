# News Intelligence Phase 1 — October 8, 2026

## Architecture and scope

The operational foundation uses the existing profile SQLite database. News
Parquet archives and DuckDB research queries are deferred, consistent with
`docs/ARCHITECTURE.md`: SQLite for state, Parquet for history, DuckDB for research.
The existing RSS news/policy feed, IPC channels, UI and market-event fixtures are
unchanged. No provider adapter, credential enrollment, API request, scheduler,
sentiment classifier, research trigger or trading behavior is activated.

Reused infrastructure: readonly TypeScript contracts, Zod 4, injected `Clock`,
canonical JSON and SHA-256, SQLite immediate transactions, forward migrations,
pre-migration VACUUM backups, and immutable evidence conventions. No external
dependency or package dependency edge is added. Core's URL parser is pure; it
performs no network, disk, redirect or clock access.

## Contracts and storage

`packages/core/src/news` contains domain types, validation and exact identity;
`packages/contracts/src/schemas/news.ts` contains strict runtime schemas;
`packages/storage/src/repositories/news.ts` owns persistence;
`packages/services/src/news` validates whole batches and supplies persistence
time. Package indexes export these additive interfaces. Compile-time tests
check schema/domain compatibility without making core depend on contracts.

Migration 88, `news_intelligence_foundation_v1`, adds:

- `news_articles_v1`: canonical URL identity, URL hash and normalization version.
- `news_provider_records_v1`: provider ID/URL-fallback identity and article link.
- `news_observations_v1`: immutable, content-hashed metadata revisions with actual
  receipt and persistence times, plus indexes for bounded historical reads.

All three tables reject UPDATE/DELETE. Constraints enforce provider identities,
foreign keys, unique records/revisions and safe integer timestamps. Earlier
migrations are untouched. Existing schema-version assertions advance to 88.

`NewsStorageService.ingest` accepts 1–250 synthetic observations; persistence is
atomic. `asOf` returns at most 250 records and rejects future cutoffs. Direct
repository entry points also validate input. Reads revalidate hashes and identity.
Entity symbols remain unresolved candidates with provider type/exchange, raw
match score and nullable sentiment. Publication, provider observation, application
receipt and persistence times are separate. Missing publication is allowed;
publisher clock skew does not change eligibility.

Historical reads select the latest eligible revision per provider record, using
both receipt and persistence times. They retain each provider's provenance;
consumers must count distinct article IDs rather than provider observations.
Repeated content, even when received again later, retains its initial stored
revision. Returning to previously seen content does not create another revision.
A provider ID pointing at another canonical URL fails explicitly and rolls back
the entire batch. These are content revisions, not a log of every poll attempt.

Canonicalization removes fragments, `utm_*`, `fbclid` and `gclid`, and sorts query
parameters. It preserves `ref`, `source`, other article identifiers, `www`, path
case, trailing slashes and HTTP/HTTPS. Raw article URLs remain in observations.
Different URLs are never merged by headline or presumed syndication. No full
article bodies, request URLs/headers or arbitrary raw payload fields are stored.

## Provider documentation checked during planning

- [Marketaux documentation](https://www.marketaux.com/documentation):
  `/v1/news/all`, query-string `api_token`, entity-level sentiment −1 to +1;
  example raw match scores exceed 1.
  [Free pricing](https://www.marketaux.com/pricing): 100 requests/day, three articles.
- [Currents search](https://currentsapi.services/en/docs/search): `/v1/search`,
  Bearer authentication, RFC 3339 filters, page pagination; cursors require v2.
  [Pricing](https://currentsapi.services/en/product/price): 250 free requests/day,
  20 results, up to 30 days of history.
  [Quota examples](https://currentsapi.services/en/examples): reset at 00:00 UTC.
- [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/): public
  article-list and raw-volume modes are distinct. Provider timestamps must not
  substitute for application receipt or assumed publisher publication times.
  No unlimited throughput or service guarantee is assumed.

[Currents usage rights](https://currentsapi.services/en/product/price) exclude
long-term archival and customer-facing derivative products from default rights.
[Marketaux terms](https://www.marketaux.com/tos) contain personal-use restrictions;
API retention/deployment rights require clarification.
[GDELT terms](https://gdeltproject.org/about.html) permit dataset use with attribution,
without conferring rights to publishers' article bodies. Phase 1 uses entirely
synthetic fixtures; it does not establish retention permission for live feeds.

## Acceptance and next phase

Tests cover strict schemas, raw scores, nullable metadata, URL identity, fixture
replay, provider provenance, ID conflicts, corrections, rollback, restart,
profile isolation, immutable rows, integrity failures, migration backup and
historical cutoffs across UTC midnight.

Final `pnpm verify` passed: TypeScript checks, ESLint, **254 test files / 1,674
tests**, and study-manifest generation plus TypeScript build. The new suites
contain 32 tests. The full run includes golden backtest, secret-leak sweep,
keychain, migration, reference feed, profile lifecycle and boundary checks.
`git diff --check` also passed. No remaining pre-existing failures were observed.

At Phase 1 completion, the implementation was local and uncommitted on `feature/news-intelligence`,
based on `ade88e3991b47fba00512adecf3c409518346a56`; it had not been pushed, merged
or released. Only temporary test databases were migrated. At that point application databases
would apply migration 88 through the existing backup/migration runner on their
next normal open. No API credentials were enrolled, read, committed, logged,
stored in news records or exposed through frontend/IPC code; tests use explicitly
synthetic secret strings. No live API call or paid service activation occurred.

Tracked as [COQ-19](https://linear.app/coqui-crypto/issue/COQ-19/news-intelligence-phase-1-canonical-contracts-and-point-in-time-sqlite),
In Review in the existing Prospective studies and data integrity milestone.
Issue and milestone progress comments record local completion and preserve
human-review, release and prospective-evidence gates.

The existing build regenerates `docs/studies/behavior-manifests-v1.json` and
`packages/core/src/research/study-manifests.generated.ts`. Their dependency graph
walks package exports, so the additive news modules change generated source
identities even though strategy behavior is unchanged. No historical registration,
study result or elapsed evidence is rewritten or credited against the new hashes.
Existing prospective registrations must pass their normal exact-identity gates
before accepting evidence from this revision.

### File inventory

Created:

```text
packages/core/src/news/types.ts
packages/core/src/news/identity.ts
packages/core/src/news/validation.ts
packages/core/src/news/index.ts
packages/contracts/src/schemas/news.ts
packages/storage/src/migrations/v88.ts
packages/storage/src/repositories/news.ts
packages/services/src/news/service.ts
packages/services/src/news/index.ts
tests/fixtures/news/observations.ts
tests/news-contracts.test.ts
tests/news-storage.test.ts
docs/studies/news-intelligence-foundation-2026-10-08.md
```

Modified:

```text
packages/core/src/index.ts
packages/contracts/src/index.ts
packages/storage/src/migrations/index.ts
packages/storage/src/repositories/index.ts
packages/services/src/index.ts
tests/storage-migrations.test.ts
tests/storage-canonical-assets.test.ts
tests/storage-portfolio-repository.test.ts
tests/portfolio-snapshot-evidence.test.ts
tests/accounts-profiles-service.test.ts
tests/accounts-profile-backup.test.ts
tests/accounts-profile-comparison.test.ts
tests/accounts-profile-duplication.test.ts
tests/service-dependencies.test.ts
docs/studies/behavior-manifests-v1.json
packages/core/src/research/study-manifests.generated.ts
```

At Phase 1 completion, Phase 2 required explicit instruction: implement the three providers with
fixture normalization; extend the existing HTTP client and keychain storage;
reserve quota before every network attempt including automatic retries; persist
UTC counters and cooldowns; use fenced scheduling; resolve provider retention
permissions before persistent live collection. Multi-profile quotas must follow
credential/account scope rather than assume each profile has an independent
allowance. Keep GDELT volume retrieval separate from article results. Do not
purchase or activate paid services. Phase 1 costs $0.

Subsequent authorization to continue produced the local Phase 2 implementation.
See [provider and quota report](news-intelligence-providers-2026-10-08.md) for its
verification, file inventory, limits and remaining acceptance gates.

The combined Phase 1/2 delivery and authorized development database activation
are recorded in [the completion report](news-intelligence-activation-2026-10-08.md).
Earlier verification and activation statements above describe the Phase 1 checkpoint.
