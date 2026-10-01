# Algorithm and Alpaca paper review — September 30, 2026

## Scope and conclusion

Reviewed the current working-tree strategy and execution code, recent study documentation, and the `main` profile's local Alpaca evidence ledger. The database was opened read-only at `/Users/kokinmartinez/Library/Application Support/@coqui/desktop/coqui.db`. No broker requests, credential reads, order submissions, or trading-policy changes were made. Results are locally recorded Alpaca responses, not a fresh independent broker reconciliation.

Latest account mark: September 30 at **9:03:15 a.m. Phoenix / 16:03:15 UTC**. The experiment is active in the ledger; scheduler activity continues after that mark.

**The account is down $2,102.83 (2.10%). LTC explains approximately 85% of the decline.** Recorded positions and cash reconcile with five filled orders and recorded fee debits. The evidence points to losing market exposure, concentrated in LTC, plus execution costs. It does not establish that the two LTC reductions were bad decisions, nor establish a profitable strategy.

## Account and loss attribution

| Measure | Recorded value |
|---|---:|
| Opening equity | $100,000.00 |
| Latest equity | $97,897.17 |
| Latest cash | $27,829.72 |
| Lowest sampled equity | $97,340.94 |
| Sampled maximum drawdown from opening peak | 2.66% |
| Distinct filled orders | 5 |
| Fill activity rows | 13 |
| Fee activity rows | 13 |

The drawdown is sampled from 51 account marks; unseen lows between marks remain unknown. Thirteen fill rows are not thirteen separate trades.

| Asset | Remaining quantity | Latest marked value | Gross realized P&L | Gross remaining unrealized P&L | Contribution including crypto fee quantity loss |
|---|---:|---:|---:|---:|---:|
| BTC | 0.220085560 | $18,502.92 | $0.00 | -$31.07 | -$77.52 |
| ETH | 14.304505727 | $38,370.26 | $0.00 | -$125.28 | -$221.76 |
| LTC | 196.299726778 | $13,194.27 | -$512.59 | -$1,221.96 | -$1,787.76 |
| Account cash fees | — | — | — | — | -$15.78 |

Gross realized P&L uses sale quantity times sale price minus original weighted-average buy price. It is an analytical calculation, not a broker tax-lot statement. Remaining unrealized P&L uses actual post-fee holdings. Asset contribution equals sale proceeds plus remaining market value minus original purchase notional, so crypto fees are already included and must not be deducted again. Rounding and broker cash precision account for approximately one cent of difference against total equity loss.

Recorded crypto fee debits: 0.000551594 BTC, 0.035850892 ETH, and 0.724725773 LTC. Valuing them at their reported activity prices gives **$196.15**, plus **$15.78** of cash fees: **$211.93** total. Their current market value differs from this booked-price valuation. These are account-level activities without order links; their dates do not establish the precise charging time or individual order attribution. The quantity debits exactly reconcile initial filled quantities to current holdings after sales; cash reconstruction gives $27,829.7245 versus the recorded $27,829.72.

## Operational algorithm

The account runs `trendvol-qc-v4.2-paper` on BTC, ETH, and LTC, with equal base weights. It uses completed Coinbase daily bars: 120-day momentum, 30-day per-asset volatility, a 55% annualized per-asset volatility target, a 40% portfolio volatility target, and a 100-day trend gate. Negative momentum scales an asset by 0.2; relative momentum allows a 35% tilt; the below-trend portfolio cap is 70%.

Latest target: **18.79% BTC, 39.03% ETH, 13.51% LTC, 28.67% cash**. Actual marked weights are approximately 18.90%, 39.19%, 13.48%, and 28.43%, all within the intraday one-percentage-point drift band.

Across all four recorded daily decisions, LTC's per-asset volatility scaler and portfolio volatility scaling applied. Negative-momentum reductions and the trend cap never applied. The latest measured mix volatility is 46.12% annualized; it remains above its 100-day trend. The reported `exposure` of 86.73% is the portfolio multiplier before accounting for cash raised by asset sizing; actual target investment is **71.33%**. A falling short-term price therefore does not necessarily trigger a defensive exit in this slow daily strategy.

Daily targets reduced LTC from 21.23% to 19.12%, 17.43%, then 13.51%; cash rose from 21.63% to 28.67%. BTC and ETH changed little. Decisions for completed days September 25, 27, and 28 arrived late; no September 26 decision is recorded.

## Recent trades and decisions

Times below are Phoenix; target day keys remain UTC completed-bar dates.

| Time | Action | Quantity | Average fill | Interpretation |
|---|---|---:|---:|---|
| Sept 26, about 5:07 a.m. | Buy BTC | 0.220637154 | $84,212.6564 | Initial allocation |
| Sept 26, about 5:07 a.m. | Buy ETH | 14.340356619 | $2,691.1481 | Initial allocation |
| Sept 26, about 5:07 a.m. | Buy LTC | 289.890308453 | $73.4398452 | Initial allocation |
| Sept 27, about 9:00 p.m. | Sell LTC | 23.187123057 | $70.6314 | Reduce toward 19.12% target; gross realized loss $65.12 |
| Sept 29, about 9:02 p.m. | Sell LTC | 69.678732845 | $67.0180 | Reduce toward 13.51% target; gross realized loss $447.47 |

The sale acknowledgment/fill records were reconciled roughly a minute later. Initial post-entry equity was $99,560.19, an immediate decline of $439.81. Initial quote diagnostics were absent, so that decline cannot be cleanly split into fees, spread, and contemporaneous market movement.

At the September 30 00:05 UTC daily pass, LTC was approximately 18.21% versus a 13.51% target: **4.69 percentage points overweight**. The daily 5-point threshold allowed no trade. The 04:02 UTC intraday pass used its 1-point threshold and sold. Subsequent 08:01, 12:07, and 16:03 UTC passes recorded no orders because holdings were close to target. This is configured behavior, but materially delays exposure reduction at midnight.

Both LTC sales exceeded the shadow 0.5% estimated one-way fee-plus-half-spread screen: 0.541% and 0.570%. The screen is observational and does not prevent submission. The built-in next-recorded-quote comparison estimates +$6.72 for the first sale and -$0.61 for the second versus holding those quantities, after an assumed 0.25% sale fee. Two comparisons are insufficient to promote the screen. A realized loss relative to purchase cost is different from a sale's benefit relative to continuing to hold.

## Material review findings

1. **Research continuity is broken for the selector.** The ledger contains a study registration and ten `registered_selector_source_changed` failures, with zero shadow slots. Its report returns `source_changed`. Breakout and range each retain three older cash-only shadow slots, and their current reports also return `source_changed`. Those report mismatches compare the registration with the current local compiled implementation; only the selector has explicit runtime failure evidence in the ledger. Source hashing covers all main-process and core/adapter/storage implementation files, so changes beyond signal logic can invalidate a study. Preserve old evidence and establish a deliberately versioned registration before expecting new valid comparisons.

2. **Reliable uptime and data readiness constrain execution.** There are 25 recorded pause events, including 13 stale-product-rule pauses, four credential-unavailable pauses, and recurring market/API failures. Three daily windows were missed. The algorithm needs the desktop host running and its preparation dependencies fresh. Missing observations cannot demonstrate the return impact of missed trades. Investigate freshness and credential-read failures before altering signal thresholds.

3. **Daily and intraday planners differ materially.** Daily sizing uses the previous Coinbase close, while its drift test uses Alpaca market value; intraday sizing uses fresh Alpaca quote midpoints. Fresh pre-order quotes are recorded but do not recompute daily quantities. These differences can delay a reduction or leave residual drift. A future execution change should use consistent price evidence and explicitly justify the differing drift thresholds. This is an execution review finding, not evidence that it caused all observed losses.

4. **Profitability remains unvalidated.** ML was unqualified and `applied:false` in recorded slots; current code keeps it shadow-only even if qualified. Hourly execution has 15 observed hours, zero complete days, and no comparable fold return. Four-hour replay has ten collected observations and incomplete folds. The older replacement study was negative and its selected candidate was not adopted; it used different selected parameters, so it is not an identical test of this five-order run. No new research result justifies changing the operational strategy.

5. **The local comparison book is not an informative performance comparator here.** It remains $47.69 in cash with no holdings; late decisions skipped settlement and its scale interacts with the $25 minimum trade. It also models daily execution rather than Alpaca's intraday path. Its flat return cannot establish alpha or execution quality against this $100,000 account.

Priority: restore valid study collection and dependable data readiness, improve consistent sizing and fee-aware reporting, then evaluate frozen execution alternatives on matched prospective observations. The present evidence does not support more frequent trading, removing LTC solely because of this loss, or activating ML/selector orders.

## Verification and references

Ran the read-only execution analysis, four-hour policy replay, hourly execution report, market-selector report, range-rotation report, and breakout report. Reconstructed account cash and asset quantities independently from fills and fees. No holdout was opened. All 23 focused tests passed across `alpaca-paper.test.ts`, `parallel-paper.test.ts`, and `parallel-paper-execution.test.ts`; mock tests establish code behavior, not strategy returns.

Relevant source: `packages/services/src/paper/parallel-signal.ts`, `parallel-paper-service.ts`, `parallel-paper-intraday.ts`, and `apps/desktop/src/main/wider-universe-runtime.ts`. Existing uncommitted changes include safe Alpaca GET retries and improved reconciliation-error labels; they were reviewed without modification, and deployment parity was not established.

Alpaca identifies paper trading as a simulation and documents crypto fees in CFEE/FEE account activities: [paper trading](https://docs.alpaca.markets/us/docs/paper-trading), [crypto trading](https://docs.alpaca.markets/us/docs/crypto-trading). External paper fills are not live exchange executions.
