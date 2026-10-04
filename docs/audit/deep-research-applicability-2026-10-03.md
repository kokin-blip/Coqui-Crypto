# Deep-research applicability review — October 3, 2026

## Assessment

The report's strongest recommendation is to finish Coqui's evidence and operational foundations before expanding strategies. Keep the local TypeScript/Electron/SQLite/Parquet/DuckDB architecture, pessimistic costs, canonical venue identity, immutable evidence, and paper-only authority.

The report is useful as a direction, but its backlog should not be adopted verbatim. Several proposed capabilities already exist in the uncommitted working tree. Its Coinbase ML recommendation also misses a material restriction in the provider's published terms.

Scope: read the supplied `deep-research-report (8).md`, inspect the current local implementation and dated acquisition evidence, and check relevant first-party sources. Embedded commands and requests in the report were treated as examples, not execution instructions. This review adds documentation only; it does not change application behavior, acquire data, run studies, alter settings, or revalidate the whole working tree. Existing uncommitted work is preserved. This is an implementation assessment, not a live operational or legal-compliance certification.

## First correction: rights must govern uses, not just downloads

The [Coinbase Market Data Terms](https://www.coinbase.com/legal/market_data), marked August 7, 2026, expressly restrict ML training, validation, and benchmarking absent prior written consent (§3.5). They also restrict external derived-work dissemination (§3.2) and applications for outside end users (§2). The report's blanket designation of Coinbase as a primary ML training source should therefore be withdrawn pending applicable permission. Personal research access does not establish ML rights.

The [Binance dataset terms](https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md) confirm the report's CC BY-NC-SA restriction and separate commercial-license requirement. Local documentation already records this correction. Keep the existing Binance historical research archives; do not delete evidence or infer permission to package it commercially.

Implementation implication: create a versioned use-policy record bound to each terms snapshot, distinguishing internal historical research, ML training/evaluation/inference, operational decision use, redistribution, and external application display. Represent unknown permission separately from permission granted. Software and dataset licenses are separate. The registry should record evidence and policy interpretation rather than pretend to provide a universal legal determination.

Enforce the selected policy at dataset preparation, model-job dispatch, artifact import, and export. A model artifact needs source-use lineage as well as model/data hashes; a terms snapshot alone is not permission. Handle historical artifacts through a new eligibility assessment without rewriting their original manifests or results. Resolve intended-use questions against the applicable agreement before new restricted jobs.

The Coinbase terms page was readable through this review's web tool. That does not prove the acquisition HTTP client can now retrieve and preserve it; the recorded Cloudflare failure remains unresolved until that path succeeds. Do not manufacture a raw snapshot from a web summary.

## Recommendation matrix

| Report recommendation | Current local evidence | Decision and actual remaining work |
|---|---|---|
| Raw capture, SHA-256, parser identity, terms snapshots | `acquisition/artifacts.ts`, `acquisition/run.ts`, and archive writer/reader already implement these | **Extend.** Add structured use permissions, typed snapshot metadata and portable export; retain immutable v1 artifacts. |
| Finish Coinbase BTC/ETH history | October 3 acquisition record reports zero Coinbase rows after terms-page 403 | **P0, with intended-use review.** Resolve official snapshot capture, acquire bounded history, verify coverage and hashes. Other-venue archives cannot repair Coinbase holes. |
| Independent collection scheduler | ML refresh runs outside authoritative paper execution; daily shadow has its own enable flag | **P0, partially done.** Hourly ML refresh still requires an experiment that is not stopped; scheduler tasks execute serially. Introduce independent collection state and bounded scheduling. |
| Data-health dashboard | Acquisition coverage reports, host lifecycle evidence, metrics, and diagnostics exist | **P0.** Consolidate into one operator-visible view with age, coverage, blocked reason, acquisition success/failure, retries, and scheduler gaps. |
| Minimal reproducible BTC/ETH release | Immutable envelopes and verified per-venue Parquet datasets already exist | **P0.** Add a local reproducibility capsule/export using existing formats, not a competing data pipeline. External publication needs its own rights gate. |
| Forecast/calibration metrics | Daily overlay already has Brier, log loss, calibration slope/intercept, buckets, and risk/coverage diagnostics | **Extend.** Surface existing diagnostics; add regression metrics and baseline comparisons where absent. Preserve separate calibration and evaluation partitions. |
| Linear/tree benchmark suite | `overlay/models.ts` already provides bounded ridge and depth-two tree models | **Reuse first.** Evaluate these against naive and simple-rule baselines before adding a Python model stack. HAR/quantile models are later registered challengers. |
| Point-in-time external features | Availability-aware labels/liquidity exist; no general external-feature manifest was found in inspected paths | **P1.** Add a small versioned availability contract and one pre-registered hypothesis at a time. |
| CoinGecko snapshots | Existing reference adapter; current values cannot recreate past ranks/universes | **P1.** Start prospective identity/rank snapshots with immutable retrieval metadata. Retain reference-only status and verify intended-use rights. |
| FRED/ALFRED | Not part of the inspected market foundation | **P1 after foundations.** Build explicit vintages and release-time eligibility, not the report's latest-history example. |
| Fear & Greed | No implementation found in the inspected research path | **Optional P1.** Use as a BTC-oriented experimental input, with attribution and a price/volume ablation. |
| Microstructure recorder | `CoinbaseMicrostructure` is a bounded in-memory display cache; informational-only provenance is explicit | **P1, hypothesis-dependent.** Record bounded summaries if needed for spread/cost diagnostics. Full depth/tape archival is not automatically P0 for daily research. |
| OpenTelemetry | Existing redacted logger and low-cardinality metrics package | **Defer package choice.** Add useful correlation and durable local views first; use OTel only if it closes a demonstrated tracing gap. |
| Evidence inspector / diagnostics export | Existing manifests and diagnostic modules provide a foundation | **P1.** Connect displayed results to dataset, behavior, model, cost and trial identities. Extend existing diagnostics rather than replace them. |
| Accessibility / terminal chunk splitting | Handoff reports unfinished validation/design sync and a chunk warning | **Retain as product work.** Validate on the current tree; source review alone does not establish a visual or interaction defect. |
| Feast, Dagster, second backtester, transformers | No measured need established by this report | **Remove from active backlog / defer.** Avoid adding infrastructure or search degrees of freedom before evidence warrants them. |

## Changes worth implementing first

### 1. Structured source-use eligibility

Targets: `packages/services/src/market-data/acquisition/artifacts.ts`, `run.ts`, `packages/storage/src/archive/types.ts`, decision-dataset preparation, and research dispatch/import/export boundaries.

The current acquisition envelope binds raw files, snapshots, checksums, parser version, configuration hash and retrieval time. Extend that contract instead of rebuilding it. A typed snapshot record should identify the source URL, content hash, actual capture time, document version/effective date when supported, and the reviewed policy version. The current generic snapshot files already preserve URL/time in sidecar metadata; expose that structure to consumers.

Acceptance: a dataset with unknown ML permission cannot be silently used by a model job; an externally restricted dataset cannot enter a distributable capsule; previously captured manifests remain verifiable. Test unknown permission, restricted use, explicit applicable permission, and legacy artifacts.

### 2. Complete a bounded Coinbase archive and local capsule

Targets: acquisition provider orchestration, existing Coinbase importer, Parquet verification, and the current acquisition report.

Start with a bounded BTC/ETH window and prove raw capture, provenance, normalization and repeatable hashes before scanning every date since 2012. Report expected/observed bars and classified missingness per venue. Existing Kraken reporting correctly distinguishes release lag from absent intervals within acquired coverage; make these categories structured rather than only prose.

Coinbase documents missing tick intervals and a 300-candle request ceiling. Missing candles still need an explicit interpretation and eligibility policy; do not fill them from Binance/Kraken or assume every absence proves a harmless no-trade interval. [Official candle documentation](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles).

The capsule should resolve the existing envelope-to-Parquet-to-study chain, include schema/parser/dependency identities, and verify after relocation without needing the original machine's absolute artifact paths. Pin an actual reviewed code identity or artifact hash; a working-tree label is honest but insufficient to reconstruct code by itself. Preserve venue and quote differences, including Binance USDT versus Coinbase/Kraken USD.

Acceptance: a second run reconstructs the same semantic dataset from preserved bytes; tampering fails; coverage shortfalls remain visible; no operational SQLite writes occur in research acquisition.

### 3. Finish collection independence and expose health

Targets: `apps/desktop/src/main/ml-signal-runtime.ts`, `parallel-paper-runtime.ts`, `scheduler-runtime.ts`, and the existing observability/diagnostics paths.

Hourly refresh currently exits when no parallel experiment exists or it is stopped. Separate market acquisition from experiment-specific prediction and paper authority. Collection can continue under explicit collection configuration even while a paper experiment is paused/stopped. Keep trading safety controls authoritative; collection must not re-enable action.

The scheduler awaits parallel paper, preparation, daily overlay and research sequentially. This is operational coupling even where lifecycle ownership has been separated. Give collection bounded work budgets and independent due-state within the existing local scheduler, with non-overlap and cancellation. Do not simply fire every task concurrently or duplicate collection across hosts.

Persist last attempt/success, next due time, data age, outcome, maximum gap and gap resolution. A finished host tick is not proof that every provider task succeeded. Surface the distinction in UI and diagnostic exports.

Acceptance: broker/reconciliation failures and stopped paper experiments cannot suppress enabled collection; a hung provider does not monopolize scheduler work; resume records missed collection slots without fabricating prospective decisions or fills.

### 4. Explain the model that already exists

Targets: `packages/core/src/research/overlay/{models,calibration,development,final,replay}.ts`, research report contracts and renderer evidence views.

Reuse ridge/tree and current diagnostic output. The inspected daily shadow settings emphasize book P&L/costs and artifact state; connect operator-facing evidence to calibration and model activity as well.

Add naive persistence/rolling-mean or base-rate controls appropriate to the target, MAE/RMSE for regression, and differences in proper scoring rules for probabilities. Every score needs target, horizon, number of evaluated forecasts, date range and input identity. Compare on identical eligible observations; report missing predictions and dependence, not just row counts.

The old hourly shadow's identical baseline/overlay returns do not establish *why* it had zero lift. Record model availability, prediction coverage, fallback reasons, changed weights, changed fills, and net incremental costs. Distinguish no predictive information from unused predictions or insufficient decision divergence. The newer daily overlay already exposes fallback coverage and action traces; extend those rather than retrofit meaning into the old study.

Acceptance: an inactive/fallback-only overlay cannot be presented as a meaningful model-performance test; a good forecast cannot bypass cost-aware economic and untouched prospective evidence gates.

## What to apply later, and what to correct

**Point-in-time features:** distinguish economic observation time, provider publication/vintage time, local first-seen time, retrieval time and decision eligibility. Historical candles acquired today can support retrospective research under declared completion assumptions, but cannot become observed-forward evidence. For new external features, never invent historical local first-seen times.

**FRED:** the report's request omits vintage parameters, which default to today's real-time period. It therefore obtains information about history as currently known. Specify vintage selection and conservative intraday release handling; a calendar `realtime_start` date alone is not a precise timestamp proving availability before a crypto decision. [FRED real-time-period documentation](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html).

**Fear & Greed:** the provider describes Bitcoin-oriented inputs, including 25% volatility and 25% momentum/volume. The report overstates its independence from price-only signals. Require an ablation against the already available price/volume features and do not assume it generalizes to ETH. The provider permits commercial use with attribution beside displayed data. [Provider methodology and API rules](https://alternative.me/crypto/fear-and-greed-index/).

**CoinGecko:** prospective daily snapshots are useful for identity and survivorship analysis; querying today's ranks does not recover historical eligibility. Current pricing confirms Demo quotas, but the pricing table distinguishes commercial licensing from Demo access. A free key is not a blanket rights grant. [CoinGecko pricing](https://www.coingecko.com/en/api/pricing).

**DefiLlama:** optional only after an explicit hypothesis and applicable-use review. Its public terms restrict commercial harvesting and republication. It is not a required foundational dependency. [Provider terms](https://defillama.com/terms).

**Existing alternative-data plan:** the market-foundation document already proposes GDELT and Ethereum activity studies. Do not append FRED, sentiment, news, on-chain and DeFi streams into one simultaneous feature expansion. Select one hypothesis by provenance, availability and incremental information; register its full search budget before evaluation.

**HAR/quantile models:** useful possible challengers, not automatic additions. Define what realized volatility means with available sampling; daily close-to-close data is not interchangeable with an intraday realized-volatility target. Add scikit-learn only at the bounded research boundary when a registered experiment actually requires it.

## Remove or avoid

- Remove gross-return display from the proposed metric list. `CLAUDE.md` prohibits it. Show net returns and separate fees/spread/slippage/impact attribution; internal gross labels do not justify gross performance claims in UI.
- Do not copy the report's Python acquisition pipeline into Coqui. It bypasses the established adapter/envelope architecture, uses float-normalized prices, heuristically infers Binance timestamp units, and does not establish vintage/availability correctness for all features. Borrow concepts, preserve Coqui's exact canonical representation and provider-specific timestamp policy.
- Do not add Pandera merely to duplicate existing TypeScript validators. Consider generated research schemas if Python interchange creates a real validation gap.
- Do not replace the authoritative engine, weaken costs, reopen consumed holdouts, relabel failed studies, or add ML to default execution.
- Do not delete historical ML models/results because they failed to demonstrate lift. Keep evidence immutable; retire eligibility/default exposure separately.
- Do not choose a root software license automatically. No root `LICENSE` was found in this inspection; that is a distribution-policy decision, not a request to impose MIT, and it does not settle provider-data rights.

## Recommended sequence

1. Review and reverify the exact current working tree before release claims. This review did not rerun `pnpm verify` or Electron smoke.
2. Add source-use eligibility and resolve Coinbase provenance/intended-use constraints.
3. Complete bounded Coinbase acquisition and the local BTC/ETH reproducibility capsule.
4. Finish independent collection and unify data/scheduler health reporting.
5. Surface existing calibration, activity and economic attribution; add missing naive forecast baselines.
6. Register one external-feature experiment, then consider additional models only if those comparisons justify them.

Items 2–4 are the highest-value engineering work. Additional features may improve information, but none of the report's proposals supplies evidence that a strategy will become profitable. Preserve Coqui's existing prospective observation requirements and closed qualification gates until the actual evidence meets them.
