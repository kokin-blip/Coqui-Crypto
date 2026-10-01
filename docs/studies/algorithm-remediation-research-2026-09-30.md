# Research proposal: repair paper execution and evidence collection

Research date: September 30, 2026, Phoenix. Status: **proposal; no operational policy changed, no study registered, no holdout opened**.

## Recommendation

Repair operational readiness, study provenance, and comparison accounting first. Then test a small, frozen set of execution policies against unchanged TrendVol targets. A more complicated signal cannot compensate for missing scheduler checks or unusable research evidence. These repairs can improve reliability and interpretability; they cannot guarantee profits or recover losses.

This research combines current source inspection, read-only owner-ledger analysis, targeted reading of the previously supplied quant corpus, and current primary-source documentation. Book sections were revisited, not entire books reread. The [preceding trade review](../audit/algorithm-paper-review-2026-09-30.md) supplies loss attribution. A [new evidence snapshot](algorithm-remediation-evidence-2026-09-30.json) freezes operational measurements through September 30 at 19:14:10 UTC / 12:14:10 p.m. Phoenix. No credentials or account identifiers are included.

## What the evidence adds

The snapshot has 1,873 scheduler checks and 65 inter-check gaps longer than five minutes. The longest is **20.9693 hours**, from September 28 22:06 UTC to September 29 19:04 UTC. This is absent recorded execution coverage, not proof of a particular sleep, app-close, or network cause.

Of 1,877 refresh-finish events, median elapsed time is 2.19 seconds and p95 is 6.74 seconds. Fourteen exceed 30 seconds; the maximum wall-clock interval is 17.49 minutes. Wall-clock measurements can include system sleep. Thus neither the maximum nor a scheduler gap should be described as measured network latency. They do establish a need for separate monotonic request timing, wake/launch records, and a deadline-aware paper pass.

There are still 13 stale-product-rule pauses and 136 reconciliation read errors. The hourly study has 17 observations and five failure records; a failure may be followed by successful collection in the same slot, so these counts are not mutually exclusive missing-hour counts. The selector has zero shadow slots and ten source-change failures. Breakout and range have three old shadow slots each. The prior report's 15-hour count has increased as the active app continues collecting; it remains too early for a completed prospective comparison.

## 1. Make the paper pass deadline-aware

### Source-backed diagnosis

`parallel-paper-runtime.ts` refreshes the entire Coinbase preparation before `service.tick()`. `paper-market.ts` requests rules for all three products and refreshes daily history. The shared HTTP client already implements GET retries, backoff, rate limiting, and a total elapsed budget; its default budget is 300 seconds. Adding another retry loop around it would compound delays. The dirty Alpaca adapter separately permits one GET retry, but correctly does not retry writes.

`refreshRules()` returns unavailable when any requested HTTP response fails, even when a previously verified observation might still be within an explicitly permitted freshness interval. Conversely, the targeted adapter silently omits an invalid parsed product from an otherwise successful response. The caller then reads old stored snapshots and checks only that they exist. It can treat an old snapshot as freshly verified even when that requested product was absent from the validated response. This is a code-path integrity concern; the ledger does not establish that it caused a particular pause or order.

### Proposed implementation

- Record readiness separately for completed daily bars, Coinbase rule observations, Alpaca asset rules, quotes, broker reconciliation, and credentials. Include safe operation/status/reason codes and last successful observation times.
- Keep immutable rule content separate from append-only successful verification observations. An unchanged response can attest the same content at a new time. Never turn a failed or malformed response into successful freshness evidence.
- Require every requested product to appear in the validated result with the expected canonical identity. Explicit disabled/trading-halted status overrides cached eligibility immediately.
- Cache only validated observations for a documented, bounded interval. Validate that interval before operational use; do not silently increase freshness limits to reduce pauses. Alpaca order sizing must still use current Alpaca increments/status and fresh execution quotes.
- Use current completed daily history when it is already valid instead of rebuilding it on every minute tick. Schedule preparation ahead of windows while retaining readiness checks at submission.
- Propagate a single deadline through refresh, reconciliation, planning, and pre-order verification. Prefer an initial engineering target of **30 seconds per ordinary paper check**, bounded further by the remaining slot time. It is a proposed service objective, not a statistically optimized parameter. If the budget expires, record the skipped/deferred result and continue at the next eligible check; never extend the slot or invent a historical fill.
- Share request budgets and priorities across research and execution. Existing research runs after the authoritative pass but can still compete for sockets/rate-limit tokens on later checks. Prioritize paper readiness and bound research backfill.
- Keep unresolved order outcomes blocking. Separate broker order/fill reconciliation from a scheduled full-history fee audit only after proving that all required reconciliation conditions remain satisfied; do not simply bypass the activity endpoint that produced errors.
- Distinguish missing credentials, transient OS-read failures, corrupt stored values, and broker authentication failures. Retry only recoverable reads within budget; never log key material, cache a failed read indefinitely, or auto-resume a manual pause.

Coinbase publishes token-bucket rate limits and individual product metadata; those support bounded, targeted acquisition, not assuming today's failures were rate-limit failures. See [Coinbase rate limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits) and [single-product metadata](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-single-product).

### Availability and host ownership

Add launch, suspend, resume, authority, tick-start/tick-finish, and slot-outcome records. Every elapsed slot needs a reason such as observed, no order, stale data, paused, pending order, or host unavailable. Absence is not a successful no-trade decision.

The current `apps/headless/src/index.ts` calls `createRuntime()` without `secrets`. Alpaca paper service requires that store. **The existing headless CLI is not a drop-in unattended Alpaca host.** A later local runner needs the existing OS secret backend, lifecycle integration, and host-fencing tests. Verify ownership immediately before every submission; initial startup ownership alone is insufficient for takeover safety. First validate desktop sleep/wake and restart behavior. Do not add a second independent scheduler or start a background runner during this research.

Acceptance: controlled failure tests show bounded checks, validated freshness, no duplicate submissions across restart/timeout, no auto-resume of explicit pauses, and no orders from a stale host generation. Then run a seven-day connected paper readiness soak. Require every expected slot to have a truthful outcome and zero missing host intervals during the declared observation window. This is an engineering readiness check, not a profitability sample-size claim.

## 2. Repair study identities without weakening provenance

`widerUniverseRuntimeSourceHash()` hashes every JS/TS file under main-process, core, adapters, and storage roots. The registered study can therefore become invalid after an unrelated implementation change. The selector explicitly blocks source changes. Breakout and range check policy identity when locating studies but lack the equivalent source-change guard before collecting shadow slots. Their report evaluators reject source mismatch, but collection and evaluation do not enforce the same boundary.

Proposed repair:

1. Introduce an explicit study instance ID covering candidate version, policy, signal dependency manifest, execution/cost/data definitions, opening convention, and fixed dates. Preserve a separate full application artifact hash for diagnostic provenance.
2. Hash the actual relevant dependency closure, including shared sizing, eligibility, timestamp handling, parsers, and cost logic. Include manifest-generation tests. A hand-picked list that omits a behavior-changing dependency would weaken evidence.
3. Require the same provenance validator in collector and evaluator for selector, breakout, range, and hourly execution. A mismatch records a failure and prevents valid observations.
4. Namespace study, slot, failure, and virtual-book records by study instance. Several current keys use only the policy or slot timestamp; a new registration must not collide with old slots or inherit the old virtual book accidentally. Use forward migrations and legacy readers.
5. Preserve existing studies as invalid/incomplete evidence. Create a new prospective study only after the relevant implementation is frozen; start on a new predeclared date. No deletion, edited hash, backfill, date extension, or automatic reset.

Acceptance: unrelated presentation edits leave the study behavior hash unchanged; changes to signal, planner, costs, data parsing, or dependencies invalidate it. Two study instances can coexist across restart without mixed holdings or record-key collisions. Current invalid records remain inspectable.

This addresses the problem identified by Bailey et al.: selecting among many tested alternatives requires accounting for selection itself; an untouched period alone does not erase repeated-search bias. [Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

## 3. Use one execution planner; test target changes separately from drift

Daily execution currently uses a five-percentage-point drift band and the preceding Coinbase close for quantity sizing. Intraday execution uses a one-point band and fresh Alpaca midpoint. Both can observe the same target yet make different decisions. At the reviewed midnight pass, a 4.69-point LTC overweight generated no order; the next intraday slot reduced it.

Create one pure, Decimal-based planner using a coherent account/position/quote capture, current venue increments, cash reservation, sell-first ordering, and deterministic client IDs. Store capture times and reject an excessively skewed account/quote set. Immediately before submission, revalidate eligibility, ownership, kill switch, deadline, and quote freshness; if material sizing inputs changed, produce a new versioned plan before any submit attempt. Never silently mutate a persisted attempted intent.

Do not automatically copy the one-point band to every check. A new daily target reduction is a different event from prices moving slightly around an unchanged target. The first is a risk/portfolio decision; the second may only create turnover. A blanket cost gate on all sells could retain precisely the exposure the strategy is trying to reduce.

### Candidate policies for a new execution study

Keep the operational baseline frozen. After repairs, preregister a limited seven-arm comparison: four policies below plus passive BTC, passive equal-weight BTC/ETH/LTC, and cash controls. Count all evaluated alternatives, including preliminary diagnostics, in the trial registry. These numbers are proposed research settings, not book-prescribed or validated defaults.

| Arm | New completed-day target | Routine drift | Trade destination |
|---|---|---|---|
| A | Existing daily 5-point band | Existing intraday 1-point band | Full target; current baseline |
| B | Consistent 1-point band at all existing slots | 1 point | Full target |
| C | Reductions checked at 1 point; increases require 3 points | 3 points | New-target reductions to target; routine drift to nearest band edge |
| D | Same as C | Same as C | Same as C; discretionary entries/increases additionally subject to the existing 0.5% estimated fee-plus-half-spread screen |

Use the same permitted slots, $25 minimum after venue rounding, and unchanged daily targets. Hard eligibility exits, kill behavior, and independently declared risk limits must not be suppressed by D's discretionary entry-cost screen. Do not infer an expected-return forecast from target drift; it is a tracking measure.

Carver's *Systematic Trading*, supplied PDF pages 218–219, describes position inertia to avoid frequent small adjustments. His relative-position example is **not** a one-point portfolio-weight band. The transferable idea is to test a no-trade region, not copy the threshold. His [author article on trading speed](https://qoppac.blogspot.com/2020/04/how-fast-should-we-trade.html?m=0) also discusses cost measurement and buffering. Gârleanu and Pedersen relate trading speed to signal persistence, risks, and costs; Coqui has no calibrated alpha-decay forecast, so a complex optimizer is premature. [Dynamic trading research](https://www.aqr.com/insights/research/journal-article/dynamic-trading-with-predictable-returns-and-transactions-costs).

Acceptance: golden cases reproduce A, quantify the midnight LTC case, enforce minimum size after rounding, and distinguish target updates from unchanged-target drift. Replay verifies cash conservation, fees in the received asset, partial fills, no same-slot duplicate, and cost-screen exemption for required reductions. A unit-test advantage is not a return advantage.

## 4. Make comparison and costs interpretable

The $47.69 real local book should remain intact. Add separate research books with the **same $100,000 opening capital**, common opening holdings, and contemporaneous Alpaca quotes/rules. Distinguish:

- actual externally recorded Alpaca equity and fills;
- a matched virtual book following the same target and execution schedule;
- alternative execution policies under identical modeled conditions;
- passive/cash controls opened at the same declared starting point.

Apply the $25 minimum at the matched scale. Track missed fills and unavailable observations rather than treating them as zero-return periods. Do not reset the real paper account or retroactively fund the existing local wallet.

Alpaca documents that buy fees are deducted from received crypto and sell fees from received cash, and that CFEE/FEE activities can arrive later. Its current first-tier fee table lists 0.15% maker and 0.25% taker; the account's actual tier and booked activities remain authoritative. [Alpaca crypto fees](https://docs.alpaca.markets/us/docs/crypto-fees).

The summary currently exposes `alpacaBookedFeesUsd:null` and an 0.85% modeled comparison-friction estimate. Keep that conservative historical model version intact, but show it separately from observed fees and the distinct 0.25% fee-plus-spread/slippage study model. Do not subtract estimates again from broker equity. A versioned venue/cost registry should supply future studies consistently; different venue assumptions should be explicit rather than copied constants.

Add known cash fees, crypto fee quantities, reported-price USD equivalents, valuation timestamps, and fee-coverage status. Null/unreported fee coverage must remain unknown. Reconcile fill quantities minus crypto fees minus sales with positions, and opening cash minus buys plus sells minus cash fees with broker cash.

For execution quality, report arrival midpoint, fill VWAP, signed implementation shortfall, latency, partial fills, and later matched marks. An immediate account-mark change includes market movement and is not automatically slippage. Passive limits require a separate registered timeout, nonfill, partial-fill, and adverse-selection model. A touch of the price is insufficient fill evidence; a marketable limit can still be a taker. Alpaca supports market, limit, and stop-limit crypto orders with GTC/IOC, but this does not establish a cost-saving limit policy for Coqui. [Crypto orders](https://docs.alpaca.markets/us/docs/crypto-orders).

## 5. Establish what would count as a successful fix

Engineering outcomes and investment outcomes need separate gates. Reliability repairs pass on correct lifecycle, bounded latency, truthful freshness, reconciliation, and durable provenance. Performance candidates pass only on new independent observations.

Preserve old failed studies. For the new execution study, preregister chronological development/holdout dates, the seven arms, one primary metric (net return lift versus A), drawdown constraints, costs and doubled-cost stress, coverage requirements, and a fixed selection rule before collecting results. Use equal starting books and identical observations. Freeze at most one candidate before opening holdout; decline promotion if no candidate meets the predeclared requirements.

Report fees, turnover, tracking error, cash exposure, drawdown, missed favorable moves, per-coin contribution, and clustered uncertainty. For models with overlapping future-return labels, purge overlapping training labels and embargo where required; a past-data lookback alone is not a reason to discard valid historical observations. Do not run random train/test splits. No calendar duration guarantees adequate statistical power: estimate uncertainty from observed variability and effective independent observations, and report unavailable significance when sample size is insufficient. If a predeclared fold is missing required slots, mark it unavailable; do not rescue it by selecting convenient dates after inspecting returns.

Relevant supplied-book sections:

| Work revisited | Location | Application and limitation |
|---|---|---|
| Narang, *Inside the Black Box* | PDF page 30, trading-system components | Separate signal, risk, cost, portfolio, and execution responsibilities; does not validate TrendVol |
| Carver, *Systematic Trading* | PDF pages 218–219, position inertia | Test turnover buffers; its position-relative threshold does not transfer unchanged |
| Chan, *Algorithmic Trading* | PDF page 25, walk-forward validation; introduction's cost caveat | Independent prospective testing and explicit costs; illustrative strategies are not cost-complete crypto evidence |
| Kaufman, *Trading Systems and Methods*, fifth edition | PDF page 42, transaction costs and monitoring | Compare actual execution with expectations; preserve conservative guard assumptions while labeling measured costs accurately |
| López de Prado, *Advances in Financial Machine Learning* | PDF pages 132–134, §7.4 | Purging/embargo when labels overlap; repeated selection still needs trial accounting |

PDF page references count file pages, not necessarily printed pages. Original wording is not reproduced. Corpus pointers and inventory are in the [previous survey](quant-resources-survey-2026-09-26.md).

## Implementation order and deliverables

| Order | Deliverable | Completion evidence |
|---|---|---|
| 1 | Readiness observations, strict requested-rule validation, deadlines, lifecycle reasons | Failure/restart/wake tests; no stale eligibility attestation; complete soak outcomes |
| 2 | Common provenance validator and study-instance keys | Relevant-change invalidation, unrelated-change stability, legacy coexistence, immutable old evidence |
| 3 | Matched-capital books and observed fee reconciliation | Exact quantity/cash reconstruction; no double fee charge; clear unknown coverage |
| 4 | Shared sizing planner and proposed policies in shadow | Golden baseline reproduction; versioned intents; deterministic partial/restart cases |
| 5 | New prospective study | Predeclared dates/trials/costs, complete observations, sealed holdout, explicit result review |

No runtime repair should automatically register a new study, alter broker orders, promote an execution policy, or replace the existing research dates. ML, regime selection, LTC removal, tighter stops, and faster signals remain separate hypotheses. The present loss sample does not select any of them.

This task produced research and evidence artifacts only. No implementation, application deployment, host takeover, trading-parameter change, or broker interaction was performed.
