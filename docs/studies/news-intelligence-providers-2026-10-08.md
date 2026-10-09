# News Intelligence Phase 2 — free providers and quota governance

Initial provider foundation implemented locally on `feature/news-intelligence`
after explicit instruction to continue. Phase 1
contracts and immutable SQLite article evidence remain the foundation. At that initial checkpoint, no paid service, account creation, credential
enrollment, live request or news-derived trading behavior was activated.
Subsequent host integration and authorized live validation are recorded in
[the completion report](news-intelligence-activation-2026-10-08.md).

## Provider behavior and verified corrections

Official documentation was checked on 2026-10-08:

- [Marketaux documentation](https://www.marketaux.com/documentation) and
  [pricing](https://www.marketaux.com/pricing): `/v1/news/all`, query `api_token`,
  Free 100 requests/day and three articles/response. Preserve actual provider
  symbols (examples use BTCUSD/ETHUSD), entity type/exchange, match scores above
  one, and nullable sentiment. HTTP 402 represents exhausted plan usage; 429
  represents request-rate throttling. Defaults search Bitcoin/Ethereum/Solana.
- [Currents search](https://currentsapi.services/en/docs/search),
  [Free plan](https://currentsapi.services/en/free-news-api) and
  [pricing](https://currentsapi.services/en/product/price): `/v1/search`, Bearer
  authentication, strict RFC3339 filters, v1 page pagination, 250 requests/day,
  20 results/request, UTC midnight reset. Free search permits **seven-day maximum
  spans** within a 30-day history window. This latest-only adapter queries the
  first page, rejects spans over seven days and rejects unresolved symbol filters.
  Default scheduled keywords rotate Bitcoin, Federal Reserve, cryptocurrency
  regulation and stablecoin. It does not fabricate entity sentiment.
- [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/): public
  `/api/v2/doc/doc`, `artlist` articles and `timelinevolraw` raw coverage are
  separate methods. Seen time stays provider metadata, publication remains null.
  Coverage preserves raw counts and normalization denominators, without deriving
  sentiment. Default article search uses a one-day window. Public access is not a
  guaranteed unlimited-capacity contract.

Response parsing allowlists metadata; article bodies and arbitrary raw payloads
never enter storage. Dates require explicit timezones and valid calendar dates.
Invalid responses fail the entire batch. All HTTP errors are stable codes; remote
messages, request URLs, headers, keys and credential fingerprints are omitted
from returned diagnostics. Redirects are prohibited for credential-bearing
requests; responses are bounded to 4 MB (streamed when a body stream is available).

## Persistent quota policy

Migration **89**, `news_provider_quota_v1`, adds `news_api_usage_v1`,
`news_api_controls_v1`, and `news_request_attempts_v1`. It appends migration 88,
uses the existing transaction runner and pre-migration backups, and preserves
immutable article evidence. Attempts move once from reserved to succeeded/failed;
reservations surviving interruption remain spent rather than being refunded.
Only provider, SHA-256 quota scope, UTC day, counters, timestamps, status and
allowlisted reason codes are recorded. Scope fingerprints are internal database
values and never diagnostics.

Runtime defaults reserve headroom: Marketaux **85/day** at **20-minute** polling,
Currents **200/day** at **10-minute** polling, GDELT **72/day** at **30-minute**
polling. GDELT's limit is a local courtesy policy, not a vendor entitlement.
Individual attempts are spaced at least one second for metered APIs and 30
seconds for GDELT. Manual refresh and coverage retrieval share these reservations.

Every retry receives a fresh transactional reservation. Only network/timeouts,
408 and 5xx retry, at most twice, with jitter/backoff and Retry-After. Long waits
become persisted cooldowns rather than occupying a scheduler lease. Auth failures
do not retry. 402/429 stop immediately and persist cooldowns. With no authoritative
reset header, Marketaux 402 waits a conservative 24 hours (its reset timezone is
unverified); Currents 429 waits until UTC midnight; other 429 waits 60 seconds.
Local usage resets at UTC midnight; provider cooldowns survive that reset.

**Host contract:** use Main's existing operational SQLite database for both
article storage and quota authority. Only the authoritative Main desktop/headless
host collects; switching profiles pauses collection. One stable pool per provider
shares limits across credentials and key rotation in this database. Current-day
legacy credential-scope usage and maximum cooldowns are carried forward
transactionally with persisted cursors; original attempt journals remain intact.
Different databases cannot enforce a shared allowance. First-page polling does
not establish complete article coverage.

## Runtime and credentials

`createNewsIntelligenceRuntime` is an opt-in service composition. Providers default
to disabled; construction creates no wake-up loop. An explicitly enabled host
calls `tick()`, reusing `WalletSchedulerService` UTC scheduling, renewable leases,
fencing, and current-only catch-up. Cancellation/destroy abort requests and dispose
scheduling. No desktop IPC, existing RSS feed, research engine or trading behavior
was changed. Main host wiring now drives this runtime through its existing wake-up
loop; news work is independent of paper/execution preparation. Missing credentials isolate the provider without disabling GDELT.

Marketaux and Currents keys extend existing globally scoped OS `SecretStore`
entries. Production uses that store; optional `MARKETAUX_API_TOKEN` and
`CURRENTS_API_KEY` loading is restricted to the explicit development smoke path.
No credentials were enrolled or committed. The completion check found both
metered keychain credentials unavailable, so no metered requests were sent.

Live persistent Marketaux/Currents collection requires explicit host retention
permission, default false. [Currents usage rights](https://currentsapi.services/en/product/price)
exclude long-term archives/customer-facing derivatives from default self-service
rights. [Marketaux terms](https://www.marketaux.com/tos) contain restrictive
personal-use language; API retention rights remain unresolved. GDELT metadata is
permitted by default only after explicitly enabling the provider; downstream use
must include [GDELT attribution](https://gdeltproject.org/about.html), and publisher
content rights are not conveyed. All tests use synthetic fixtures.

`pnpm news:smoke` is disabled by default. After build, an operator can explicitly
request one transient fetch with `--allow-live --database EXISTING_SHARED_DATABASE
--provider marketaux|currents|gdelt`; development environment keys additionally
require `--development-env`. Smoke returns counts/codes only, never article text
or credentials, and always disables article persistence. The supplied operational
DB is upgraded through the normal migration/backup runner. This command was tested only in its default disabled mode at the initial
checkpoint. The completion report records the separate authorized GDELT check.

## File inventory and verification

Created: adapters `http/news.ts`, `news/{common,marketaux,currents,gdelt,index}.ts`,
`config/news-env.ts`; services `news/{quota-governor,runtime}.ts`; storage migration
`v89.ts` and repository `news-quota.ts`; `scripts/news-smoke.mjs`; fixtures
`tests/fixtures/news/providers.ts`; `tests/news-{providers,quota,runtime}.test.ts`;
and this report.

Modified: relevant package exports, `SecretKey`/global scoping, root smoke script,
current-schema expectations in existing migration/profile/portfolio tests, and
build-generated study manifests. No external dependency was added. Generated
provenance changes follow package export dependency graphs; existing historical
study evidence and release gates are preserved.

Initial provider-foundation verification completed:

- `pnpm verify`: typecheck, lint, **257 test files / 1,706 tests**, and build passed.
  Includes the golden backtest, existing boundary/secret suites, all current
  migrations and earlier profile/portfolio checks. No pre-existing failures observed.
- New Phase 2 tests: **3 files / 32 tests** passed; Phase 1 fixtures and point-in-time
  tests continue to pass. Synthetic fixtures only; no actual credentials used.
- `pnpm news:smoke`: default disabled path passed without live collection.
- `git diff --check`: passed. News credential identifiers were checked against
  desktop/UI sources and do not appear there.
- Build-generated manifests inspected and retained. No research behavior or
  historical registration/result was changed.

Tracked as [COQ-20](https://linear.app/coqui-crypto/issue/COQ-20/news-intelligence-phase-2-free-provider-adapters-persistent-quotas-and),
In Review in the existing Prospective studies and data integrity milestone.
Issue and milestone progress comments distinguish local completion from
merge/release and preserve acceptance gates; assignees were not changed.

## Remaining acceptance gates and next phase

Resolve retention rights before metered persistent collection. Main host wiring,
stable account pools and lifecycle integration are implemented. The selected
development database has GDELT enabled; the authorized initial request timed out
and stored no articles. Its next UTC slot survived restart. Both metered
credentials were unavailable. Live ingestion/provenance and metered response
validation therefore remain open, along with human review, CI, merge and release.
GDELT volume points remain transient. Separate installations need a shared quota
authority to enforce one vendor allowance.

Phase 3 requires explicit instruction: canonical instrument resolution,
instrument-specific sentiment, event clustering/source diversity and versioned
point-in-time research features. DuckDB/Parquet and desktop views remain later
phases. Cost stays $0; paid upgrades require explicit instruction.
