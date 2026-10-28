# P5-H, P6-G/H and P7-H–J delivery record

The [original P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) and full [P5](small-portfolio-p5-implementation-plan-2026-10-23.md), [P6](small-portfolio-p6-implementation-plan-2026-10-24.md) and [P7](small-portfolio-p7-implementation-plan-2026-10-24.md) plans remain authoritative and unchanged. This batch preserves P0–P4, pushed P5-A–G/P6-A–F and local P7-A–G. It does not mark an operational or elapsed-evidence gate complete. [Tracker](small-portfolio-phase-tracker-2026-10-23.md).

## Installed evidence and its permitted use

The owner selected existing installed broker/algorithm data and identified the sole Alpaca paper account (ending **YT3T**, full number omitted from repository artifacts). Inspection used a stable, hash-checked local copy of the installed database. Source WAL was absent at both capture boundaries; source/copy hashes matched. The installed database was not migrated, opened through application composition, resumed or modified. No keychain/credentials, provider endpoints, final financial bodies or market price values were read. The repository evidence contains metadata and hashes, not the database or account balances.

The repeatable read-only inventory is `scripts/inspect-small-portfolio-evidence.mjs`. It accepts an explicit database/profile/protected boundary, works with predecessor schemas and has no default installed path, migration, provider, order or registration capability. [Actual inventory](evidence/remaining-phases-2026-10-28/installed-readiness.json), [capture identity/schema/table inventory](evidence/remaining-phases-2026-10-28/installed-inventory.json), [working baseline](evidence/remaining-phases-2026-10-28/baseline.json).

Verified at the captured cut:

- Installed schema **95**, preceding P0/P1's v96, P6's v99 and P7's v100. Installed and current working software are separate artifacts. This task does not deploy or migrate the installed account.
- 1,307 stored daily market rows. BTC/ETH/LTC have **431 matched completed dates** at the inspected cut. Excluding the previously consumed interval through August 8, 2026 leaves **78 contiguous dates**, August 9 through October 25 UTC. This cannot supply the saved **120-day seed warmup**, before even allowing validation. Stored OHLC and acquisition dates do not prove point-in-time membership, native-rule history, source rights or a complete financial tape. No consumed row was opened for performance calculation or reused as warmup.
- The installed trial registry explicitly says **known-lower-bound**. It has zero `research_preregistrations` and one local integrity event. Those local counts do not negate the consumed interval recorded in the repository or establish global custody/completeness. They cannot authorize a fresh study.
- Algorithm operational metadata includes 18 external-intent, 34 external-order, 49 external-fill and 49 external-fee event rows; 2,151 reconciliation-error rows and multiple runtime versions. These are journal counts, **not independent successful trades**, a matched fee-completeness proof, or qualified returns. Partial/duplicate representations and changed behavior cannot be pooled into an alpha sample.
- Latest recorded pause is `runtime_restart` with `manualResumeRequired=1`; no later Resume event appears in the captured metadata. It remains paused. Current installed host-authority and host-reconciliation tables have no rows. A profile execution lease does not establish account-wide ownership.
- The stored experiment has an Alpaca account UUID. Its identity hash is retained; the relationship between that UUID and the owner-supplied display number is **unverified** until authoritative account evidence supplies both. No credential rotation, account reset, current financial completeness, or exclusive-writer claim is inferred.
- External ignored archive manifests were inspected as metadata only: two Binance BTC/ETH USDT datasets (3,334 rows each) and two Kraken USD datasets (4,639/3,975 rows). The dated acquisition reports show no published Coinbase dataset after its provenance-source failure. These different venues/quotes and two-asset universes do not satisfy the saved Coinbase/Alpaca three-asset seed. No raw archive or performance body was opened. [Manifest inventory](evidence/remaining-phases-2026-10-28/archive-manifest-inventory.json). A separate cross-venue design would be an explicit scope/design proposal, not a substituted H run.

### Research-backed interpretation

Existing algorithm experience is useful for diagnosing acquisition gaps, failure/recovery modes, fee delays, causal timestamps and execution assumptions. It is exposed development/operations evidence for this new design. Repeated selection and unrecorded trial history can inflate apparent performance; the DSR paper makes search information central to interpretation. Therefore this inventory cannot support a return/Sharpe conclusion or repair missing global trials. [Bailey–López de Prado, DSR](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).

CSCV/PBO evaluates selection overfitting; it does not turn previously inspected or consumed history into untouched evidence. The old negative TrendVol/PBO **28.60%** result and consumed final interval remain intact. No lookback shortening, alternate universe, diagnostic winner or relabeling of algorithm history is used to make H pass. The 78/120 shortfall is a data-readiness failure, not a negative strategy experiment and not a completed `none` result. [Bailey et al., PBO](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

Alpaca's current official paper documentation explicitly describes simulated fills and limitations including market impact, latency slippage and liquidity checks. Its artificial partial-fill mechanism is not empirical evidence about real execution capacity. Paper records can test operational plumbing; they cannot replace the declared conservative cost/stress assumptions or validate live returns. [Official paper trading documentation](https://docs.alpaca.markets/us/docs/paper-trading).

Current official crypto documentation supports fractional quantity/notional orders and GTC/IOC while requiring asset-specific size/precision. Examples are not immutable account rules. Activity documentation separates fills, crypto fees, cash deposits/withdrawals and ambiguous journals; nontrade dates can mean occurrence or settlement. Deterministic lookup by original client ID is available. These facts support the retained identity, fee, timing and recovery requirements; none proves current account ownership or fee completeness. [Crypto orders/assets](https://docs.alpaca.markets/us/docs/crypto-trading), [activities](https://docs.alpaca.markets/us/docs/account-activities), [client-ID lookup](https://docs.alpaca.markets/us/reference/getorderbyclientorderid). Checked October 28, 2026; no account request was made.

The October 3 Coinbase 403 is historical, **not a current access finding**. On October 28 the official Market Data Terms page was readable through the web documentation tool, labeled last updated August 7, 2026. Its personal/research license contains end-user/redistribution restrictions and restrictions on use to validate or improve AI/ML/automated systems. Applicable permissions for this requested AI-assisted analysis and eventual app use therefore remain unresolved; possessing cached data does not establish them. No legal permission or written consent is inferred. This updates the access finding without relaxing the saved rights gate or beginning price analysis/acquisition. [Current official terms](https://www.coinbase.com/legal/market_data). The provider/account source rights, derivative retention and export scope must be resolved before a real H run; metadata inventory is not rights clearance.

## Implemented software slice

### P6-G bounded sale preparation and reviewed pipeline

`packages/core/src/portfolio/paper-reserve-sale.ts` models the minimum notional among a declared bounded set of **single-asset FIFO** sales. It intersects affine cash/realized-gain/economic-profit/fresh-profit/retained-capital/cost/exposure/turnover/native constraints on each FIFO segment, rounds the requested quantity up to the legal increment and verifies the full sale through P2. It checks post-reserve active and full-account concentration separately. Unknown basis/order/history/rules, stale evidence, unsupported costs and infeasible objectives stay explicit. It is not a multi-asset global optimizer. The original P5 full-exit diagnostic is unchanged.

Independent example: $500 basis/$550 value requires a $137.50 sale to realize $12.50 before costs. A 1% fee makes that original 25%-of-$50 maximum unattainable; a smaller fixed target must be assessed after the cost reduces fresh profit. Native minimums may force more turnover than the objective tolerates. A modeled result carries literal false funding/order/withdrawal permission flags.

`packages/services/src/paper/paper-reserve-sale.ts` adds a separately constructed, default-off backend adapter. It requires an existing active P6 simulation book, current authority, exact policy/state/budget, reconciled P1 financial backing, an existing milestone and a reviewed fixed objective plus cash-only-capability/policy-evidence review references. It has no provider or transfer port. Deterministic intent/proposal identities and immutable command receipts reuse existing P6/PaperExecution storage, with no new migration or second ledger.

Preparation requires `review_required`, creates only a pending proposal and binds an existing causal pending-execution context. Separate order review uses the sole existing `PaperExecutionService`/OMS and its qualification, budget, risk, kill, authority and lease gates. Purpose-bound proposals refuse submission from a generic constructor missing their current-purpose revalidation port. The explicit human-review requirement is durable across retries and policy changes. Existing default callers retain their prior behavior. Cached attempt outcomes are returned without re-submission. Unknown or pending execution cannot fund a reserve. After supported terminal settlement, the adapter calls the existing financial/operating reassessment port; that returns a new proposal and never commits cash automatically.

The simulator's fee-on-reference-notional and eight-decimal cost convention differs from P2's affine execution-notional fee convention. The adapter explicitly checks that the declared consequence conservatively bounds the actual OMS cost/net-proceeds convention and reference-notional ceilings, and binds the pending context to `paperCostModelHash`. An understated or incompatible scenario refuses preparation. A bounded scenario remains a model, not an exact promise of future market-order proceeds. No legacy cost helper is changed to make the conventions appear identical.

This backend is **not wired into Main/renderer or an installed account**. Real operational admission still requires reviewed cash-only acceptance, a concrete objective, compatible actual execution/cost/native assumptions, strategy qualification, reviewed construction and UX. Those are retained remaining G requirements, not claimed as achieved by a synthetic port. The service's modeled consequence does not guarantee future market-order proceeds or reserve eligibility. No P6 account is activated by this batch.

### P7-I action-class correction

A modeled execution with zero total friction no longer increments `modeledFrictionBearing`. Its book/edge trace still exists; actual-paper actions remain zero. Existing persisted reports are untouched; the current source identity changes and cannot silently continue an older registered behavior. A dedicated zero-friction regression prevents satisfying an action minimum with free hypothetical trades.

### P5-H / P6-H / P7-H–J evidence preparation

The new inventory supplies concrete account/source/schema/coverage/registry and operational blockers without reading final financial bodies. No existing historical P&L helper is treated as corrected P1 performance. No P5 performance panel/trial is opened, no final is claimed, and no fresh registration/collector or background automation is created.

## Remaining requirements and dependency sequence

| Slice | Current state | Required next evidence/actions |
|---|---|---|
| P5-H | Installed evidence inspected; actual development evaluation blocked | Adequate permitted physical warmup/validation panel outside protected intervals, point-in-time membership/native/cost/rights evidence, original global trial/consumption custody; freeze full manifest/objectives/resources and run every declared trial. Preserve unavailable/negative/none outcomes. |
| P6-G | Bounded pure solver and guarded backend implemented locally; operational/app integration and acceptance pending | Human review of F, explicit sacrifice/turnover/exposure objective and eligible scope, compatible actual cost/native/quantity assumptions and qualification; reviewed Main/UX construction, partial/unknown/cancel/fee/fault/restore integration and exact source/native acceptance before enabling. |
| P6-H | Owner identified intended paper account; installed metadata/current official docs inspected | Authoritative display-number/UUID mapping and intended-host/current financial evidence; COQ-12 exact integrated recovery/fee/deadline review, COQ-14 permitted connected observations; a reviewed exclusive account-wide ownership/claim/fencing protocol across profiles/hosts. No profile lease or local flag substitutes for it. |
| P7-H | Existing data/owner account intent recorded; registration not ready | Complete P5-H record for this hypothesis (or explicitly separate reviewed design), owner plus independent reviewer, protocol/rights, global registry, costs/funding/primary weights/objectives/power/resources/host and genuinely future approved windows. Register before start; explicitly start collector. |
| P7-I | Software action count hardened; actual elapsed collection pending | Genuine future observations under the unchanged approved design. Historical experience, uptime, mocked dates and synthetic paths do not fill the required days/actions or gaps. |
| P7-J | Existing once-only final machinery preserved; no actual freeze/evaluation/acceptance | Timely candidate-or-none freeze before final starts; sufficient elapsed unchanged final evidence; claim once, evaluate selected candidate/controls only and record independent exact paper-configuration accept/reject. No automatic P6 arm or champion change. |

All earlier phases and later requirements remain in scope. No shorter study, new strategy, relaxed statistical threshold, default sale share, restored-account authority, deployment, live order or external withdrawal is introduced. Actual market evidence blockers differ from software acceptance. A full empirical conclusion is not available from this batch.

## Verification

Final combined-checkout verification passes **350 suites / 2,436 tests**, including **4 direct suites / 25 cases**. Root and renderer typecheck, lint, root/production desktop builds and the unchanged disposable native safety smoke pass (fullscreen/focus included). The existing large Ionic chunk warning remains. Final metadata CLI ran successfully against the same hash-checked copy. [Validation/log index](evidence/remaining-phases-2026-10-28/validation.json), [software hashes](evidence/remaining-phases-2026-10-28/source-closure.json), [preservation](evidence/remaining-phases-2026-10-28/preservation.json). Raw earlier failures and successful reruns remain retained.

Preservation checks verify **3,118 of 3,126** prior file hashes unchanged, with eight intentional integration/identity/tracker changes and no unexpected change or missing file. Original plans, HEAD, Git index and installed database hash remain unchanged; exact prior generated manifest bytes are archived. Existing unrelated dirty work and P7-A–G survive. No commit, push, merge, release, installation or new source-isolated acceptance is claimed.

Synthetic cases validate accounting/guards, not strategy efficacy or actual account health. Full G app/operational acceptance and actual P5-H/P6-H/P7-H–J remain pending for the reasons above. [Linear receipts](evidence/remaining-phases-2026-10-28/linear-sync.json) synchronize COQ-39/40/10/14/16/17/18 and milestones02/03/04. Existing issue states and open dependencies remain; no issue/milestone closed.

## Prompt used

Work on implementng P5-H, P6-G/H and P7-H–J.

Relevant follow-up answers:

> use the installed data we have from brokers, as well as the experienced data from the algorithm we have stored. interpret the data from the algorithm yourself using research-backed evidence before using it.

> The only paper account we have. Paper Account [financial account number redacted; ending YT3T]
