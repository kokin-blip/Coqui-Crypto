# P4 service completion audit

**Audited:** 2026-08-10  
**Evidence baseline:** `pnpm verify` green at 99 test files / 583 tests before this audit  
**Authority:** current Coqui worktree plus the owner-supplied predecessor under `.migration-source`  
**Not authority:** an upstream or online Nautilus source tree

This audit prevents a core helper, adapter, repository, or plan note from being mistaken for a
completed application service. A handler is **covered** only when a typed service boundary exists,
its safety behavior is tested, and the inventory points to that boundary. An existing lower-layer
primitive is **groundwork**, not completion.

## Reconciled aliases

Fifteen previously unlabelled `Adapt` rows are already covered by tested P4 services:

| Handler group | Authoritative service evidence | Test evidence |
|---|---|---|
| `PORTFOLIO_VIEW` | `PortfolioReadModelService.portfolioView` | `tests/portfolio-read-models.test.ts` |
| `LOT_ADD`, `ASSET_LOTS`, `LOT_REMOVE` | `PortfolioLedgerService` | `tests/portfolio-ledger-service.test.ts` |
| `ALLOCATION_VIEW` | `PortfolioReadModelService.allocationView` | `tests/portfolio-read-models.test.ts` |
| `ALLOCATION_SAVE_TARGETS` | `PortfolioAllocationPolicyService.savePolicy` | `tests/portfolio-allocation-policy-service.test.ts` |
| `TAX_VIEW`, `RECORD_SALE`, `TAX_PREVIEW` | `PortfolioTaxService` | `tests/portfolio-tax-service.test.ts` |
| `PERFORMANCE_VIEW` | `PortfolioSnapshotEvidenceService.performance` | `tests/portfolio-snapshot-evidence.test.ts` |
| `WALLET_LIST`, `WALLET_ADD` | `AccountsProfileService` | `tests/accounts-profiles-service.test.ts` |
| `WALLET_REMOVE` | preview, backup, and confirmed deletion services | `tests/accounts-profile-deletion-preview.test.ts`, `tests/accounts-profile-backup.test.ts`, `tests/accounts-profile-deletion.test.ts` |
| `WALLET_SYNC` | `AccountsProfileRefreshService` | `tests/accounts-profile-refresh.test.ts` |
| `PROFILE_AUTOMATION_STATUS` | `WalletSchedulerService.automationStatuses` | `tests/wallet-scheduler-service.test.ts` |

The handler inventory now says `Implemented` for these aliases. No new runtime behavior is inferred
from the audit.

After the reconciliation, four Coinbase connection rows were completed by
`CoinbaseConnectionService`: `COINBASE_STATUS`, `COINBASE_CONNECT`, `COINBASE_CONNECT_JSON`, and
`COINBASE_DISCONNECT`. `tests/accounts-coinbase-connection.test.ts` proves view-only publication,
duplicate key/portfolio rejection, secret/manifest mismatch status, connect/disconnect rollback,
recovery-required outcomes, cancellation, bounded local JSON parsing, secrecy, and immutability.
`tests/coinbase-permission-probe.test.ts` now covers Coinbase's separately documented Receive
permission and the HTTP cancellation/shutdown/elapsed-budget outcomes.

## Completed after this audit

`COINBASE_SYNC` and `COINBASE_IMPORT_DISCREPANCIES` are now covered by
`CoinbaseAccountSyncService`, `fetchCoinbaseAccountEvidence`, migration 42, and the append-only
Coinbase evidence repository. Accounts and fills are cursor-paginated with bounded page/row counts,
strict exact-decimal and RFC 3339 normalization, exact-duplicate deduplication, conflicting-identity
rejection, cancellation, and stable secret-free failures. `proof_token_required` fails closed rather
than overstating completeness. Provider balances are compared with explicit local remaining lots and
stored as directional discrepancies; no lot, disposal, fill, execution estimate, or synthetic
resolution is created or modified. The profile refresh executor is now bound through an injected
profile-context factory. Tests prove append-only/idempotent persistence, transaction rollback,
immutable provenance across profile duplication, and byte-for-byte tax-lot/disposal isolation.

The Coinbase evidence baseline was 104 test files / 631 tests. The next completed cluster adds
`CATALOG_SEARCH`, `COINS_GET`, `COINS_SET`, and `COINS_SEARCH` through
`DisplayUniverseService`, migration 43, and the hardened Coinbase catalog adapter. Catalog reads are
bounded and cancellable, retain canonical Coinbase mappings, and return injected request/receipt
timing. Selection is an exact ordered profile preference over already-known Coinbase spot identities;
empty is explicit, duplicates and unknown identities fail before mutation, and every real change
appends immutable origin provenance. Tests prove profile isolation/duplication and exact non-mutation
of point-in-time research snapshots.

The predecessor audit also corrected the `WATCHLIST_*` interpretation: those handlers track
attributed public blockchain addresses, not coins. They remain queued until chain-address,
attribution, and observation provenance can be modeled without importing balances or implying that
an attribution is verified.

`SETTINGS_GET` and `SETTINGS_SET` are now covered by `AccountSettingsService` and migration 44.
Accounts owns only profile presentation preferences: theme, density, motion, and language. Defaults
are explicit and secret-free; a partial patch collects every invalid field in deterministic input
order before consulting time or storage, then atomically merges a valid patch. Unknown fields and
all predecessor financial, tax, provider, strategy, venue-cost, and advisor settings are rejected as
unknown or cross-domain rather than silently dropped or clamped. Profile isolation, duplication,
clock rollback, storage rollback, deep immutability, and preservation of predecessor settings are
covered by tests.

The current verified baseline is 108 test files / 657 tests. Of the 76 `Adapt` inventory rows, 53
now have tested P4 service coverage and 23 remain.

## Genuine remaining P4 gaps

Twenty-three `Adapt` rows still lack a complete service boundary:

| Capability cluster | Handler rows | Existing groundwork | Missing proof |
|---|---|---|---|
| Reference market queries | `MARKET_PRICES`, `FEAR_GREED`, `COIN_CANDLES`, `MARKETS`, `TRENDING`, `YIELDS`, `NEWS_VIEW` | public provider adapters, normalized provider snapshots, decision-dataset services | bounded display-query contracts with provenance, freshness, stable failures, and explicit non-signal status |
| CoinGecko optional connection | `COINGECKO_STATUS`, `COINGECKO_CONNECT`, `COINGECKO_DISCONNECT`, `COINGECKO_RESEARCH_SYNC` | scoped secret store and authenticated reference adapter | secret-safe connection service and persisted observed-time reference-feature ingestion |
| Portfolio planning utilities | `DCA_PLAN`, `CONTRIBUTION_PLAN`, `HARVEST_VIEW` | pure contribution and harvest core functions | strict service validation, explicit assumptions, pricing provenance, stable failures, immutable results |
| Portfolio maintenance and derived display | `ASSET_REMOVE`, `DASHBOARD_MOVERS` | lot service and priced holdings view | auditable non-cascading asset removal and provenanced mover derivation |
| Public-address watchlist | `WATCHLIST_GET`, `WATCHLIST_ADD`, `WATCHLIST_REMOVE` | predecessor chain/address validation and public-balance adapters | profile-scoped attributed-address state, chain-specific canonicalization, bounded observation evidence, explicit unverified attribution, and strict separation from holdings |
| CSV import | `CSV_IMPORT` | strict pivot parser and manual-lot persistence | bounded service orchestration, explicit canonical resolver, file fingerprint, all-or-nothing or row-outcome contract |
| Research read models | `RESEARCH_RUNS`, `RESEARCH_JOB_LIST`, `RESEARCH_JOB_GET` | persisted runs/jobs, hashes, registered study execution | bounded sanitized views, content verification, stable reason codes, no raw worker errors |

## Dependency-ordered queue

1. **Market-data display query facade and optional CoinGecko connection.** Reuse the hardened HTTP
   boundary while keeping reference data informational and provenance-bearing.
2. **Public-address watchlist evidence.** Build on the display pricing facade and explicit public
   chain observation sources; never project watched balances into holdings or claim attribution.
3. **Portfolio planner/import wrappers and research read models.** Adapt existing lower-layer
   primitives into strict application contracts before transport.

P3 remains blocked, the final holdout remains unopened, strategy defaults remain unvalidated, and
P5 IPC/`CoquiClient`/renderer work does not begin until the remaining P4 service gaps are closed or
explicitly re-phased with a documented reason.
