# Quantitative trading for small portfolios

Research date: October 22, 2026, America/Phoenix. Scope: USD-denominated, unlevered spot-crypto research for starting balances of $50, $100, $250, $500, $1,000, $2,500, $5,000 and $10,000, with $100,000 retained only as a comparison. This is research and synthetic source verification; no account, trading policy, registration or release changed.

Coqui should establish whether its strategies remain feasible at retail balances before adding profit withdrawals. The central requirement is a **capital feasibility model** that combines actual venue rules, current fees, cash availability, target changes and risk limits. A $100,000 result cannot simply be multiplied by 0.005 to describe a $500 account when orders have minimum sizes and rounding constraints.

Small portfolios can support fractional trading. Purely percentage-based fees also scale proportionately. The relevant disadvantages are fixed costs, order-size constraints, fee-tier access, concentrated feasible allocations and limited dollars available for either compounding or payouts. Small size can reduce market impact; it does not remove spreads, execution uncertainty or the need for a genuine strategy advantage.

## Main findings for Coqui

| Finding | Evidence | Implication |
|---|---|---|
| Daily and intraday parallel paper paths enforce $25 minimum orders | [Daily execution](../../packages/services/src/paper/parallel-paper-daily.ts), [intraday execution](../../packages/services/src/paper/parallel-paper-intraday.ts) | At $100, that is a 25% account adjustment. A small desired trade can be skipped even when the venue supports fractional units. |
| The research execution planner also enforces $25 after rounding | [Planner](../../packages/core/src/execution/remediation-planner.ts) | Capital changes can alter the order sequence and cash exposure. Return curves cannot be scaled mechanically. |
| Account-size helpers exist, but production integration was not found | [Sizing helpers](../../packages/core/src/risk/portfolio-sizing.ts), [their tests](../../tests/portfolio-sizing.test.ts) | Source searches found definitions and test calls, with no production calls to `resolvePortfolioSizingPolicy`, `guardrailsForPortfolioSizing` or `buyCandidateConfigForPortfolioSizing`. Do not infer active account-size adaptation from the helpers' presence. |
| Some helper settings are internally infeasible at small balances | [Sizing](../../packages/core/src/risk/portfolio-sizing.ts), [guardrails](../../packages/core/src/risk/autotrade.ts), [candidate allocation](../../packages/core/src/strategies/buy-candidates.ts) | If adopted unchanged, minimum orders, turnover limits and candidate weights can conflict. This is a design finding, not evidence of an installed-account incident. |
| Certain research books and return denominators assume $100,000 | [Opening book](../../packages/core/src/execution/remediation-book.ts), [evaluation](../../packages/core/src/research/remediation-evaluation.ts), [hourly shadow](../../packages/services/src/paper/parallel-hourly-shadow.ts) | A retail-capital experiment needs explicit opening-capital identity throughout accounting and metrics, not a changed opening cash literal alone. |
| A synthetic $20 required exit is rejected by the research planner | [Source probe](small-portfolio-source-probe-2026-10-22.json) | Discretionary trade floors need separate treatment from risk-reducing full closures. Venue minima and all safety gates still apply. |

The repository remains paper-only. The prior [profit distribution report](profit-distribution-and-quant-research-2026-10-22.md) describes an additional policy proposal; neither report establishes a real-order or withdrawal capability.

## What actually changes with account size

### Percentage fees and fixed costs are different problems

At the same fee rate, a $10 trade and a $1,000 trade incur the same percentage charge. The fixed-cost literature explicitly distinguishes that scale invariance from the burden of a dollar charge per transaction. Its models support intervals in which no trade is optimal; numerical examples with mixed costs also show that the policy changes with wealth. These are theoretical motivations for testing account-dependent execution, not a prescription for Coqui's thresholds. [Fixed-cost asymptotics](https://arxiv.org/abs/1306.2802), [fixed and proportional costs](https://arxiv.org/pdf/1610.03958).

As checked on the research date, Alpaca's published first volume tier lists 0.15% maker and 0.25% taker crypto fees. Its documentation charges fees in the received asset or cash. The account's actual terms and booked fees remain authoritative. Coinbase Advanced states that fees vary by product, tier and liquidity role; its exact applicable rates require account-specific information. [Alpaca fee schedule](https://docs.alpaca.markets/us/docs/crypto-fees), [Coinbase Advanced fees](https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/advanced-trade-fees).

Using 0.25% per side strictly as an illustration:

| Order notional | One-way fee before rounding | Percentage |
|---|---:|---:|
| $5 | $0.0125 | 0.25% |
| $10 | $0.0250 | 0.25% |
| $25 | $0.0625 | 0.25% |
| $100 | $0.2500 | 0.25% |
| $1,000 | $2.5000 | 0.25% |

With a buy fee deducted from received crypto and a sell fee deducted from cash, the fee-only round-trip break-even price gain is:

```text
break-even gain = 1 / ((1 - buy fee) * (1 - sell fee)) - 1
0.25% on each side → approximately 0.501881% price appreciation
```

This excludes spread, slippage, taxes and fee rounding. It is the same percentage hurdle at each capital level under these assumptions. Lowering a discretionary $25 floor is therefore worth investigating where venue rules permit it; a universal claim that every smaller trade is uneconomic would be wrong.

Fixed expenses behave differently. A hypothetical $10 monthly data or hosting expense is $120 annually: 24% of $500, 12% of $1,000, 2.4% of $5,000 and 1.2% of $10,000. These are not Coqui subscription prices. Research should include only costs actually paid or explicitly modeled, including a zero-extra-overhead case.

### Minimum orders create capital thresholds

The following is arithmetic from the current $25 Coqui policy, not a venue eligibility table:

| Starting balance | $25 as account percentage | 1% target adjustment | 5% target adjustment |
|---|---:|---:|---:|
| $50 | 50% | $0.50 | $2.50 |
| $100 | 25% | $1.00 | $5.00 |
| $250 | 10% | $2.50 | $12.50 |
| $500 | 5% | $5.00 | $25.00 |
| $1,000 | 2.5% | $10.00 | $50.00 |
| $2,500 | 1% | $25.00 | $125.00 |
| $5,000 | 0.5% | $50.00 | $250.00 |
| $10,000 | 0.25% | $100.00 | $500.00 |
| $100,000 | 0.025% | $1,000.00 | $5,000.00 |

For a 5% intended entry and a $25 minimum, the simple capital threshold is $25 / 0.05 = $500. For a 2% intended entry it is $1,250. Neither calculation establishes profitability or complete feasibility; cash reservations, position limits, quantity increments and other orders can make a plan infeasible above that amount.

For routine rebalancing, the effective threshold depends approximately on the larger of the configured drift band and minimum order divided by equity, with additional venue rounding. The daily path uses a 5-percentage-point band and the intraday path a 1-point band. Boundary comparisons differ across planners, so exact equality requires a source-specific check. A $25 floor can make a nominal 1-point policy behave much more coarsely on a $100 account.

Alpaca documents fractional orders and asset-specific `min_order_size` and `min_trade_increment` fields. Coinbase exposes base/quote minima and increments. Documentation examples and older support tables are not current product-rule observations. The $25 Coqui floor must be distinguished from the venue's actual minimum; this research does not claim a universal $1 or $25 venue minimum. [Alpaca crypto orders](https://docs.alpaca.markets/us/docs/crypto-orders), [Alpaca asset rules](https://docs.alpaca.markets/us/docs/crypto-trading), [Coinbase product schema](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product).

### Turnover matters even when individual fees look small

Define one-way turnover as the sum of absolute buy and sell notionals divided by reference equity. Buying $100 and later selling $100 in a $500 account is 40% turnover, before prices change.

| Monthly turnover | Cost at 0.25% per dollar traded | Cost at Coqui's legacy 0.85% model |
|---|---:|---:|
| 10% of equity | 0.025% of equity | 0.085% of equity |
| 100% of equity | 0.25% of equity | 0.85% of equity |
| 600% of equity | 1.50% of equity | 5.10% of equity |

These are arithmetic charges on a fixed reference balance, not compounded return forecasts. The 0.85% column is the local 60 bps fee plus 10 bps spread plus 15 bps slippage assumption in the [legacy cost model](../../packages/core/src/costs/index.ts); it is not a current broker fee quote and excludes the guardrail model's separate impact term. Preserve frozen historical cost profiles while registering new scenarios explicitly.

Barber and Odean's household evidence links heavy trading with poor net outcomes. A more recent controlled equity-trading experiment finds substantial execution-cost differences across brokers even before commissions. Neither study measures Coqui's crypto execution, but both support measuring the complete cost of trading rather than counting orders or treating “commission free” as cost free. [Household trading study](https://faculty.haas.berkeley.edu/odean/Papers%20current%20versions/Individual_Investor_Performance_Final.pdf), [retail execution experiment published in 2025](https://onlinelibrary.wiley.com/doi/10.1111/jofi.13467).

## Source verification and limitations

The [reproducible probe](small-portfolio-source-probe-2026-10-22.mjs) imports the unchanged TypeScript source under Node 24 using a local extension-resolution hook. It uses one fictional asset priced at $100, zero spread, fine synthetic increments and ample order limits. It opens no database and calls no venue.

- A 5% target from cash at $100 produces a $5 desired order, rejected as `minimum_after_rounding`.
- At $500, that target produces one $25 order.
- A $100 book containing a $20 position marked `requiredExit` produces no sell: the research planner still rejects its notional below $25.
- The probe records the source hashes, capital grid, helper settings and exact fee-only break-even arithmetic. These are software observations, not market backtest results.

Run after installing the repository's existing dependencies:

```sh
node docs/studies/small-portfolio-source-probe-2026-10-22.mjs > /tmp/coqui-small-portfolio-probe.json
```

The committed source path is not sufficient provenance for a dirty working tree, so the saved [probe output](small-portfolio-source-probe-2026-10-22.json) includes hashes of relevant local modules. Existing targeted tests also passed: **3 files / 26 tests** covering portfolio sizing, auto-trade guardrails and the remediation planner. They do not establish production integration or successful broker execution.

Two helper conflicts deserve explicit design treatment:

1. Below $100, the helper permits 8% turnover per run while requiring at least $25 per trade. Those conditions cannot both admit an ordinary order in that tier. At $100, its 16% turnover cap is $16, also below the minimum. No production calls to this helper were found, so this is a prospective integration problem.
2. At $500, the small-account helper allocates a 4% candidate sleeve. With two candidates selected, each target is 2%, or $10, below the $25 minimum. Even one candidate would receive only $20. Two 2% entries need $1,250 before other constraints, outside the helper's below-$1,000 small tier. A higher score threshold does not resolve this arithmetic.

The current research planner's required-exit case and the ordinary paper paths' size floor motivate separate tests for complete risk-reducing closures, residual balances and assets that fall below minima after a loss. They do not authorize bypassing venue rules, reconciliation, kill behavior or order permissions. Some genuinely subminimum residuals may be impossible to sell through a given venue API; the UI must report that exposure truthfully.

## Strategy design for realistic retail balances

### Test fewer discretionary adjustments and robust baselines

Gârleanu and Pedersen show how trading decisions can account jointly for predictable returns, their persistence and costs. Their model requires estimates Coqui has not established. The practical experiment is a bounded comparison of existing signals with different discretionary adjustment policies. Monitoring can remain frequent while trades occur only when justified; a daily or weekly review must not disable independently required risk checks. [Dynamic trading](https://nbgarleanu.github.io/DynTrad.pdf).

Compare equal-weight and passive holdings with the current allocator before adding a more elaborate optimizer. DeMiguel, Garlappi and Uppal find no consistently superior optimized rule across their tested models and datasets. That supports a strong simple benchmark, not a universal conclusion that equal weight is best. Crypto concentration and transaction costs still need separate analysis. [Optimal versus naive diversification](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1376199).

### Fewer assets can improve feasibility but increase concentration

Testing one or two liquid spot assets plus cash can make small-account mechanics easier to understand. It is not broad diversification, and adding many highly correlated coins does not necessarily solve that problem. Fractional trading means small balance alone does not mathematically require concentration when costs are proportional.

Evidence also cautions against using small size to justify an undiversified portfolio. Goetzmann and Kumar find costly under-diversification, with little evidence that portfolio size or transaction costs explains it in their U.S. sample. Campbell, Ramadorai and Ranish find that larger Indian accounts obtain better average log returns through diversification even though average simple returns are no higher. Different markets and periods limit transfer to crypto; the relevant lesson is to measure compounded outcomes and concentration instead of admiring a few outsized winners. [U.S. diversification study](https://academic.oup.com/rof/article-abstract/12/3/433/1598033), [Indian account-size evidence](https://www.aeaweb.org/articles?id=10.1257/aeri.20180158).

A +50% period followed by a -50% period leaves capital down 25%. A small account does not become more suitable for leverage or speculative small coins merely because its absolute dollar gains are modest. Coqui should retain its unlevered scope and report cash as a valid outcome when the requested risk/size combination is infeasible.

The recent crypto survey emphasizes common factors, frequent large jumps and data-quality issues. It supports historically eligible universes and jump/correlation stress. It does not validate a basket of low-price coins as a small-account growth strategy. Coin unit price is not the same as valuation, liquidity or return potential. [2026 crypto survey](https://arxiv.org/html/2510.14435v4).

### Contributions should be modeled as cash flows

A retail user may contribute $25 or $50 when funds become available. At zero market return, $500 plus twelve $50 contributions becomes $1,100. The additional $600 is funding, not trading profit. A hypothetical 20% net return on the initial $500 is $100; this comparison illustrates scale, not an expected return or a model of returns on dated contributions.

Add a proposed cash-flow allocation rule that directs new available contributions toward eligible underweights before selling other positions solely to rebalance. Always recheck the current signal and risk limits: contributions must not force a purchase of an asset the algorithm no longer wants. Track contribution timing, missed or stopped contributions and withdrawals. Do not ask for a deposit as a remedy for trading losses or imply that contributions create alpha.

Report both time-weighted strategy performance and a money-weighted user outcome. Additional deposits must not inflate profitability, trigger profit harvesting or reset a loss history. Household-finance research stresses that borrowing constraints, income risk and other personal commitments are absent from many textbook portfolio models. An implementation should make funding assumptions explicit rather than treating a retail account as an institution with unlimited liquidity. [Household Finance](https://www.nber.org/papers/w12149).

### Automation must improve decisions without encouraging activity

Robo-adviser evidence finds benefits that vary with investors' prior diversification, alongside increased trading for some users. Retail-trade evidence also shows why a predictive aggregate signal can coexist with poor actual investor outcomes, including worse performance among smaller trades concentrated in attention-grabbing stocks. Neither establishes that a small Coqui account will lose or profit; they support evaluating actual portfolio construction, costs and behavior. [Robo-advising](https://academic.oup.com/rfs/article-abstract/32/5/1983/5427774), [retail-trading paradox](https://faculty.haas.berkeley.edu/odean/Papers%20current%20versions/resolving_a_paradox_retail_trades_positively_predict_returns_but_are_not_profitable.pdf).

Useful user feedback includes “target adjustment $4.20; policy minimum $25; no order placed,” together with the remaining exposure and reason. A no-trade period should be distinguishable from missing observations, stale data, an unknown order or an unavailable host. Avoid a target number of daily trades, income promises and rewards for trade streaks.

## Features to prioritize

| Priority | Proposed addition | Required behavior |
|---|---|---|
| 1 | Capital feasibility report | For the selected account and strategy, show executable target sizes, blocked adjustments, reserve needs, rounding loss and the binding constraint. Derive limits from actual rule observations and policy identity. |
| 2 | Shared account-aware execution policy | Reconcile active paper planners and dormant helpers. Separate venue minimum, discretionary economic minimum and full-exit handling. Preserve cash conservation and all existing safety gates. |
| 3 | Size sensitivity in research | Parameterize opening capital and every denominator; replay each balance independently with venue increments, fees and attainable prices. Preserve existing $100,000 studies. |
| 4 | Cash-flow allocation and truthful performance | Use actual dated contributions and withdrawals; prefer eligible cash-funded adjustments over unnecessary sales; expose funding separately from returns. |
| 5 | Cost and turnover budget | Show projected and realized friction in both dollars and percent of equity. Include actual fixed overhead and withdrawal expenses where applicable. |
| 6 | Residual-position and exit reporting | Distinguish an optional adjustment below the policy floor from a required closure constrained by a genuine venue minimum. Never silently call residual exposure zero. |
| 7 | Later profit distribution options | Accumulate a reserve or batch payouts without reducing the book below its feasible operating balance. Let the user choose income versus accumulation explicitly. |

An illustrative capital grouping for experiments is below. These are engineering cohorts, not recommended investments or established minimum balances:

| Balance cohort | Experiment emphasis |
|---|---|
| $50–$250 | Fractional-order feasibility, capital accumulation, residual exits and whether any proposed discretionary trade can satisfy all constraints. Cash/no trade remains valid. |
| $500–$1,000 | Compare simple liquid-asset allocations, cost-aware adjustment and cash-flow allocation; quantify how many desired signals remain blocked. |
| $2,500–$5,000 | Test whether smaller proportional adjustments become attainable and whether additional assets actually improve net outcomes. |
| $10,000 | Broader comparison while retaining retail fees and overhead assumptions; do not infer sustainable income. |

An amount sufficient for one 5% entry is not automatically sufficient for a complete multi-asset strategy. The eventual supported minimum should be a documented feasible region conditional on strategy, venue, risk choices and costs, rather than a marketing number.

## Implications for profit withdrawals

At $500, a hypothetical 10% profit is $50. Reserving 25% produces $12.50 and leaves $537.50 in trading capital before sale/payout costs and taxes. At $1,000 the same assumptions produce a $25 reserve. These are much smaller payments than a large-account illustration suggests.

The earlier proposed $500 profit milestone would require a 100% cumulative gain on an unchanged $500 funding base, not a routine payout. Small-account experiments need independently declared percentage and dollar thresholds rather than copying the larger account example.

If a payout had a hypothetical $1 fixed charge and the user capped that charge at 1% of the payment, the payout would need to be at least $100. At a 25% profit share, that requires $400 of eligible profit. Actual charges may be zero or different; obtain the destination/rail quote before applying this rule. Fixed-cost dividend theory motivates batching, but does not determine Coqui's thresholds. [Dividend policy with costs](https://arxiv.org/abs/1301.7525).

Offer accumulation, reserved-profit and distribution preferences without equating them with risk tolerance. Small-account users may still value income; they should see its effect on future capital feasibility. Fund reserves from available reconciled cash or otherwise justified sales when possible. A $12.50 cash payout does not inherently require a $12.50 crypto sale; avoid assuming sale minima and payout minima are identical. Keep tax provisioning, prior-loss offsets, contribution adjustment and assessed-profit watermarks from the earlier proposal.

## Research design before implementation

### Establish mechanics before searching for returns

First freeze the current strategy and replay its decisions independently at each capital level. Preserve fees, availability times, venue rules, cash buffers, partial fills and quantity precision. Record accepted orders, rejected intentions, average realized weight error, idle cash and residual exposure. If historical rule observations are unavailable, use clearly labeled static-rule scenarios rather than claiming reconstructed historical feasibility.

Then compare a small preregistered policy set: the unchanged $25 baseline, a venue-aware smaller discretionary threshold, and a cost-aware band/cash-flow variant. Values such as $5 or $10 are candidate settings only where native rules permit; do not weaken risk limits to make them pass. Test new target reductions and compulsory exits separately from routine drift. Keep passive BTC, an explicitly eligible equal-weight portfolio and cash controls at the same capital and cash-flow schedule.

Use the same strategy/policy family across balances for the primary question. Choosing a different winner at every balance creates additional selection. The capital grid is also one shared market history, not nine independent confirmations of alpha. Record all policy, capital and cost variants in trial accounting; freeze a candidate or none before an untouched evaluation. [Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).

Cost scenarios should include the account's applicable fee profile when verifiable, a conservative profile, doubled variable friction and actual fixed expenses. Also compare no contributions, predeclared periodic contributions and interrupted contributions. Policy details and historical availability must be frozen before performance inspection; a successful synthetic probe does not register or qualify a study.

### Evaluate the result a retail user experiences

Report ending capital, cumulative funding, actual net P&L, time-weighted returns, dated money-weighted returns, drawdown and time below the feasible operating minimum. Include dollars lost to trading and operating costs, missed target changes, residual untradeable value and capital returned. Show the user outcome after any modeled recurring charges separately from strategy performance before those charges.

Preregister a feasibility criterion before alpha assessment: accepted target changes, maximum tracking error, risk-exit handling and worst residual exposure must meet declared requirements. An inactive account can have low measured volatility simply because its orders were blocked. Treat low activity from infeasibility separately from deliberate signal abstention.

Evaluate net advantage against matched simple controls, cost sensitivity and uncertainty using the existing research governance. Re-run path-dependent allocation and cash flows inside each resampled market path; preserve serial and cross-asset dependence. Stress price gaps, correlation spikes, stale data, unavailable venues, delayed fees, restarts and crossings between capital thresholds. No chosen calendar duration or dollar balance proves enough statistical power.

### Engineering acceptance before prospective observation

Required checks include exact cash/fee conservation, amount- and quantity-based venue rules, post-rounding minimum validation, fee debits in the received asset, no duplicate orders after restart and no purchase using pending/reserved cash. Include balances around $100, $625, $1,000 and $10,000 policy and feasibility boundaries, minima reached exactly or missed by one quantity increment, and losses or payouts that make a previously feasible account infeasible.

Prove production integration of the selected policy rather than relying on helper-unit tests. Preserve the existing permissions, freshness, reconciliation, host authority and kill controls. Keep historical studies unchanged; a new capital-aware study needs a new behavior/data/cost identity and the existing explicit owner-controlled registration process. Current live execution remains disabled.

## Annotated research sources

This targeted review covers 15 core papers and research records. Full-text entries mean relevant sections were inspected, not independent replication. Entries marked abstract rely on publisher/author records, including indexed primary abstracts where direct retrieval was unavailable. Retail equity samples, trade size and account wealth are distinct from automated spot-crypto performance; none establishes an optimal Coqui starting balance.

| Paper and version | Evidence and application | Transfer limit |
|---|---|---|
| [Altarovici, Muhle-Karbe and Soner, Asymptotics for Fixed Transaction Costs, 2013 manuscript, 2015 journal article](https://arxiv.org/abs/1306.2802) | Full-text introduction. Fixed charges affect small investors differently from proportional charges; motivates capital-aware no-trade policies. | Small-cost asymptotics and idealized markets; no Coqui fee or capital thresholds. |
| [Altarovici, Reppen and Soner, Optimal Consumption and Investment with Fixed and Proportional Transaction Costs, 2016 manuscript](https://arxiv.org/pdf/1610.03958) | Full-text introduction and wealth-dependence section. Mixed-cost policies depend on wealth and trade boundaries. | Model returns, preferences and cost assumptions are not calibrated for this app. |
| [Davis and Norman, Portfolio Selection with Transaction Costs, 1990](https://pubsonline.informs.org/doi/10.1287/moor.15.4.676) | Publisher abstract. Proportional transaction costs create a region in which no adjustment occurs. | Lognormal diffusion with idealized execution; not a crypto trading-frequency prescription. |
| [Gârleanu and Pedersen, Dynamic Trading with Predictable Returns and Transaction Costs, 2012 manuscript, 2013 journal article](https://nbgarleanu.github.io/DynTrad.pdf) | Full-text introduction. Relates adjustment to predictor persistence, risk and cost. | Requires forecasts and cost calibration Coqui has not established. |
| [Barber and Odean, Trading Is Hazardous to Your Wealth, 2000](https://faculty.haas.berkeley.edu/odean/Papers%20current%20versions/Individual_Investor_Performance_Final.pdf) | Author full text. Historical household evidence motivates explicit turnover/cost accounting. | Older U.S. stock accounts and commissions; not a causal estimate for a crypto algorithm. |
| [Schwarz, Barber, Huang, Jorion and Odean, The Actual Retail Price of Equity Trades, 2025](https://onlinelibrary.wiley.com/doi/10.1111/jofi.13467) | Full-text abstract/introduction. Controlled retail-order experiment documents broker execution differences excluding commissions. | Equity orders placed in 2021–2022; its measured cost levels cannot be copied into crypto. |
| [Barber, Lin and Odean, Resolving a Paradox, online 2023, journal issue 2024](https://faculty.haas.berkeley.edu/odean/Papers%20current%20versions/resolving_a_paradox_retail_trades_positively_predict_returns_but_are_not_profitable.pdf) | Full-text abstract/introduction. Aggregate predictability can coexist with poor investor outcomes; smaller trades favor attention-grabbing stocks. | Trade size is not account balance, and the sample is equities. |
| [DeMiguel, Garlappi and Uppal, Optimal Versus Naive Diversification, 2009](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1376199) | Primary abstract. Their tested optimized rules do not consistently beat 1/N out of sample. | Supports a benchmark, not universal optimality of equal weight or two-coin portfolios. |
| [Goetzmann and Kumar, Equity Portfolio Diversification, 2008](https://academic.oup.com/rof/article-abstract/12/3/433/1598033) | Publisher abstract. Under-diversification is costly and is not well explained by size/cost constraints in that sample. | Counters simplistic concentration advice; crypto exposures differ from stock holdings. |
| [D'Acunto, Prabhala and Rossi, The Promises and Pitfalls of Robo-Advising, 2019](https://academic.oup.com/rfs/article-abstract/32/5/1983/5427774) | Publisher abstract. Diversification benefits and trading changes vary with prior holdings. | Different adviser and market; automation alone does not establish investment edge. |
| [Campbell, Household Finance, 2006](https://www.nber.org/papers/w12149) | Primary abstract and publisher introduction. Fixed costs, income risk and borrowing constraints matter to household decisions. | Broad household evidence, not a spot-crypto allocation rule. |
| [Campbell, Ramadorai and Ranish, Do the Rich Get Richer in the Stock Market, 2019](https://www.aeaweb.org/articles?id=10.1257/aeri.20180158) | Publisher abstract. Diversification relates to higher average log returns for larger accounts, without higher average simple returns. | Indian equity account data; wealth, skill and market differences preclude a universal starting-capital claim. |
| [Borri, Liu, Tsyvinski and Wu, Cryptocurrency as an Investable Asset Class, March 2026 revision](https://arxiv.org/html/2510.14435v4) | Full-text data/jump sections. Motivates factor, jump and survivorship-aware research. | Historical empirical synthesis does not validate any small-account strategy. |
| [Bailey and López de Prado, The Deflated Sharpe Ratio, 2014](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) | Full-text methodology. Selection and non-normality affect apparent performance. | Requires honest trial history and enough observations; many capital levels are not independent samples. |
| [Bayraktar, Kyprianou and Yamazaki, Optimal dividends in the dual model under transaction costs, 2013 manuscript](https://arxiv.org/abs/1301.7525) | Primary abstract. Fixed payout costs motivate a threshold structure in its surplus model. | Different jump process and objective; no optimal retail-crypto payout threshold follows. |

## Artifacts and verification

- [Synthetic source probe output](small-portfolio-source-probe-2026-10-22.json): nine capital levels, helper settings, planner outcomes and source hashes.
- [Reproducible source probe](small-portfolio-source-probe-2026-10-22.mjs): imports unchanged local source and emits JSON; no database or venue access.
- [Decimal economics](small-portfolio-economics-2026-10-22.json): nine balance examples, five fee examples and three turnover scenarios, with assumptions separated from current published terms.
- Targeted existing tests: 3 files / 26 tests passed under Node 24.15.0. Decimal assertions verify fee-only break-even, entry-size capital thresholds, fixed-cost scaling and contribution arithmetic.

This work adds research artifacts only. No profitability backtest, new registration, app change, broker operation, deployment or release was performed. These recommendations preserve the existing owner, review, coverage, holdout and promotion gates.

## Prompt used

> Before we move on to that, I want you to do deep research in the same fashion but regarding smaller portfolios, because in a realistic situation a person using the algorithm would not be starting out with 100k.
