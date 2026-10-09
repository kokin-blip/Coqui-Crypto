# News Intelligence Phase 3 — internal research intelligence

Phase 3 extends the existing news evidence pipeline on `feature/news-intelligence-phase3`,
stacked on `feature/news-intelligence` at `2848497`. It does not activate desktop
analysis, make network requests, trigger research jobs, influence trading or change
RSS behavior. Phase 1/2 remain subject to their existing draft-PR review gates.

## Algorithms and contracts

`news-intelligence-v1` records reviewed configuration, registry evidence, all input
observation revision IDs and actual completion/persistence times. Strict Zod schemas
validate configurations and all stored/read outputs; bidirectional TypeScript checks
keep schemas compatible with the core domain. The existing canonical JSON/SHA-256,
Clock, SQLite transaction/migration/backup and immutable evidence conventions are reused.
Storage adds only an existing-workspace dependency on contracts for runtime validation;
no external dependency or database lifecycle is introduced.

The initial reviewed universe is BTC/Bitcoin, ETH/Ethereum and SOL/Solana, mapped
explicitly to existing Coinbase spot registry entries. Registry base assets must match
configuration; missing entries remain unresolved. This command never seeds instruments.
Mutable registry rows updated after a requested input cutoff are excluded. Each run
retains its exact registry snapshot, so later mapping changes cannot rewrite it.

Explicit asset names, crypto-qualified ticker mentions and crypto-classified provider
candidates can resolve. Unqualified symbols, equities, unsupported assets and missing
registry mappings retain candidate/reason evidence. Known similarly named forks/wrapped
assets and explicit quote-currency contexts are excluded conservatively. These rules
are not an exhaustive asset-name ontology.

English sentiment recognizes both English language codes and GDELT’s `English` label. It uses versioned positive/negative vocabularies on clauses containing
an instrument mention. Clauses split on punctuation and `but`, `while`, `whereas`.
Multi-asset clauses, negation, conflicting signs, unsupported/missing language and
insufficient directional evidence return null. Positive/negative scores are +1/-1
rule outputs, not calibrated probabilities or a financial-language model. Provider
entity sentiment and raw relevance, including relevance above one, remain separate.
The existing deterministic market-event taxonomy is reused without its research-trigger
service. Changes to rules/aliases/normalization require a new algorithm version.

`news-syndication-v1` groups canonical URL identities conservatively:

- Exact NFKC/lowercase/punctuation-normalized titles can match within 24 hours of first
  application evidence availability.
- Approximate titles require at least six tokens, token Jaccard >= 0.85, overlapping
  resolved assets and, when both descriptions exist, description Jaccard >= 0.5.
- Stable article ordering and complete-link grouping prevent similarity-chain merges.
- Provider records on the same URL retain separate observation provenance. A latest
  eligible metadata representative is selected deterministically for cross-URL matching.

Stored cluster snapshots include cutoff, version, member article/observation IDs,
normalized publisher hosts and pairwise match evidence. They are heuristic syndication
groups, not independently verified event identities. Publisher normalization lowercases
hosts and applies only reviewed explicit aliases. No public-suffix or ownership guess
is made; publisher-host diversity does not prove independent reporting.

## Persistence and point-in-time features

Migration **90**, `news_intelligence_analysis_v1`, appends four tables:

- `news_analysis_runs_v1`: versioned input/configuration/registry manifests and actual
  completion/persistence timestamps.
- `news_observation_analyses_v1`: observation-linked resolution, sentiment, event and
  publisher evidence.
- `news_cluster_snapshots_v1`: immutable, cutoff-specific syndication evidence.
- `news_feature_snapshots_v1`: instrument/cadence/window features and provenance links.

Foreign keys, identity constraints, safe timestamps and UPDATE/DELETE rejection triggers
protect evidence. JSON content hashes and schemas are checked on reads. Writes are
atomic, including late failures. Identical inputs/configuration/registry/cutoff replay
the existing run. Different cutoffs or corrections append new runs. Separate overlapping
connections serialize through the existing immediate transaction. A failed run leaves
no partial evidence and can be retried.

Keyset paging reads all eligible revisions in pages of 250. The explicit batch ceiling
is 10,000 revisions; exceeding it fails rather than silently truncating. Older revisions
are needed because a correction received after an hourly/daily boundary must not hide
the revision eligible at that boundary. Revision ordering follows the existing storage
rules. First article availability governs reporting-volume windows; a metadata correction
does not become another new article.

`news-features-v1` builds UTC-aligned hourly and daily snapshots with trailing 1-hour
and 24-hour distinct article/group/publisher counts, instrument sentiment means and
sample counts, separate provider means, per-category group counts and evidence age.
Each syndication group contributes once. Conflicting internal scores within a group
are unknown. Category counts may overlap when copies carry different category evidence.

The 24-hour group-count z-score requires 30 distinct eligible daily baseline snapshots,
excludes the current window and remains null for insufficient history or zero variance.
Baseline IDs, cluster snapshot IDs and missing-data reasons are retained. Quota-journal
coverage diagnostics distinguish pending/succeeded/failed attempts at the cutoff.
First-page polling cannot establish complete coverage: `coverageComplete` is always null.

Features become eligible only at actual analysis persistence, never at publication or
a retrospectively supplied cutoff. The feature boundary describes its aggregation window;
it does not grant availability. Reads require both feature and run availability by the
requested cutoff. Explicit historical reconstructions are marked and excluded from live
point-in-time reads and volume baselines. No old historical trading evidence is rewritten.

## Explicit command

Build first, then run:

```sh
pnpm news:analyze --database EXISTING_DATABASE --configuration REVIEWED_JSON
```

The database must already exist. Opening uses normal migration backups. The configuration
has no secrets and is a strict object, for example (use the actual review timestamp and
only identities verified in the selected registry):

```json
{
  "schemaVersion": 1,
  "reviewedAtMs": 1791504000000,
  "instruments": [
    { "asset": "BTC", "instrument": { "venue": "coinbase", "productId": "BTC-USD", "productType": "spot" } },
    { "asset": "ETH", "instrument": { "venue": "coinbase", "productId": "ETH-USD", "productType": "spot" } },
    { "asset": "SOL", "instrument": { "venue": "coinbase", "productId": "SOL-USD", "productType": "spot" } }
  ],
  "publisherAliases": []
}
```

Optional `--input-cutoff-ms` explicitly reconstructs historical input; optional
`--max-observations` lowers the ceiling. No future cutoff or not-yet-reviewed configuration
is accepted. Output contains only run/count/availability diagnostics, including missing
registry assets and unresolved candidates. Failures use a fixed message and leave no
partial analysis. No URL, payload or credential is logged.

GDELT attribution and the unresolved metered retention rights remain documented in
[the provider report](news-intelligence-providers-2026-10-08.md). No live news was fetched
or production database migrated for Phase 3 validation. Fixtures are synthetic. Existing
GDELT collection and metered retention gates are unchanged; no paid services are used.

## Changed files

New core modules: `packages/core/src/news/{intelligence-types,intelligence,clusters,features}.ts`.
New schemas: `packages/contracts/src/schemas/news-intelligence.ts`.
New storage: migration `v90.ts` and repository `news-intelligence.ts`; existing news
repository gains revision/latest paging. Package export and migration manifests are extended.
New service: `packages/services/src/news/intelligence.ts`.
New command: `scripts/news-analyze.mjs`, with a root package script.
New tests: `tests/news-intelligence{,-storage,-contracts}.test.ts`; existing schema-version
assertions are advanced to 90. Storage’s workspace manifest/reference and lockfile add
contracts. Generated study manifests reflect the expanded source/export graph without
changing research parameters or historical evidence. This report records the implementation.

## Validation and delivery

Final local `pnpm verify` passed: **261 files, 1,750 tests**, typecheck, lint and build.
The **30 new Phase 3 tests** cover contracts, resolution, sentiment, syndication,
source diversity, journal eligibility, baseline requirements, pagination, immutable
storage, rollback, replay, overlapping database connections, reopen and migration
89-to-90 backups/preservation. Existing schema-version assertions were advanced to 90;
all failures introduced during implementation were resolved. No pre-existing local
failure remains in this verification run.

After build/manifest generation, golden backtest, boundaries, secret leakage, secrets
and news-contract compatibility checks passed again: **5 files, 38 tests**. `git diff
--check` passed. A real invocation of `news:analyze` on a temporary synthetic SQLite
database retained one observation/group, six feature snapshots and completed provenance.
Reopen verified the computed +1 English sentiment with no provider score fabricated.
Missing command arguments failed safely with exit 1 before opening a database. The
synthetic database was removed. Network requests: **0**; production database changes: **0**.

Required generated manifests were inspected and retained. Their current source/behavior
identities change with the expanded package export graph; existing study registrations
continue to require their usual identity gates. Research parameters, golden outputs and
historical evidence were not edited.

Delivery is a separate stacked draft PR against `feature/news-intelligence`, tracked in
[COQ-21](https://linear.app/coqui-crypto/issue/COQ-21/news-intelligence-phase-3-instrument-resolution-and-point-in-time).
Review, upstream CI, base-PR acceptance, merge/release and prior live-evidence gates remain
open. The Phase 1/2 baseline macOS focus-smoke failure remains recorded in the activation
report; this implementation does not alter UI behavior or weaken its assertion.
Phase 4 retains DuckDB/Parquet archives, news-versus-baseline backtests and desktop views.
English rules, reviewed alias scope, metadata-only clustering, host diversity, bounded
input size and unknown coverage are explicit limitations. Pair evidence is bounded at 50,000 matches per cluster; oversized groups fail before unbounded pair allocation. Each run is bounded to 30,000 cluster snapshots and six feature snapshots. No prediction claim is made.
