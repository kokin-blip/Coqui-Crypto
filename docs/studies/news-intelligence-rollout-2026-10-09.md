# News Intelligence rollout — 2026-10-09

Implementation branch: `feature/news-intelligence-phase4`, stacked on Phase 3 commit `4d7d3090141978f609f140717ea3ace9bd82a33e`. This report distinguishes local implementation from review, merge, release and prospective operational evidence. Cost remains $0.

## Reused infrastructure

Existing TypeScript packages, Zod 4, Vitest, canonical JSON/SHA-256, injected clocks, SQLite migrations/backups, immutable evidence, quota journals, fenced wallet scheduler, OS SecretStore and redacting diagnostics. Parquet uses the existing ephemeral DuckDB lifecycle. Desktop uses existing typed IPC, centralized query/refetch and terminal components. Research reuses ridge-system solving, cost hashing, conservative venue fees and modeled fills; existing registered study behavior is preserved.

## Implementation and versions

Migration 91, `news_analysis_chunks_v1`, adds `news_analysis_chunks_v1` and `news_cached_analyses_v1`. Chunk manifests record configuration/registry identity, observation IDs and actual completion/persistence times. Both tables reject updates/deletes; cache rows reference original observations. Atomic completed chunks are restart checkpoints. Analysis publication remains a separate atomic batch, so a failed feature publication cannot erase earlier completed work.

`NewsIntelligenceService.advance` processes at most 250 uncached observations per call. `advanceAsync` delegates final clustering/features to a worker with a 60-second execution bound and 256 MiB heap bound. Host integration uses the existing renewable/fenced scheduler, one chunk per minute and at most one completed feature build per UTC hour while active. Main ownership, opt-in settings, suspension, profile preparation and shutdown remain mandatory; aborted/lost-owner completions cannot access closed storage or persist evidence. No network call is part of analysis.

The existing full-history v1 API and its 10,000-revision limit remain. Windowed runs use `news-intelligence-window-v2` and `news-features-window-v2`: input includes articles first available after two days before the current UTC midnight, retaining context for the trailing daily/hourly windows. The active-window limit is 20,000 revisions; cluster pair evidence stays bounded at 50,000 per group. Exceeding bounds fails explicitly. Complete-link grouping within this declared window can differ from a full-history run; versions must not be pooled. Old evidence age outside the window is unknown. Internal sentiment, provider entity scores and publisher hosts remain separate.

Reviewed mappings are stored through existing settings. The CLI can install a mapping but scheduled enablement requires all configured identities to exist and match the registry. No identity is seeded automatically. `news_intelligence_analysis_enabled_v1` defaults false; collection settings remain unchanged.

## Archives and point-in-time research

`news:archive` reads eligible SQLite evidence and writes allowlisted metadata, runs, cached/run analyses, chunk manifests, clusters and features to Parquet. Export rejects metered-provider content. No bodies, headers, request URLs or credentials are exported. Directory and semantic hashes, file bytes, strict payload schemas and manifests are checked before reading. Bounds: 100,000 records and 10,000 runs/chunks per explicit export; excess fails. Exports use temporary directories and atomic rename; replay verifies an existing immutable destination.

Market archives additionally support exact UTC hourly spot intervals. Daily readers filter daily intervals explicitly; daily archive hashes/schema remain compatible. `archive:hourly` accepts reported, complete Coinbase hourly rows and a checksummed source manifest. It does not generate hourly values from daily bars or fetch new data automatically. Source manifest shape: sourceId, interval `1h`, rawContentHash of the exact input JSON bytes, and manifestHash of JSON.stringify of all remaining manifest fields in their supplied order. Source acquisition must retain its genuine candle provenance.

`research:news` verifies supplied news/market archives and freezes source hashes, dataset hash, feature IDs, feature/specification version, code revision and cost identity. One feature version is allowed per study. Features require actual availability by each decision and a maximum age of two cadence intervals. Reconstructions are excluded. Predictor market bars require completion, retrieval and Coinbase's five-minute completion delay before decisions. Future entry prices/outcomes are labels, never predictors; missing horizon bars are excluded. Gaps and duplicate canonical market intervals cannot become fabricated observations.

The fixed baseline uses last-interval, 24-hour and seven-day returns plus 24-hour/seven-day volatility. News adds log syndication-group counts, instrument tone and explicit missing-tone flags, publisher-host count, event-category counts and a news-missing flag. Provider sentiment is excluded from internal tone predictors. Ridge regularization is 1; standardization is fit on training data only. Chronological windows are 120/60/30 elapsed days, with a 24-hour purge and embargo. Calibration reports fixed-model error; no hyperparameter selection occurs. All BTC/ETH/SOL coverage requirements must pass before evaluation.

Reports distinguish prediction MSE/directional accuracy from a nonoverlapping, long-or-cash, fixed-$1,000-notional modeled replay. The replay uses the existing conservative taker profile, separate spread/slippage/fees and no estimated depth impact (explicit zero in the cost manifest). This is a diagnostic replay, not a new registered strategy, promotion gate or claim of executable alpha. Missing/insufficient prospective history returns no evaluations. Backfill cannot satisfy prospective history. No automatic research job runs.

## Desktop and contracts

New validated channels: `news.timeline` (maximum 100 observations), `news.detail` (maximum 100 analysis revisions/six feature snapshots), `news.health`, `news.analysis.set-enabled`. Historical reads enforce observation and analysis availability. Main-only enablement validates mapping readiness. No credentials or request payloads reach the renderer.

Events retains local event import/timeline and adds news with unresolved candidates, instrument tone and availability/provenance. Settings → Diagnostics shows request health and opt-in analysis. Research shows read-only study status. Coverage is unknown, never inferred complete; publisher diversity is not independent corroboration. GDELT attribution remains visible.

## Local live evidence

Main: `/Users/kokinmartinez/Library/Application Support/@coqui/desktop/coqui.db`.

- Normal migration backup: `coqui.db.pre-migration-v89-1791587383392.bak`, 127,979,520 bytes. Main upgraded from 89 through 90/91.
- One naturally due GDELT attempt returned `degraded / invalid_response`; no article was retained. The quota journal records two current-day reservations (one transport-success, one earlier failure); transport success does not establish valid article ingestion.
- Restart preserved next slot `1791588600000` (2026-10-09 23:30 UTC); no forced extra poll or clock change.
- At the next naturally due 23:30 UTC slot, GDELT timed out; zero observations remain. Usage became 3 reserved / 1 transport success / 2 failures, with next slot 1791590400000 (2026-10-10 00:00 UTC). Restart again preserved it. No further validation poll was forced.
- Marketaux/Currents: `credentials_unavailable` on both checks, zero requests and zero retained articles. No enrollment or account creation.
- Main lacks all three required Coinbase spot registry identities. Canonical resolution against retained live news therefore remains unvalidated; scheduled analysis remains disabled.
- An actual empty-operational-snapshot research report was generated without network requests: `data/research-archive/news-reports/2235fb24b1b96da5c1fa7043d639de06d889c5ea0f92ec4e1df0c29dfc37cc12/report.json`. All four studies report `insufficient_evidence / no_eligible_prospective_news`, with zero prospective rows. This is diagnostic evidence, not a verified live archive or a successful research result.

Metered retention rights remain unresolved: [Currents FAQ](https://currentsapi.services/en/faq), [Marketaux terms](https://www.marketaux.com/tos). [GDELT](https://gdeltproject.org/about.html) attribution: GDELT Project — https://www.gdeltproject.org/.

## Commands and recovery

Build first. Supply existing databases and reviewed configuration explicitly:

```sh
pnpm news:analyze --database EXISTING_DB --configuration REVIEWED_JSON --incremental --install-mapping
pnpm news:archive --database EXISTING_DB --output ARCHIVE_ROOT --code-revision EXACT_REVISION
pnpm archive:hourly --input HOURLY_ROWS_JSON --source-manifest SOURCE_MANIFEST_JSON --output ARCHIVE_ROOT --code-revision EXACT_REVISION
pnpm research:news --news-archive VERIFIED_NEWS_DIRECTORY --market-archive VERIFIED_MARKET_DIRECTORY --output REPORT_ROOT --code-revision EXACT_REVISION
```

Repeat archive flags for multiple verified datasets. For a genuinely empty existing operational news database, `research:news --database EXISTING_DB --output REPORT_ROOT --code-revision EXACT_REVISION` records only an insufficient-evidence diagnosis. A nonempty database requires verified exports before evaluation.

On interrupted analysis, rerun with the same reviewed configuration; completed chunks survive. On interrupted export, retain SQLite and remove only abandoned hidden temporary directories after verifying no writer owns them. Never edit content-addressed manifests or immutable evidence. Verify backups before restoring; restore with the matching schema/application and preserve current evidence separately. Unsupported downgrade must not rewrite a migrated database.

## Verification and delivery gates

Verification results, CI links, draft PR and release-candidate outcomes are appended below as they complete. Existing PR #8 targets `p5-shell-and-ui`; #9 targets Phase 1/2. Phase 4 remains stacked until review and acceptance. COQ-19/20/21 gates remain open; COQ-22 tracks this rollout. No merge or release approval is inferred from successful tests.

Windows CI root cause was `ERR_UNSUPPORTED_ESM_URL_SCHEME`: harness imports used Windows drive paths instead of file URLs. macOS terminal smoke needed React control readiness and completed native fullscreen transitions; [Electron documentation](https://www.electronjs.org/docs/latest/api/browser-window) requires waiting for native fullscreen events on macOS. Assertions remain intact, with existing bounded timeouts.

### Verification evidence

- Full `pnpm verify`: 262 files / 1,764 tests passed, including golden backtest, secret leakage and architecture boundaries. The final archive provenance/packaged-worker verification also passed at the same 262 files / 1,764 tests. Follow-up typed IPC integrity and keyboard harness changes receive targeted/type/lint checks.
- Targeted rollout/host verification: 21 tests passed, including 10,001 observations across 41 persisted chunks, concurrent host fencing, worker cancellation, restart, immutable evidence and actual availability cutoffs.
- Archives reconcile exported observation counts against SQLite, preserve abandoned temporary exports, validate the full evidence graph and reject missing observation/run/chunk/cluster/baseline references. Metered exports fail before writing files.
- macOS Electron smoke: all assertions passed. Performance: 220 ms warm shell, 8.4 ms interaction p75; deliberate 250 ms renderer blocking produced 250.5 ms p75 and was detected. The unchanged baseline harness also stalled in the control run when background frame throttling was enabled. Disabling background throttling for this benchmark retains original budgets and sensitivity assertions.
- A stable beta.16 macOS package passed the SQLite/migration packaged gate at schema 91. An earlier concurrent-build artifact failed ASAR integrity (every sampled file was shifted one byte); rebuilding from stable compiled inputs fixed it. Do not build or edit package inputs concurrently with packaging.
- The packaged gate now additionally loads the shipped news worker with empty synthetic inputs. PR CI uses existing release packaging commands on macOS/Windows and uploads candidate installers plus SHA-256 manifests without creating a tag or publishing.
- Six synthetic Events/Settings/Research layouts use the existing terminal design, with dark/compact and high-contrast 200% zoom. Native Enter-key expansion and overflow assertions are included in the capture harness. See [screenshots](../design/screenshots/news-rollout-2026-10-09/).
- Required generated behavior manifests are retained. Existing registered research identities and historical evidence are not rewritten to match them; existing exact-identity gates continue to apply.

### Changed modules

Core adds deterministic news study/dataset construction and reuses the existing ridge solver and cost model. Contracts add strict archive/IPC/chunk schemas and v2 run/feature compatibility. Storage appends migration 91 and adds immutable chunks, active-window reads, provenance-checked content-addressed news archives and genuine hourly archive intervals. Services add incremental off-thread processing and reviewed opt-in settings. Desktop wires fenced Main-only analysis, bounded IPC and Events/Settings/Research views. Scripts provide explicit analysis/export/hourly-import/research commands, portable harness paths and CI artifact checks. Tests update current schema inventories and cover the new behavior. Release notes and this report preserve recovery, provider-rights, prospective-evidence and human-review gates.

No existing daily archive format, RSS event behavior, trading policy or research registration was replaced. No live strategy consumes news. Beta.16 remains a candidate until exact-head CI, both packaged checks, downloadable checksums and human stack review pass.
