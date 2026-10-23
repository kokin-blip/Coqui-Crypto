# Trading strategies for small portfolios: evidence and research proposals

Research date: October 23, 2026, America/Phoenix. This report addresses the strategy layer: what might generate returns, what can transfer from general quantitative research, and how to test it at retail balances. It complements the [account mechanics report](small-portfolio-quant-research-2026-10-22.md) and [profit distribution proposal](profit-distribution-and-quant-research-2026-10-22.md).

**Recommendation:** investigate simple, slower trend/cash allocation and momentum rotation with restrained turnover first. Compare them with passive holdings and the existing allocator before adding more predictors. Breakout and bounded mean reversion are secondary hypotheses. Small calibrated ML filters belong after a credible baseline and adequate point-in-time data. These priorities reflect evidence, transfer difficulty and existing Coqui infrastructure; they are not a finding that any candidate is profitable.

This is a targeted literature review, not a systematic meta-analysis or a replication of the papers. Nineteen primary papers/manuscripts/author records are annotated below. Access ranges from paper sections to abstracts; those limits are explicit. Proposed Coqui adaptations are our inferences, not results reported by the papers. No historical performance backtest, study registration, runtime change, account action or release was performed.

## What small capital does—and does not—change

The account balance changes executable weights, residual cash, rounding, minimum orders and the burden of fixed expenses. It does not create a predictive signal. If two accounts trade the same feasible fractional weights at the same percentage costs, their percentage returns can be similar; the dollar result scales with invested capital. Small orders may face less market impact, but that advantage does not eliminate fees or adverse selection.

The practical adaptation is therefore to seek **signals with enough persistence to survive retail execution**, use a feasible number of positions, and measure actual orders. Research priority should not be driven by a desired number of daily wins or a desired dollar income. The earlier report documents current $25 Coqui order floors and research books that assume $100,000; those are prerequisites for a retail replay, not evidence about which signal works.

Start with unlevered, long-only spot research and explicit fiat cash. An asset's low dollar price does not make it more suitable for a small account when fractional units are supported. A small account also does not need small-cap coins: weak liquidity and unreliable data can overwhelm any apparent anomaly. Stablecoins require their own custody, depeg and execution assumptions and should not silently substitute for fiat cash.

## What the evidence actually supports

### Trend following is a reasonable hypothesis, with meaningful counterevidence

Moskowitz, Ooi and Pedersen document persistence across 58 futures/forward instruments. That is evidence for investigating an asset's own past returns, but their diversified long/short construction differs materially from a few long-only crypto positions. Faber's updated tactical allocation paper offers a simpler monthly moving-average/cash example across traditional assets. Its historical same-close execution must not be copied into a simulation that learns the signal only after the close. [Time series momentum](https://fairmodel.econ.yale.edu/ec439/mosk.pdf), [Faber paper](https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf).

The evidence is contested. Huang, Li, Wang and Zhou find weak individual-asset predictability and compare momentum with a historical-mean strategy that achieves similar performance without the same predictive claim. That makes a passive/exposure comparison essential: a strategy can earn money because it holds appreciating assets. [Author institution's abstract](https://scholars.hkbu.edu.hk/en/publications/time-series-momentum-is-it-there-2/).

Crypto-specific evidence also changes with the sample. Liu and Tsyvinski report momentum and attention-related predictability; Liu, Tsyvinski and Wu identify market, size and momentum factors. Their results motivate tests and attribution, not importing their returns into a concentrated retail portfolio. A long-only winner basket is a new strategy when the published factor is long winners and short losers. [Risks and Returns](https://academic.oup.com/rfs/article-abstract/34/6/2689/5912024), [Common Risk Factors](https://onlinelibrary.wiley.com/doi/10.1111/jofi.13119).

Grobys and coauthors' 2025 crypto study finds severe momentum crashes and sample sensitivity; volatility management changes some outcomes without removing the estimated tail problem. Some dramatic losses arise from the short leg. They must not be described as losses mechanically possible in an unlevered long-only account. Equally, removing that leg does not establish that the remaining portfolio has positive alpha. [Crypto momentum counterevidence](https://link.springer.com/article/10.1007/s11408-025-00474-9).

**Existing Coqui evidence takes precedence over a favorable literature narrative.** The [TrendVol replacement study](trendvol-replacement-v1-2026-08-09.md) is explicitly negative and the candidate was not adopted. It failed benchmark confidence, drawdown and significance gates; PBO was 28.60% against a 5% limit. Its 2022–August 2026 holdout has already been inspected. A simpler trend experiment cannot relabel those observations as untouched or treat operational legacy defaults as validated.

### Technical rules justify controlled experiments, not indicator accumulation

Hudson and Urquhart examine 14,919 technical rules and find favorable results in much of their historical sample, including after multiple-testing adjustments. However, their selected Bitcoin rules fail to produce positive out-of-sample returns in the subsequent six-month test; other studied coins fare better. The construction also allows short positions. This is both motivation for breakout/trend experiments and a warning against assuming that the best historical rule will persist. [Technical trading and cryptocurrencies](https://link.springer.com/article/10.1007/s10479-019-03357-1).

Bajgrowicz and Scaillet's accessible July 2009 manuscript, preceding the 2012 journal article, finds that historical technical-rule winners were not reliably selectable in advance and that costs erased apparent gains in their DJIA study. This is cross-market counterevidence, not proof that all crypto technical rules fail. Its practical implication is to register the selection procedure and evaluate net outcomes. [Author-deposited manuscript](https://access.archive-ouverte.unige.ch/access/metadata/008c418e-66cf-42a0-84b4-ece93d36af00/download).

### Mean reversion and statistical arbitrage require a careful transfer

Gatev, Goetzmann and Rouwenhorst study paired US stocks, buying one and shorting the other when their normalized prices diverge. That is not equivalent to buying any coin after a fall. Tadi and Witzany's 2025 crypto paper uses cointegration/copulas on Binance USDT-margined futures; its assumptions include both long and short trading, rolling three-week formation and one-week trading windows, and modeled fees. The paper's comparisons also show how costs can devastate superficially attractive relative-value methods. Neither study establishes a profitable long-only spot dip-buying rule. [Classic pairs study](https://depot.som.yale.edu/icf/papers/fileuploads/2573/original/08-03.pdf), [Crypto copula study](https://link.springer.com/article/10.1186/s40854-024-00702-7).

For Coqui, bounded range trading is a **lower-confidence hypothesis** requiring its own predictive evidence. Correlation alone is insufficient; a relationship can break, and two correlated coins can fall together. An unhedged relative-strength tilt must be measured as directional exposure rather than labeled market-neutral arbitrage.

### ML offers methods, but its published economics may not transfer

Gu, Kelly and Xiu demonstrate useful nonlinear interactions in a large US equity panel. A small set of highly correlated crypto assets provides a different learning problem. Lim, Zohren and Roberts' deep momentum study uses 88 futures, and its unregularized model's advantage survives only low modeled costs; turnover regularization materially changes the outcome. These studies motivate regularization, realistic objectives and disciplined comparison, rather than selecting a neural architecture because its reported Sharpe is high. [Empirical Asset Pricing via ML](https://academic.oup.com/rfs/article/33/5/2223/5758276), [Deep momentum paper, revised 2020](https://arxiv.org/html/1904.04912v3).

The deep momentum paper applies cost to absolute changes in risk-scaled positions, reporting an advantage at roughly 2–3 bps in that experiment. Alpaca's published first crypto tier currently lists 25 bps taker and 15 bps maker fees, before other friction. Those are different instruments and simulations, but the order-of-magnitude mismatch makes direct transfer implausible without retesting. A resting limit order does not ensure a maker fill or eliminate adverse selection. [Paper's turnover analysis](https://arxiv.org/html/1904.04912v3#S6), [Alpaca fee schedule, checked October 23](https://docs.alpaca.markets/us/docs/crypto-fees).

## Ranked candidate research cards

All rules below are research proposals. Lookbacks, thresholds, cadence and position caps must be frozen before evaluating selection data. No values below are claims of optimality. Existing risk, reconciliation and owner controls remain prerequisites.

| Priority | Candidate | Intended horizon | Small-portfolio adaptation | Main falsification test |
|---|---|---|---|---|
| 1 | Simple absolute trend plus cash | Weeks to months | Few liquid instruments; infrequent discretionary adjustment; no shorting or leverage | Net benefit disappears versus passive or a training-calibrated cash/asset mix |
| 1 | Momentum rotation with absolute filter | Weeks to months | Feasible number of holdings; rank buffer; cash when no eligible asset qualifies | Rank turnover consumes the relative-return benefit |
| 2 | Swing breakout | Days to weeks | Compare slower decisions with existing four-hour shadow rules | False breakouts, delayed fills and costs erase benefit |
| 2 | Bounded range/pullback trading | Days, potentially longer | One entry per opportunity; exposure cap; time/risk exits; no averaging down | Losses during regime changes dominate small wins |
| 3 | Small fixed signal blend | Underlying signals' horizons | Net target exposures before orders; avoid many subminimum sleeves | No improvement over the best single policy after costs and selection adjustment |
| 3 | Calibrated selective participation | Existing signal's horizon | Skip weak opportunities or make bounded tilts | Calibration or economic value fails outside training |
| Overlay | Cost-aware partial adjustment | Matches signal persistence | Retain positions inside a no-trade region; allocate new contributions toward deficits | Savings are smaller than missed opportunities and tracking/risk costs |

### 1. A simpler trend/cash benchmark

**Mechanism:** gradual information incorporation could create persistent moves. The intended benefit can also be avoiding prolonged exposure during declines; those mechanisms must be distinguished from increased market beta.

**Proposed rule:** at a frozen decision schedule, hold an allowed long exposure when a completed-price trend signal is positive; otherwise hold its permitted allocation in fiat cash. Use one simple signal family first, such as trailing return or a moving average. Preserve per-asset and total exposure limits. Sell only through the existing risk and execution policies. Submit at the next available executable observation after decision and availability delays.

**Adaptation:** test slower weekly/monthly review against the current daily path. Monitoring and mandatory risk checks remain frequent. Long/cash replaces the academic short leg and forfeits possible bear-market short profits. Cash is an allowed outcome, not a failure to find enough coins.

**Coqui reuse:** [momentum allocator](../../packages/core/src/strategies/momentum.ts) already mixes absolute momentum, relative tilt and volatility-related sizing. Research value comes from removing components and measuring their incremental contribution. Test trend alone before adding volatility scaling; cap leverage at zero and gross exposure at the approved maximum. A low-volatility estimate is not permission to borrow.

**Reject if:** the effect is explained by lower average exposure alone, it misses recoveries badly enough to offset drawdown improvement, or results depend on one lookback, period or cost assumption. Trend can exit late after a sudden crash and whipsaw in a range. It does not guarantee a floor.

### 2. Momentum rotation with a reason to keep existing holdings

**Mechanism:** relative winners may continue to outperform, conditional on an investable universe. Relative ranking and absolute attractiveness are separate decisions: the least bad asset in a falling market may still be unattractive.

**Proposed rule:** rank eligible assets using only completed, available history. Hold a feasible top group that also passes an absolute filter. Retain an incumbent inside a predeclared rank buffer; consider replacements only on the declared schedule and after accounting for both sale and purchase costs. Unfilled allocation stays in cash rather than being forced into the next coin.

**Adaptation:** choose the holding count from capital feasibility and concentration limits, not a universal top-five rule. A one-asset implementation is concentrated; if the concentration limit prevents full deployment, keep the residual cash. Account size should not change which historical universe is presented to the researcher.

**Coqui reuse:** [rotation.ts](../../packages/core/src/strategies/rotation.ts) already has an absolute filter, weighting options and `holdBufferMultiple`. Defaults include top five, a 120-day lookback and a two-times rank buffer. These are existing settings, not validated retail defaults. First compare the existing buffer with an explicitly frozen alternative; do not add duplicate ranking machinery.

**Reject if:** returns are mostly market exposure, apparent profits come from coins unavailable at the time, or the edge needs continual winner replacement. Wider-universe research needs historical listings, delistings, minimum history, executable liquidity and symbol changes. Selecting today's surviving coins for past tests would distort results.

### 3. Swing breakout with explicit false-breakout accounting

**Mechanism:** a move beyond a prior trading range may identify a developing trend. A breakout distance is an observed price change, not a forecast of subsequent gain.

**Proposed comparison:** keep the existing [four-hour breakout shadow study](wider-breakout-v1-2026-09-27.md) intact. In a separate study, compare a slower breakout decision schedule or a simpler daily rule with trend/cash. Use prior bars for the boundary and only later executable prices for fills. A new rule or cadence needs a new identity.

**Adaptation:** require sufficient liquidity and feasible exposure; use a declared exit and size limit. Any trend confirmation is another hypothesis that counts in the trial inventory. Do not infer that a higher threshold predicts a larger net payoff. Four-hour bars can gap through a stop; the stop price is not a guaranteed fill.

**Coqui reuse:** [breakout.ts](../../packages/core/src/research/breakout.ts) already produces shadow assessments with execution disabled. Its cost-margin heuristic is a screen, not calibrated expected return. Preserve that distinction in reporting.

**Reject if:** the next executable entry gives back the apparent signal, results fail after spread/slippage stress, or the policy is simply a more expensive version of the slow trend signal. Count false starts and their aggregate dollar losses.

### 4. Bounded mean reversion: investigate, do not presume

**Mechanism:** temporary liquidity demand can move a price away from a local equilibrium. The problem is distinguishing a temporary dislocation from new information or a collapsing asset. The pairs literature does not resolve that distinction for a single long-only coin.

**Proposed rule:** only consider an eligible liquid asset under a predeclared market/range condition. Enter once after a sufficiently large standardized pullback; close on a declared reversion, time limit or risk condition. Freeze maximum exposure and cumulative loss treatment. No averaging down, martingale sizing, or extension of the exit after seeing a loss.

**Adaptation:** target moves that might plausibly exceed the complete round-trip hurdle; estimate that relationship from development data rather than treating historical range width as expected profit. Study missed opportunities and adverse excursion as well as winning-trade percentage. Risk exits must not depend on a favorable expected-profit screen.

**Coqui reuse:** [range-rotation.ts](../../packages/core/src/research/range-rotation.ts) and its [study note](wider-range-rotation-v1-2026-09-27.md) already combine range conditions, relative strength and bounded positions. Its `benefitRealization: 0.5` discounts a range-derived opportunity proxy; that is not measured evidence that half the range will be captured.

**Reject if:** costs consume ordinary wins, a few breakdowns dominate the distribution, results require deleting crashes, or the method cannot add value versus trend/cash on the same universe and execution assumptions. This candidate has weaker direct evidence for our proposed spot adaptation than the trend hypotheses.

### 5. Fixed blends before a more elaborate market selector

A small fixed blend can test whether different signals make different mistakes. Trend and breakout often express similar directional exposure, so two labels are not automatically diversification. Compare realized return correlation, turnover overlap and joint drawdowns; measure these on development data and test their stability later.

Coqui already has a [shadow market selector](../../packages/core/src/research/market-selector.ts), with trend, breakout, range and cash states. Its presence does not establish that state classification predicts which strategy will win. The [selector study](market-selector-v1-2026-09-27.md) remains the authority for its evidence and identity requirements.

For a separate comparison, use a predeclared static blend as a benchmark for switching. Aggregate target exposures before planning actual orders, and retain separate signal attribution. This can avoid allocating tiny physical sleeves and crossing one signal's buy with another's sell. It does not authorize extra total exposure. Charge switching costs to the selector's actual portfolio, not to a hypothetical combination of each strategy's best standalone holdings.

Reject the added complexity if a single policy explains the outcome or improvements fail after accounting for selection and turnover. Do not select whichever strategy performed best in the same period that defines the state label.

### 6. A small calibrated filter, not a return guarantee

After a baseline survives, compare a regularized linear model and a shallow tree using a small frozen feature set: trailing returns, volatility and observed liquidity/spread conditions. Predict a specified after-cost outcome at the intended holding horizon, or estimate expected gain/loss magnitudes alongside probability. Trading profitability depends on both payoff sizes and their probabilities.

Coqui's [selective participation study](selective-participation.md) already contains bounded ridge/tree hypotheses, chronological training/calibration, cost treatment, coverage and evidence gates. Its [calibration module](../../packages/core/src/research/overlay/calibration.ts) measures probability quality. Reuse that machinery; this review neither registers an alternative nor relaxes the existing requirements. Its design enumerates 470 variants; that does not mean all were run or that they provide independent confirmations. Every variant actually tried belongs in the trial history.

Train only on outcomes fully observed before the fitting cutoff. Purge overlapping label horizons around split boundaries. Keep all same-date assets together when forming time splits. Evaluate calibration, realized economic value, turnover, coverage and uncertainty; high directional accuracy alone is insufficient. Missing inputs should produce the declared fallback, not silent imputation using future information.

Attention/news is a later feature family motivated by Liu and Tsyvinski. Coqui already has [news research infrastructure](news-intelligence-rollout-2026-10-09.md). A new sentiment model is not a missing basic capability, and there is no basis here to claim news alpha. First-available timestamps, revisions, collection rights, mapping quality and marginal data cost must be accounted for. Backfilled articles cannot become historically available predictors.

### Execution and risk overlays must earn their place separately

Gârleanu and Pedersen model joint decisions about persistent predictors and costly adjustment. Their continuous portfolio model motivates a partial-adjustment benchmark, not a ready-made optimum for a small constrained crypto account. Test the same signal with and without discretionary no-trade bands, rank buffers or partial adjustment; measure both saved costs and missed returns. Incoming contributions can reduce underweights without forced offsetting sales. [Dynamic trading manuscript](https://nbgarleanu.github.io/DynTrad.pdf).

Volatility scaling is a risk/allocation component, not an independent price forecast. Cederburg and coauthors find no systematic direct outperformance across 103 equity strategies and weak real-time results for certain implementations. Test causal trailing estimates with no leverage, exposure caps and actual trade costs; do not normalize using full-sample future volatility. [Volatility-management counterevidence](https://www.lehigh.edu/~xuy219/research/COWY.pdf).

## Ideas to defer for the first small-account version

| Family | Why it is lower priority here | What would justify reconsidering it |
|---|---|---|
| Hedged pairs/statistical arbitrage | Two legs, short access or derivatives, funding/borrow and hedge execution; removing one leg changes the bet | A separately authorized instrument scope, complete cost model and robust executable evidence |
| Cross-exchange arbitrage | Capital split among venues, transfer delays, venue/currency segmentation and custody exposure | Measured simultaneous executable spreads after all costs and pre-positioned capital requirements |
| High-frequency market making | Queue priority, adverse selection, inventory, cancellation latency, outages and fee tier determine fills | Event-level data and a validated fill/latency model under the actual venue terms |
| Perpetual-funding/cash-and-carry | Derivatives, liquidation/margin and basis/funding risks; positive quoted yield is not locked net profit | Explicit scope change and complete hedge, funding and stress accounting |
| Dense grid or martingale | Inventory can accumulate during a persistent decline; many small realized wins can hide a large open loss | A bounded risk hypothesis evaluated on total marked equity, not winning-order counts |
| Large RL/deep-learning search | Flexible policy and simulator assumptions multiply overfitting opportunities | A reliable baseline, realistic environment and genuinely independent data |

Makarov and Schoar document persistent crypto price differences and market segmentation; the existence of spreads is not evidence that a small account can capture them. Avellaneda and Stoikov provide an inventory-based market-making model, whose stylized execution assumptions need separate empirical validation. These are reasons to model access and execution, not a claim that the entire strategy families are unprofitable. [Arbitrage manuscript, December 2018; journal 2020](https://www.fmg.ac.uk/sites/default/files/publications/DP782.pdf), [Market-making model](https://math.nyu.edu/inmemoriam/avellaneda/HighFrequencyTrading.pdf).

Broader equity/ETF asset allocation is a legitimate future research direction and may provide more distinct exposures than many correlated coins. It requires instrument support, venue rules, schedules and data beyond this crypto study; changing asset classes is not a parameter adjustment.

## Concrete economic hurdles, without invented performance

For a simplified binary trade with win probability `p`, average gross winning return `a`, average gross loss magnitude `b`, and constant round-trip cost `c`, all measured on the same invested notional:

```text
expected net return = p*a - (1-p)*b - c
break-even p = (b+c)/(a+b)
```

This is an additive approximation with fixed average payoffs and costs, not an exact broker fee model or an estimate of Coqui's win probability. Tail losses, path-dependent exits and variable slippage require a fuller distribution.

| Hypothetical average win | Average loss | Round-trip cost | Break-even win rate | Interpretation |
|---:|---:|---:|---:|---|
| 0.6% | 0.4% | 0.8% | 120% | Impossible under these payoff assumptions |
| 2.0% | 1.0% | 0.8% | 60% | A 60% win rate only breaks even |
| 5.0% | 2.0% | 0.8% | 40% | Larger payoffs allow a lower threshold; they are not easier or assured |

The 0.8% is an illustrative all-in scenario, not a venue quote. For comparison, 0.25% fees deducted on each received asset/cash leg alone require approximately **0.501881% price appreciation** to break even, before spread/slippage. The exact fee-only equation is `1/((1-f_buy)*(1-f_sell))-1`.

Suppose, purely hypothetically, a strategy wins 65% of trades with the 2%/1% payoffs above and 0.8% cost. Its expected net return is 0.15% of traded notional. A position using 25% of a $500 account is $125, so expected profit per such trade is **$0.1875**, with substantial outcome uncertainty. It is not $0.75, which would assume the whole account is invested in every trade. At the same assumed fractional exposure the corresponding figures are $0.0375 for $100 and $1.875 for $5,000. These are arithmetic examples, not targets, backtests or independent repeated-trade forecasts.

This explains why increasing order frequency to reach a dollar target can make outcomes worse. Track strategy return before fixed overhead, the actual user net result after overhead, and cumulative withdrawals separately. Profit withdrawal should be evaluated as a separate capital policy after the signal/execution test. A reserve reduces future market exposure and compounding capital; an executed sale or transfer cannot guarantee positive total lifetime profit.

The companion [arithmetic and source evidence JSON](small-portfolio-strategy-evidence-2026-10-23.json) records exact decimal inputs, outputs, inspected local source hashes and the fact that no market performance was simulated.

## A bounded first experiment

This is a suggested design to make the research actionable, not a registered study. Existing owner, cost, data, trial-inventory, coverage, holdout and promotion gates remain binding.

1. **Establish feasibility first.** Reuse the prior capital grid: $50, $100, $250, $500, $1,000, $2,500, $5,000 and $10,000, with $100,000 as a control. Parameterize accounting and metrics consistently. An infeasible cell is a result; do not silently raise capital or remove skipped trades.
2. **Limit the first signal contest.** Use BTC/ETH plus fiat cash as a deliberately simple, prospective research universe. Compare passive holdings, the current allocator, one simple trend/cash candidate and one buffered rotation candidate. Retain cash as an opportunity-cost reference. Set the holding count and exposure caps before inspecting outcomes. Broader historical-universe rotation is a subsequent study, not a way to rescue the first result.
3. **Freeze a small selection procedure.** If comparing two discretionary cadences or with/without volatility sizing, enumerate all variants in advance. Reuse an identical execution policy initially. Separate signal ablations from execution ablations so a change in two components cannot be credited to one. The current allocator is an operational comparator, not a validated gold standard.
4. **Execute honest orders.** Use completed bars with availability delays, subsequent execution, venue-specific instrument rules, fee denomination, rounding, partial fills where supported, cash reservation and residual positions. Evaluate current modeled terms and a separately labeled conservative stress profile. Preserve historical frozen cost identities.
5. **Use development and fresh evidence correctly.** Do not reopen the consumed TrendVol holdout as a new final test. Use chronological selection with appropriate purge/embargo, then a genuinely uninspected period or prospective data. Record every attempted rule, threshold and data-driven exclusion. A new date range alone is not independent if it has already informed the researcher.
6. **Report capital-specific net results.** Include excess return versus passive and a training-calibrated constant cash/asset exposure comparator; drawdown, time underwater, worst rolling outcomes, turnover, total fees/slippage, concentration, rejected orders, idle cash and forced-exit feasibility. Show both total percentage and dollar outcomes. Attribute market beta/exposure before claiming alpha.
7. **Require a stable improvement.** Use paired time-series uncertainty estimates that respect dependence; make multiple-testing adjustments and report unavailable statistics honestly. PBO and deflated Sharpe are diagnostics rather than substitutes for independent evidence. A lower drawdown can be useful without establishing return alpha. Failing a predeclared gate must remain a failed result. [PBO manuscript](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf), [Deflated Sharpe](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).

No immediate combination of all seven candidates is recommended. A broad reading list can feed a narrow frozen experiment. If the first candidates fail, preserve the result before advancing to the next hypothesis; repeated adaptations on the same exposed data are further trials.

## Annotated primary reading list and access limits

The descriptions below are intentionally brief. “Sections inspected” does not claim an independent audit of equations, tables, datasets or code. No paper's advertised return is presented as an expected retail return.

| # | Paper / record | Access used and contribution | Transfer limitation |
|---|---|---|---|
| 1 | Moskowitz, Ooi & Pedersen (2012), [Time series momentum](https://fairmodel.econ.yale.edu/ec439/mosk.pdf) | Accessible paper introduction/method context; own-return persistence across futures | Broad long/short futures portfolio differs from long-only spot |
| 2 | Faber (2007; updated 2013), [A Quantitative Approach to Tactical Asset Allocation](https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf) | Author PDF rule/execution sections; monthly trend/cash example | Traditional asset history; same-close convention needs executable lag |
| 3 | Huang, Li, Wang & Zhou (2020), [Time series momentum: Is it there?](https://scholars.hkbu.edu.hk/en/publications/time-series-momentum-is-it-there-2/) | Author institution abstract/metadata; historical-mean comparison challenges predictability | Abstract-level review; no reproduced tests |
| 4 | Liu & Tsyvinski (2021 issue; online 2020), [Risks and Returns of Cryptocurrency](https://academic.oup.com/rfs/article-abstract/34/6/2689/5912024) | Publisher abstract; crypto momentum and attention | Historical prediction is not current executable profit |
| 5 | Liu, Tsyvinski & Wu (2022), [Common Risk Factors in Cryptocurrency](https://onlinelibrary.wiley.com/doi/10.1111/jofi.13119) | Publisher/society abstract; market, size and momentum attribution | Long/short factors and broad universe |
| 6 | Grobys et al. (2025), [Cryptocurrency momentum has (not) its moments](https://link.springer.com/article/10.1007/s11408-025-00474-9) | Open paper introduction/results discussion; crashes and tail sensitivity | Short-leg losses and trimming are not our long-only construction |
| 7 | Hudson & Urquhart (online 2019; issue 2021), [Technical trading and cryptocurrencies](https://link.springer.com/article/10.1007/s10479-019-03357-1) | Open paper rules and out-of-sample section; favorable and unfavorable results | Many trials, historical sample and shorting assumptions |
| 8 | Bajgrowicz & Scaillet (July 2009 manuscript; journal 2012), [Technical trading revisited](https://access.archive-ouverte.unige.ch/access/metadata/008c418e-66cf-42a0-84b4-ece93d36af00/download) | Author-deposited introduction; persistence and cost counterevidence | DJIA rather than crypto; accessible version differs from final article |
| 9 | Gatev, Goetzmann & Rouwenhorst (2006), [Pairs Trading](https://depot.som.yale.edu/icf/papers/fileuploads/2573/original/08-03.pdf) | Author manuscript introduction; paired relative-value construction | Equity long/short substitution is not single-coin dip buying |
| 10 | Tadi & Witzany (2025), [Copula-based trading of cointegrated cryptocurrency Pairs](https://link.springer.com/article/10.1186/s40854-024-00702-7) | Open methods/assumptions/results sections; formation cycles and cost sensitivity | USDT-margined futures, hedge legs and simulated execution |
| 11 | Makarov & Schoar (2020 journal; December 2018 manuscript), [Trading and Arbitrage in Cryptocurrency Markets](https://www.fmg.ac.uk/sites/default/files/publications/DP782.pdf) | Accessible manuscript introduction; segmentation and persistent spreads | Access/capital constraints prevent equating spreads with capture |
| 12 | Avellaneda & Stoikov (2008), [High-frequency trading in a limit order book](https://math.nyu.edu/inmemoriam/avellaneda/HighFrequencyTrading.pdf) | Author paper introduction/model context; inventory-aware quoting | Stylized fills do not validate retail queue/latency economics |
| 13 | Gu, Kelly & Xiu (2020), [Empirical Asset Pricing via Machine Learning](https://academic.oup.com/rfs/article/33/5/2223/5758276) | Publisher abstract/introduction; interactions and regularization | Large US equity panel differs from sparse correlated crypto observations |
| 14 | Lim, Zohren & Roberts (2019; revised 2020), [Enhancing Time Series Momentum Strategies Using Deep Neural Networks](https://arxiv.org/html/1904.04912v3) | Open methods/turnover sections; cost-aware objective and regularization | Futures universe and cost scale; unregularized advantage is fragile |
| 15 | Gârleanu & Pedersen (2013 journal; March 2012 manuscript), [Dynamic Trading with Predictable Returns and Transaction Costs](https://nbgarleanu.github.io/DynTrad.pdf) | Accessible author manuscript abstract/introduction; persistence-aware partial adjustment | Model parameters and constraints are not established for Coqui |
| 16 | Cederburg, O'Doherty, Wang & Yan (2020), [On the performance of volatility-managed portfolios](https://www.lehigh.edu/~xuy219/research/COWY.pdf) | Author paper abstract/introduction; real-time counterevidence | Equity strategies; motivates an ablation, not a universal prohibition |
| 17 | Bailey et al., [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) | Author manuscript, also reviewed in the companion research; selection diagnostic | No diagnostic repairs a reused holdout or incomplete trial history |
| 18 | Bailey & López de Prado (2014), [The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) | Author manuscript, also reviewed in the companion research; selection/non-normality adjustment | Requires defensible inputs; not proof of future profit |
| 19 | Fang et al. (2022), [Cryptocurrency trading: a comprehensive survey](https://link.springer.com/article/10.1186/s40854-021-00321-6) | Open introduction/taxonomy; maps technical, statistical, ML and portfolio work | Its 146-paper coverage is not 146 papers independently reviewed here or 146 profitable replications |

Publisher dates, manuscript dates and issue dates are kept distinct. Access failures were resolved with author/institutional records where available; abstract-level sources support only abstract-level claims. The 2025 papers add useful contrary evidence but do not make the review exhaustive through October 2026.

## Delivery and verification

Only this report and its companion evidence JSON were added for this follow-up. Strategy/runtime source and prior studies were read, not changed. Exact-decimal arithmetic, JSON structure, local link resolution, source hashes and artifact whitespace are checked separately. Documentation checks are not strategy tests. Earlier source-probe/test results belong to the October 22 report and are not represented as newly rerun here.

Research output remains local and uncommitted. This report supplies proposed experiments; it does not establish a minimum profitable account, select production defaults, approve registrations or satisfy prospective observation/review/release gates.

**Prompt used**

Ok thats good, both that and the last thing you said. Now I want you to do deep research on algorithmic trading and quantitative trading for smaller portfolios. We could also use general quant and algo information and adapt that to work with smaller portfolios
