# Profit distribution and quantitative trading research

Research date: October 22, 2026, America/Phoenix. Scope: research and proposed experiments for Coqui Crypto. No trading policy, study registration, account, or release changed.

Coqui should investigate a **profit distribution policy** that reserves part of new net gains while preserving a minimum operating balance. Its purpose is to return capital to the user and reduce the amount exposed to subsequent trading losses. It cannot create a profitable strategy or guarantee that total distributions will exceed total contributions. The first deliverable should be a paper simulation with correct cash-flow accounting, followed by an independently evaluated shadow study.

The most useful adjacent work is cost-aware execution, testing existing risk controls under jumps and outages, and measuring whether candidate signals add returns beyond simple crypto exposure. More indicators or a larger machine-learning model have lower priority than those foundations.

## What already exists in Coqui

This assessment uses the current local source, including existing uncommitted work. Source comments describing older favorable sweeps are historical claims; they do not override failed or unqualified studies recorded in the current documentation.

| Capability | Source evidence | Implication |
|---|---|---|
| Momentum combined with portfolio volatility sizing and a trend gate | [TrendVol](../../packages/core/src/strategies/trend-vol.ts), [volatility targeting](../../packages/core/src/strategies/vol-target.ts) | Volatility scaling is already implemented. Investigate its calibration and realized outcomes rather than adding a duplicate overlay. |
| Drawdown stages, exposure limits, expected shortfall and stress scenarios | [Risk controls](../../packages/core/src/risk/risk-controls.ts), [portfolio sizing](../../packages/core/src/risk/portfolio-sizing.ts) | A reserve must complement these controls. A configured limit is not proof that a market crash cannot exceed it. |
| Inverse-volatility and hierarchical risk parity allocation | [Risk budgets](../../packages/core/src/portfolio/risk-budget.ts) | Test correlation concentration and allocation quality before proposing another allocator. |
| Tax lots and tax-loss harvesting | [Harvest opportunities](../../packages/core/src/portfolio/harvest.ts), [tax service](../../packages/services/src/portfolio/tax.ts) | Existing “harvest” functionality identifies losses. It is distinct from distributing profits. |
| Chronological validation, trial accounting, holdout claims and cost scenarios | [Research integrity](research-integrity.md), [validation modules](../../packages/core/src/validation/index.ts) | Reuse this governance for every payout-policy variant. Do not restart or reuse a consumed holdout. |
| Breakout, range, market-selector and bounded ML research | [Parallel research](../parallel-paper.md), [selective participation](selective-participation.md) | These are existing research candidates, not new validated strategies. |
| Paper execution with fee and reconciliation safeguards | [Execution service](../../packages/services/src/paper/execution-service.ts), [parallel paper service](../../packages/services/src/paper/parallel-paper-service.ts) | New reserve commitments must wait for reconciled outcomes and preserve ambiguous-order blocking. |
| Live orders and transfers are disabled | [README](../../README.md) | Real withdrawals require a separate future product and permissions project. A paper reserve does not pay real money to the user. |

No portfolio-level policy for periodic profit distributions was found in the inspected core, services and contracts. The present working tree has extensive unrelated changes; this task adds only this research note and arithmetic evidence.

## What the research supports

The closest mathematical literature studies **dividends from a surplus process**, **investment with drawdown constraints**, and **growth subject to risk limits**. These support useful design principles, but none establishes an optimal payout percentage for Coqui's crypto portfolio.

Bayraktar, Kyprianou and Yamazaki derive a two-threshold dividend policy under fixed transaction costs: pay when surplus reaches an upper threshold and retain a lower operating level. Their process has a specific upward-jump structure. Applying its thresholds directly to crypto losses would be unjustified. The transferable proposal is to batch payouts and preserve operating capital. [Optimal dividends in the dual model under transaction costs](https://arxiv.org/abs/1301.7525).

Grossman and Zhou connect risky investment to the surplus above a wealth floor tied to the running maximum. Klass and Nowicki subsequently show that the original strategy's long-run optimality does not carry over unchanged to discrete time. A Coqui “floor” should therefore be a policy target with explicit breach measurements. [Original drawdown paper](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9965.1993.tb00044.x), [discrete-time counterexample](https://portal.research.lu.se/en/publications/the-grossman-and-zhou-investment-strategy-is-not-always-optimal/).

Busseti, Ryu and Boyd explicitly trade growth against the probability of falling below a specified fraction of initial wealth. Their repeated-gamble model assumes independent, identically distributed returns. Its risk bound is conditional on that model, and its drawdown definition differs from a rolling peak-to-trough loss. For Coqui, conservative sizing and stress tests are the immediate application; a calibrated risk-constrained optimizer is a later experiment. [Risk-Constrained Kelly Gambling](https://web.stanford.edu/~boyd/papers/kelly.html).

## Proposed profit distribution policy

### Distinguish selling from paying the user

Keep four visible balances:

1. **Trading capital:** positions and ordinary cash available to the strategy.
2. **Reserved cash:** excluded from all automated purchase budgets. A tax provision and pending payouts are labeled subsets of this reserve.
3. **Pending payout:** cash committed to a distribution but not confirmed received. Display it as a subset of reserved cash; do not add the two figures together.
4. **Capital returned:** confirmed completed payments to the user, reported net of payout costs.

Moving crypto into ordinary cash reduces crypto price exposure but allows later reinvestment. A logical reserve prevents authorized strategy reuse but remains subject to custody and implementation failures. Money actually received outside the trading account is outside that strategy's subsequent trading exposure. Stablecoins should remain a distinct risky asset category: crypto assets are not FDIC-insured deposits. [FDIC deposit insurance](https://www.fdic.gov/resources/deposit-insurance).

A payout before a crash cannot protect gains that were never earned or never distributed. If a user contributes $10,000, receives $500, and the entire remaining book is subsequently lost, the trading outcome is still a $9,500 loss before personal taxes. Returning the initial $10,000 recovers contributed capital; distributions must exceed that amount, after relevant costs and taxes, to establish a positive cash outcome even if the remaining book is lost.

### Prefer gains in dollars over counts of wins

Support user-facing trigger choices, but make portfolio net-profit eligibility mandatory:

| Trigger | Useful role | Weakness |
|---|---|---|
| New net profit exceeds a dollar threshold | Simple income milestone | Must adjust for deposits and earlier losses. |
| New net profit exceeds a percentage threshold | Scales with the account | The percentage base must be fixed and explained. |
| Trading equity exceeds a selected upper balance | Retains a chosen operating band | Can distribute contributed principal unless explicitly restricted to profits. |
| A number of profitable closed trades or days | Optional review reminder | Trade splitting, partial fills, varying sizes and open losses make counts unreliable. |
| Scheduled review | Predictable batching and lower operational load | A review must skip payment when profit eligibility fails. |

For example, ten $10 wins followed by one $500 loss produce a $400 loss. Counting wins would hide this. A sale that realizes $300 while other holdings lose $800 also does not establish portfolio profit. Realized P&L, unrealized P&L and total economic P&L must all be visible.

### A candidate to test first

An illustrative $10,000 research account could evaluate the following policy:

- Assess new gains only when they reach **the larger of $500 or 5% of an explicitly fixed assessment base**. Set the initial base to $10,000; a later successful assessment resets it to the retained trading balance. Version and disclose the treatment of later contributions.
- Reserve **25% of eligible new net gains**, leaving the remainder available to compound.
- Review once per week; do not pay again while an earlier event is unresolved.
- Retain a user-selected operating minimum, with illustrative cases such as $8,000 and $10,000 evaluated separately before selection.
- Enforce a minimum economically useful payout after estimated fees and sale constraints.
- Include negative P&L periods, costs and previous assessments. Never treat a recovery to the same economic gain as new distributable profit.

These values are research choices, not paper-derived or validated defaults. Weekly batching accepts the risk that a peak during the week disappears before assessment. A faster threshold review could capture more of those peaks at the cost of more activity; changing cadence creates another declared trial.

The policy should ordinarily reserve a **percentage of profit**, rather than a percentage of the entire portfolio. At $12,000 equity on $10,000 contributed capital, 25% of profit is $500. Distributing 25% of the portfolio is $3,000, exceeding the entire $2,000 gain by $1,000. A separate “recover contributed capital” mode may intentionally distribute principal, but must label it accurately. This portfolio distinction is separate from the tax cost basis of the specific lots sold.

### Accounting rules that prevent repeated or false payouts

For an initial design, define the following in exact decimal amounts:

```text
E = current trading equity, including ordinary cash
R = reserved cash still held in the account, including pending payout cash
W = cumulative completed external distributions
D = cumulative external contributions
P = E + R + W - D
H = cumulative economic profit already assessed by this fixed-share policy
g = max(0, P - H)
candidate reserve = share * g
```

`P` is economic trading profit before personal taxes, net of recorded trading and transfer expenses. It is not tax-basis realized profit. Track expenses paid elsewhere separately; pending payouts stay in `R` until confirmation, preventing double counting. `W` measures historical distributions even if the user has spent them; it is not necessarily current personal wealth. A new deposit raises both `E` and `D`, leaving `P` unchanged. Moving cash from `E` to `R`, or from `R` to `W`, also leaves `P` unchanged before costs.

`H` is an assessed-profit watermark, not the highest unexecuted market mark. For a constant share, after successfully reserving amount `h`, advance `H` by `h / share`. If liquidity or the operating minimum caps the amount, advance it only for the amount actually reserved; retain the remaining eligibility as deferred, subject to current profit checks. A version change in share or contribution treatment needs explicit migration rules, not a silent reset.

Before commitment, cap the candidate by current unallocated economic profit, available reconciled net realized profit after prior profit allocations, and trading equity above the operating minimum after execution costs. A realized-profit cap prevents distributions from merely marked gains, while the economic-profit cap prevents payout against realized wins offset by open losses. A sale may create eligibility, but only its filled, settled and reconciled outcome can fund the reserve. Net sale proceeds are not the same as the realized gain on that sale. Missing cost basis, delayed fees or uncertain cash makes eligibility unavailable.

Provide a versioned tax estimate separately. U.S. digital-asset sales or exchanges can create tax reporting and gain/loss obligations; withdrawing less than the sale proceeds does not eliminate them. A blanket tax percentage is not an accurate liability calculation. Any required provision reduces cash available to the user and must be accounted for before displaying a spendable payout. [IRS digital assets guidance](https://www.irs.gov/filing/digital-assets).

### Retain enough capital without increasing risk

An operating minimum should reflect user goals, venue minimums, intended position sizes and a cash buffer. If the smallest intended new position is 5% and the applicable minimum order is $25, at least $500 is needed before rounding and reserves. This is an illustrative feasibility calculation; Coqui has different sizing tiers and actual venue rules must govern each plan.

Retaining capital supports larger dollar outcomes but does not make a trade's expected return positive. Never increase leverage, concentration or the risk per trade to compensate for withdrawals. When the minimum would be breached, reduce or defer the payout and show the reason. “Keep enough to continue trading” and “recover contributed capital quickly” are competing preferences that should be compared explicitly.

## Worked examples

The examples below use fixed dollar gains, a 25% assessment share and sufficient settled realized profit. They ignore fees, personal taxes, reserve interest and execution delay to isolate the accounting. They are arithmetic illustrations, not historical backtests.

| Event | Trading equity | Reserved cash | Contributions | Economic profit | Assessed-profit watermark | New reserve |
|---|---:|---:|---:|---:|---:|---:|
| Initial funding | $10,000 | $0 | $10,000 | $0 | $0 | $0 |
| Gain $2,000 and reserve 25% | $11,500 | $500 | $10,000 | $2,000 | $2,000 | $500 |
| Lose $1,000 in trading book | $10,500 | $500 | $10,000 | $1,000 | $2,000 | $0 |
| Recover that $1,000 | $11,500 | $500 | $10,000 | $2,000 | $2,000 | $0 |
| Gain another $2,000 and assess | $13,000 | $1,000 | $10,000 | $4,000 | $4,000 | $500 |
| Deposit another $5,000 | $18,000 | $1,000 | $15,000 | $4,000 | $4,000 | $0 |

After the first assessment, compare keeping the $500 outside trading with full reinvestment. Apply the same next-period return to each trading book:

| Next-period return | Full reinvestment ending value | Trading value plus $500 reserve | Difference |
|---|---:|---:|---:|
| +50% | $18,000 | $17,750 | -$250 |
| -50% | $6,000 | $6,250 | +$250 |
| -100% | $0 | $500 | +$500 |

The reserve reduces both upside participation and subsequent trading losses. It does not improve the underlying signal. The last row assumes the reserve remains intact and outside the affected trading exposure; it does not model a shared custodian failure. Machine-readable arithmetic is in [the companion evidence](profit-distribution-examples-2026-10-22.json).

## Other additions worth investigating

The order below is a product judgment informed by the papers and current source, not a claim of measured returns.

| Priority | Addition | Research rationale | What Coqui would add or change |
|---|---|---|---|
| 1 | Profit distribution research ledger and simulator | Dividend barriers and growth-versus-drawdown research | New contribution-adjusted eligibility, reserve budget exclusion, payout lifecycle and distribution-aware comparisons. |
| 2 | Execution-cost attribution and stronger no-trade regions | Gârleanu and Pedersen relate optimal trading to signal persistence and costs | Extend existing execution research with arrival quotes, realized fees, partial fills, missed trades and cost-model error. Validate buffers against the frozen baseline. |
| 3 | Jump, outage and recovery evaluation of existing controls | Drawdown theory's assumptions and modern crypto jump evidence | Measure floor breaches under discontinuous prices, stale data, fee delays, unavailable venues and failed risk exits. Require explicit recovery and re-entry rules. |
| 4 | Net crypto-factor attribution | Crypto market, size and momentum explain substantial common return variation in the cited studies | Add benchmark/factor diagnostics showing whether results are mostly BTC/market exposure, liquidity or momentum. Validate any long-only implementation independently. |
| 5 | Correlation-aware portfolio risk budgeting | Diversification across coin names can coexist with common factor exposure | Evaluate the existing HRP/inverse-volatility choices under correlation spikes; add concentration explanations and cash-aware limits. |
| 6 | Selective participation using cost and uncertainty | A weak forecast should not automatically create a trade | Extend the existing selector/ML shadow study with calibration and a minimum net-edge margin; evaluate skipped opportunities as well as prevented losses. |
| Later | On-chain or attention features | Crypto-specific information appears in the crypto literature and 2026 survey | Add only a small, timestamp-audited feature set with point-in-time availability and simple-model ablations. Existing news research should establish its own incremental value first. |

The dynamic-trading paper supports jointly considering alpha decay and costs; it does not prescribe Coqui's thresholds. Volatility management also has conflicting evidence: Moreira and Muir report strong results across several traditional factors, while Cederburg and colleagues find that real-time versions do not systematically improve on unmanaged portfolios across 103 equity strategies. Test the existing crypto overlay against simple controls instead of treating scaling as guaranteed improvement. [Dynamic trading](https://nbgarleanu.github.io/DynTrad.pdf), [volatility management](https://www.nber.org/papers/w22208), [real-time counterevidence](https://www.lehigh.edu/~xuy219/research/COWY.pdf).

The 2026 Borri–Liu–Tsyvinski–Wu review emphasizes frequent large crypto jumps, changing comovement and data-quality concerns. Its data includes inactive coins. For Coqui, this motivates jump stress and historically eligible universes; it does not establish current alpha from an attention, on-chain or neural-network feature. [Cryptocurrency as an Investable Asset Class](https://arxiv.org/html/2510.14435v4).

Defer derivatives carry, leverage, cross-venue arbitrage and a large reinforcement-learning trading system. They introduce different execution, financing, custody or calibration requirements. A short favorable paper sample or a high win rate is insufficient reason to expand Coqui's execution boundary.

## Experiments and acceptance criteria

### Compare a small number of policies first

Begin with the same frozen signal, dates, instruments, opening holdings and starting capital for three arms: full reinvestment, a 25% new-profit reserve, and a 50% new-profit reserve. Fix the trigger, cadence, minimum balance and cash-yield assumptions before evaluation. Count preliminary parameter exploration as trials. Investigate principal-recovery and operating-band variants only in a separately declared expansion, rather than searching dozens of combinations and presenting the best.

Maintain passive BTC, passive equal-weight eligible assets and cash comparators as appropriate to the study. Add a matched cash-exposure comparison to distinguish the effect of de-risking from signal improvement. All controls need opening and closing costs, compatible data coverage and explicit rebalance assumptions.

Report at least:

- Remaining trading equity, reserve cash, pending cash and cumulative net payments to the user.
- Remaining capital plus cumulative payouts, net contributions and economic P&L. Describe this as an outcome measure, not automatically as personal wealth or a valid CAGR.
- Time-weighted strategy returns adjusted for actual external flows; a user's money-weighted return using dated deposits, payouts and terminal capital. Internal reserve transfers are not external cash flows.
- Drawdown of the active trading NAV and a clearly defined combined-capital series. Do not count a withdrawal as a trading loss or add it twice.
- Frequency and size of payouts, time to first payout, contribution recovery ratio, and time below the operating minimum.
- Turnover, realized costs, modeled-versus-observed cost error, tax assumptions, and forgone upside in sustained trends.
- Across declared resampled or stress paths, probabilities of failing to recover contributions or breaching the operating minimum. These are conditional estimates with uncertainty, not guarantees.

Success is a trade-off: more capital returned and lower downside may be valuable even with lower ending trading equity. Before testing, choose a downside objective and a maximum acceptable sacrifice in total outcomes; otherwise any cash-heavy policy can be marketed as an improvement. A new alpha claim must still satisfy existing profitability and benchmark-relative gates. An optional capital-distribution preference can be evaluated on its stated payout objective without being misrepresented as added alpha.

Use causal data and chronological development/holdout separation. Freeze the selected candidate or none before opening the holdout, preserve costs and trial history, and reuse existing block-bootstrap and governance components where appropriate. For path-dependent withdrawals, re-run the policy on each joint market path; do not merely shuffle the already-harvested equity returns. Preserve serial dependence and cross-asset dependence, and complement resampling with explicit crash/outage paths. A calendar duration alone does not establish adequate power. [Backtest overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf), [Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).

### Operational cases that must be proved

Before prospective collection, verify exact conservation and eligibility across deposits, external withdrawals, internal reserve transfers, fee corrections and loss/recovery cycles. Include profitable closed trades with larger open losses, unknown cost basis, insufficient payout size, threshold jumps, stale marks, tax provisioning, minimum-balance caps and share-policy changes.

Lifecycle checks must cover partial sales, cancel/replace, delayed fee settlement, simultaneous rebalance and reserve requests, app restart after each event boundary, and an unknown payout result. One durable identity must prevent duplicate commitment. Reserved and pending cash must stay unavailable to purchase sizing, including across restart. A crash before sale completion must be able to invalidate or reduce the proposed distribution.

Use an auditable lifecycle such as `eligible → proposed → sale_pending → cash_reconciled → reserved → payout_pending → paid`, with explicit deferred, failed and unknown outcomes. Existing trading risk gates still apply. Research-only simulation must not be mistaken for a new authorized broker-order path; future paper reserve execution needs an explicit policy integration and no bypass of the current hard stops or reconciliation boundary.

### Suggested delivery sequence

1. Specify cash-flow identity, policy versions and user objectives. Add distribution-aware research books and arithmetic invariants.
2. Build a bounded paper simulator and read-only policy preview showing trigger progress, estimated reserve, retained capital and reasons for deferral.
3. Verify lifecycle and accounting failures, then register a separate prospective shadow comparison through the existing owner-controlled process.
4. Review results and choose a candidate or none. Integrate an optional paper policy only after applicable review and evidence gates.
5. Treat real selling and external transfers as a separate future project with destination verification, narrow permissions and independently reconciled receipt evidence. The current app remains paper-only.

No existing registration dates, elapsed-evidence requirements, release gates or strategy promotions are changed by this proposal.

## Annotated research sources

This is a targeted literature review, not a systematic census. Full-text entries mean relevant sections were inspected; they do not claim a line-by-line reading or independent replication. Other entries rely on the primary abstract, author repository or publisher record and support only the narrower claims described here. Publication and manuscript dates are distinguished where needed.

| Paper and version | Evidence and relevance | Limitation for Coqui |
|---|---|---|
| [Grossman and Zhou, Optimal Investment Strategies for Controlling Drawdowns, 1993](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9965.1993.tb00044.x) | Publisher abstract. Risky allocation depends on surplus above a running-maximum floor. | Idealized market and utility assumptions; no empirical guarantee for discrete crypto execution. |
| [Klass and Nowicki, The Grossman and Zhou investment strategy is not always optimal, 2005](https://portal.research.lu.se/en/publications/the-grossman-and-zhou-investment-strategy-is-not-always-optimal/) | Author university record/abstract. Shows the continuous result's optimality need not survive discrete time. | A counterexample, not a replacement Coqui policy. |
| [Bayraktar, Kyprianou and Yamazaki, Optimal dividends in the dual model under transaction costs, 2013 manuscript](https://arxiv.org/abs/1301.7525) | Primary abstract and available manuscript. Derives two payout barriers with fixed transaction costs. | Surplus-process assumptions differ from two-sided crypto price risk. Thresholds are not portable. |
| [Busseti, Ryu and Boyd, Risk-Constrained Kelly Gambling, 2016](https://web.stanford.edu/~boyd/papers/pdf/kelly.pdf) | Full-text model and risk definition. Trades asymptotic growth against modeled probability of falling below initial-wealth bounds. | IID assumptions, unknown return distributions and a different drawdown definition limit direct deployment. |
| [Leung and Zhang, Optimal Trading with a Trailing Stop, 2017 manuscript, revised 2019](https://arxiv.org/abs/1701.03960) | Primary abstract. Studies entry and liquidation with a trailing stop in a diffusion model. | Trade-level exit theory does not establish portfolio payout percentages or crash-proof stops. |
| [Kaminski and Lo, When Do Stop-Loss Rules Stop Losses, 2014 journal article](https://dspace.mit.edu/entities/publication/bb69ca4b-0cdc-487f-831d-63b2e84fafee) | MIT record/abstract and author-posted abstract. Stop-rule value depends on return dynamics and sampling. | Evidence concerns index futures; apply only as motivation for comparative tests. |
| [Moskowitz, Ooi and Pedersen, Time Series Momentum, 2012](https://fairmodel.econ.yale.edu/ec439/mosk.pdf) | Full-text introduction. Documents return persistence across 58 liquid futures instruments. | Cross-asset futures evidence is not validation of long-only spot crypto. Taking profits can forgo subsequent trend gains; measure that trade-off. |
| [Liu and Tsyvinski, Risks and Returns of Cryptocurrency, 2018 working paper, 2021 journal article](https://www.nber.org/papers/w24877) | Primary research abstract. Crypto-specific momentum and attention predictors motivate candidate features. | Historical predictability is not a current net-of-cost forecast. |
| [Liu, Tsyvinski and Wu, Common Risk Factors in Cryptocurrency, 2019 working paper, 2022 journal article](https://www.nber.org/papers/w25882) | Primary research abstract. Market, size and momentum summarize common cross-sectional return variation. | Long-short factor evidence is not an executable long-only strategy recommendation. |
| [Borri, Liu, Tsyvinski and Wu, Cryptocurrency as an Investable Asset Class, March 2026 revision](https://arxiv.org/html/2510.14435v4) | Full-text data and jump sections. Recent survey and empirical synthesis; includes inactive coins and substantial jump risk. | Changing markets and historical data filters require independent reproduction and point-in-time controls. |
| [Moreira and Muir, Volatility-Managed Portfolios, 2016 working paper, 2017 journal article](https://www.nber.org/papers/w22208) | Primary abstract and working-paper introduction. Supports testing reductions in risk when volatility is high. | Traditional factors and estimation choices differ from Coqui; exposure scaling already exists. |
| [Cederburg, O'Doherty, Wang and Yan, On the performance of volatility-managed portfolios, 2020](https://www.lehigh.edu/~xuy219/research/COWY.pdf) | Full-text abstract and introduction. Finds no systematic advantage in direct real-time comparisons across 103 equity strategies. | Counterevidence for broad claims, not proof that every crypto risk overlay fails. |
| [Gârleanu and Pedersen, Dynamic Trading with Predictable Returns and Transaction Costs, 2012 manuscript, 2013 journal article](https://nbgarleanu.github.io/DynTrad.pdf) | Full-text introduction. Jointly considers expected-return persistence, risk and trading costs; partial adjustment can be optimal. | Requires estimates Coqui has not established; motivates bounded execution experiments rather than copying the optimizer. |
| [Bailey, Borwein, López de Prado and Zhu, The Probability of Backtest Overfitting, February 2015 manuscript](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) | Full-text abstract and framework. Accounts for selecting strategies from repeated backtests. | CSCV/PBO do not eliminate nonstationarity or replace independent prospective evidence. |
| [Bailey and López de Prado, The Deflated Sharpe Ratio, 2014](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) | Full-text methodology. Corrects performance assessment for selection and non-normality. | Requires honest trial information and adequate observations; not a probability that a strategy will profit in the future. |

## Prompt used

> Lets do some deep research. Look for papers on algorithmic trading and quantitative trading and figure out what we can add to the program.
>
> I also wanted to focus on one type of feature i've been thinking about: Having the algorithm sell off a certain percentage of the portfolio after it makes a certain number of gains or reaches a certain dollar amount. This feature would ensure that we have guaranteed profits and dont lose entire portfolios to market crashes or anything like that without at least getting some money out of it. The idea here is to leave enough money in the portfolio to be able to make significant gains per trade whilst also getting out a good amount of money / profit to the user.
>
> Brainstorm and do deep research.
