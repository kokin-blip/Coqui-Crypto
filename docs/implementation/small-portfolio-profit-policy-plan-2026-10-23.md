# Coqui small portfolio and profit reserve implementation plan

Design date: October 23, 2026, America/Phoenix. Status: proposed implementation sequence, with research hypotheses identified separately. The first deliverable is a reliable accounting and capital-feasibility foundation followed by a read-only profit-reserve preview. Strategy experiments and optional paper execution follow their existing evidence and review gates. Live orders and external withdrawals remain unavailable throughout this plan.

## Design decisions

Build three layers with independent acceptance criteria:

1. **Accounting and feasibility:** establish what the account owns, where capital came from, what cash is available, and which orders can satisfy the venue and risk rules.
2. **Profit reserve policy:** assess a share of previously unassessed net gains, fund a segregated logical cash reserve when permitted, and explain the effect on remaining capital. A sale and a payment to the user are separate events.
3. **Trading research:** compare a small set of strategy and execution hypotheses using realistic costs at small balances. A reserve preference can reduce market exposure without improving the predictive signal.

Use the existing TypeScript packages, exact decimals, SQLite transactions, immutable evidence, typed IPC, authoritative Main process, paper OMS, host fencing, scheduler, reconciliation, risk gates and terminal views. New services should extend these boundaries rather than introduce a second order writer or account balance store.

The [profit distribution research](../studies/profit-distribution-and-quant-research-2026-10-22.md), [small portfolio mechanics research](../studies/small-portfolio-quant-research-2026-10-22.md) and [strategy research](../studies/small-portfolio-strategy-research-2026-10-23.md) remain historical inputs. Their reading lists overlap and must not be summed as independent evidence. This plan resolves several design details left open there; it does not revise their historical findings. The [design evidence](small-portfolio-profit-policy-evidence-2026-10-23.json) records source identities and independent accounting examples.

## Evidence and gaps that change the design

| Finding | Evidence | Design consequence |
|---|---|---|
| Open cost basis is not a cash-flow ledger | [performance.ts](../../packages/core/src/portfolio/performance.ts) infers net flows from changes in `costUsd` | Add explicit external capital events. A sale or basis correction must not become a deposit/withdrawal. Existing metrics cannot authorize profit reserves. |
| Cash-flow-adjusted returns need flow timing | [paper-performance.ts](../../packages/core/src/portfolio/paper-performance.ts) accepts cash flows for daily returns but computes annualized return from endpoint equity and drawdown from raw equity | Introduce a versioned performance calculation using explicit flows and unit NAV. Preserve legacy report identities and values. |
| Current broker reconciliation is deliberately narrow | [broker-cash.ts](../../packages/core/src/portfolio/broker-cash.ts) and [broker-equity.ts](../../packages/core/src/portfolio/broker-equity.ts) recognize a bounded set of adjustments and return unavailable on incomplete evidence | Reuse their evidence discipline; add typed capital-flow normalization, pagination/completeness and transfer matching rather than treating every broker adjustment as profit. |
| Buying power differs from account cash | [Alpaca account interface](../../packages/adapters/src/http/alpaca-paper.ts) currently includes cash/equity without crypto-specific buying power | Normalize the venue's eligible spending limit and local holds. A displayed cash balance alone cannot fund a buy or reserve. |
| A reservation input already exists in research sizing | [remediation planner](../../packages/core/src/execution/remediation-planner.ts) subtracts `reservedCash` | Extend one authoritative budget projection to all relevant paths; an argument in one planner does not establish global reserve protection. |
| Small-account constraints conflict in some proposed settings | Prior source probe, [portfolio sizing](../../packages/core/src/risk/portfolio-sizing.ts), current $25 floors | Resolve exact joint feasibility before enabling smaller orders. Keep old studies frozen. Separate discretionary trade thresholds from venue minima and risk-exit treatment. |
| Tax lots and analytical method comparison exist | [costbasis.ts](../../packages/core/src/portfolio/costbasis.ts), [tax-aware.ts](../../packages/core/src/portfolio/tax-aware.ts), [tax service](../../packages/services/src/portfolio/tax.ts) | Reuse deterministic lot arithmetic, but audit account scoping, basis provenance and fee treatment. An analytical cheapest-lot method is not broker-confirmed tax identification. |
| Leases alone do not prove account-wide reservation ownership | [execution-authority.ts](../../packages/storage/src/repositories/execution-authority.ts) keys leases by profile | Before connected reservation, prove one writer for the verified broker account across profiles/hosts or block duplicate ownership. Independent simulations use independent virtual books. |
| Strategy families and governed views already exist | Rotation, TrendVol, breakout/range/selector shadow modules, selective participation, news research; COQ-29/31 remain In Review | Reuse and simplify these capabilities. Presence in source is not qualification or release evidence. |
| A prior candidate failed | [TrendVol replacement](../studies/trendvol-replacement-v1-2026-08-09.md) | Retain the negative decision, PBO 28.60%, failed uncertainty/drawdown gates and consumed holdout. Do not tune a replacement on that holdout. |
| Earlier proposed registration dates have begun | [COQ-10](https://linear.app/coqui-crypto/issue/COQ-10/reconcile-research-identities-and-decide-prospective-registration) still lists an October 15 development start and requires owner action | Do not retrospectively register this new design, shift an existing study's dates, or infer collector coverage. New prospective work needs its own identity and future owner-approved dates. |

These are source and documentation findings. They do not establish the current state of an installed application or a connected account.

### Targeted official documentation checks

Alpaca's current crypto documentation distinguishes non-marginable buying power from cash and disallows crypto margin and shorts. Its asset metadata supplies quantity minima and increments, and fractional orders support quantity or notional forms. Example values are not current instrument observations. The account adapter must preserve timestamped native rules and applicable order-form constraints. [Crypto trading documentation](https://docs.alpaca.markets/us/docs/crypto-trading).

Alpaca describes immediate crypto trade settlement, while its fee documentation still warns that fee activity can be posted later. Therefore, settlement, execution-safe net-position proof, complete fee accounting and withdrawal availability are distinct states. Profit eligibility requires complete financial evidence even where the existing execution proof permits ordinary paper operation. Do not impose an invented securities-style T+1 delay on crypto or weaken the existing pending-fee proof. [Settlement explanation](https://alpaca.markets/support/why-do-i-get-an-error-of-insufficient-balance-when-my-cash-balance-holds-the-requested-amount), [fee documentation](https://docs.alpaca.markets/us/docs/crypto-fees).

The published first Alpaca crypto tier remains 0.15% maker and 0.25% taker. Account/booked terms govern. Coinbase states that current fees depend on product, tier and liquidity role; a partially matched order can have both maker and taker portions. Historical 40/60 or 50/90 bps assumptions remain dated study scenarios rather than current universal rates. [Alpaca fees](https://docs.alpaca.markets/us/docs/crypto-fees), [Coinbase fees](https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/advanced-trade-fees).

Coinbase exposes base/quote minima and increments plus product status, and account responses distinguish available balances and holds. Normalization must preserve units and the provider's hold semantics. Missing rules yield unavailable feasibility rather than a guessed minimum. [Product schema](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product), [account schema](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/accounts/get-account).

Alpaca's paper documentation excludes latency slippage, queue position and market impact from its simulator and describes optimistic liquidity assumptions. It also contains legacy reset language alongside newer account creation/deletion instructions. Use internal virtual books for the capital grid; do not reset or recreate an existing broker paper account to obtain a smaller balance. Connected paper observations test integration and operational behavior, while additional cost scenarios remain explicitly modeled. [Paper environment](https://docs.alpaca.markets/us/docs/paper-trading).

The GIPS handbook explains valuation at external cash flows and geometric linking for time-weighted returns. Use those principles for cash-flow-correct metrics without claiming GIPS compliance. Missing trustworthy valuations produce an unavailable exact TWR, or a separately labeled approximation; cost basis is never substituted for capital flows. [Calculation methodology](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/).

Current IRS FAQ 85 requires broker-facing identification and supporting records for specific units disposed of after December 31, 2025. Local HIFO/LIFO/average scenarios must not be represented as instructions the broker accepted or as legally available elections. The initial reserve feature reports pre-personal-tax results and supports a separately labeled manual tax hold. Automated tax liability calculations and tax-driven broker lot instructions are outside the first release. [IRS digital asset FAQs](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions).

### Research conclusions retained

Dividend-barrier theory motivates batching and retained operating capital under its particular process assumptions; it supplies no optimal Coqui percentage. Trend, volatility scaling, technical rules and crypto momentum have conflicting findings. Long/short futures or coin-factor results do not validate a long-only spot adaptation. Small size can reduce market impact, but does not create alpha or eliminate fixed expenses. [Dividend model](https://arxiv.org/abs/1301.7525), [crypto momentum crashes](https://link.springer.com/article/10.1007/s11408-025-00474-9), [2026 crypto synthesis](https://arxiv.org/html/2510.14435v4).

## Accounting model

### Scope and authority

Start with one USD-denominated strategy capital pool per verified account and environment. Its identity includes provider, immutable broker account/portfolio identity, currency, simulation/paper environment and ledger epoch. A nickname or masked suffix is insufficient. Profile identity controls access; account identity controls cash ownership. Shared broker cash cannot fund several independent strategy pools without an explicit allocation ledger and one account-wide writer.

Account-wide manual trades, transfers and fees affect the pool even when Coqui did not initiate them. Unknown foreign activity blocks reserve eligibility until classified and reconciled. A portfolio-wide policy spanning multiple accounts is deferred until transfers and account ownership are proven; internal simulator books can model that later under explicit scope rules.

Record these immutable event categories with exact decimal quantity/amount, asset/currency, effective time, observed time, recorded time, source ID/hash, scope, revision/correction link, completeness and attribution:

| Event category | Required treatment |
|---|---|
| Opening capital and external contributions | Separate economic opening value from historical tax basis; external in-kind assets require a trustworthy arrival valuation |
| External capital outflow | Include manual principal returns and policy distributions; distinguish net user receipt, personal tax payment and other purposes |
| Internal transfer | Pair both sides within the declared managed scope; do not create a return or count both sides as external capital |
| Fill and fee | Link to broker execution/order identity; retain fee currency and actual quantity debits; correct with append-only evidence |
| Income and non-trading adjustments | Classify explicitly; staking, airdrops, interest and unsupported actions cannot silently become strategy trading profit |
| Valuation | Preserve positions, cash, receivables, liabilities, price provenance, freshness and missing assets |
| Reserve and release | Move ownership of cash between logical buckets without creating profit or a user payment |
| Assessment | Bind the profit slice, share, caps, policy version, watermark movement and funded reservation in one transaction |

Do not infer deposits from cost basis, broker balance increases, a fill's sale proceeds or unexplained journal entries. Transfers between the user's wallets may be external to a particular managed pool while internal to the user's total wealth; the selected scope determines performance accounting. Cost-basis transfer rules remain separate.

### Economic profit and visible balances

Define:

```text
A = current total managed account equity, including reserved cash once,
    supported in-transit receivables once, and liabilities with their proper sign
I = opening economic capital plus cumulative external contributions to this scope
O = cumulative confirmed net external capital outflows from this scope
P = A + O - I
```

P is contribution-adjusted economic profit before personal taxes, after costs recorded in the account. It includes open losses. The amount received by the user through profit distributions is a labeled subset of O; a manual principal withdrawal must not be presented as profit. Expenses paid outside the account appear in a separate user-net-outcome calculation and are deducted once.

Supported, reconciled USD cash interest is separately attributed investment income and can enter the declared realized-investment-profit pool; it is not trading-signal alpha. Unsupported rewards, staking, airdrops or adjustments block policy eligibility until a versioned classification is implemented. Do not silently exclude a credit from the identity or silently count it as a successful trade.

At a confirmed withdrawal, A falls and O rises; only fees and market movement change P. Before confirmation, a supported transfer receivable remains in A. An unknown result cannot be counted simultaneously as account cash and a completed payment; it blocks further payout action. No real transfer capability is introduced here.

Show five non-overlapping amounts or clearly labeled subsets:

- Active trading equity, excluding all committed reserves.
- Free cash available for new strategy purchases.
- Reserved profit cash and a separate tax hold; their sum is part of account equity.
- Pending payment, explicitly a subset of reserved cash or a separately represented receivable according to state.
- Confirmed money received by the user, outside current account equity.

The proposed dashboard must also show contributions, realized P&L with basis provenance, unrealized P&L, total economic P&L and cash-flow-correct returns. A reserve at the broker remains exposed to custody and software failures. Fiat cash and stablecoins are different asset categories.

### Metrics and reconciliation

Use one canonical capital-flow projection for policy eligibility and performance. Build an event-valued unit NAV so deposits/withdrawals change units, not investment return. Compute drawdown and annualized strategy return from the resulting return series; never use endpoint account equity CAGR on a series with flows. Report raw account balance change separately. Aggregate intraday flows under an explicitly versioned convention when exact valuations are unavailable.

Name the return scope. A reserve movement is internal to the total managed account and does not change its units. For an active-trading-sleeve return, that same movement is a capital flow out of the sleeve and must not appear as a trading loss. The combined account-plus-receipts dollar outcome is useful but cannot simply be labeled a CAGR or personal wealth.

Report the user's dated money-weighted result separately, using contributions, confirmed external receipts and terminal capital. A missing or non-unique IRR solution is unavailable, not a fabricated percentage. Losses, zero NAV and a newly funded epoch require explicit rules; they do not reset the lifetime assessed-profit watermark to erase losses.

A complete current mark alone cannot establish historical realized profit or complete capital flows. At onboarding, retain an explicit opening tracking epoch and the limits of historical knowledge. Opening market value is an economic funding baseline, not invented acquisition basis. Reserve funding remains unavailable for affected unknown-basis gains until reconciled basis is supplied.

Keep projections with different assurance states: observed account equity; execution-safe positions under the existing proof; financially reconciled capital/P&L; and profit eligible for allocation. The stronger distribution requirement must not replace or disable the independent execution proof. Late fee evidence revises the current projection with provenance; historical signed reports retain their original identities and are linked to corrections.

## Profit reserve policy

### Product behavior

The first user-facing mode is **Preview only**, with no scheduler action. Later, an optional internal paper policy can reserve simulated cash. A separate connected-paper integration requires its own review and explicit paper authorization. The default remains off; restarting, importing, restoring or upgrading must not enable it.

Offer these trigger choices in the initial preview:

| Trigger | Definition |
|---|---|
| Dollar profit milestone | Previously unassessed net economic gains reach a specified dollar amount |
| Percentage growth milestone | Those gains reach a selected percentage of a visibly fixed assessment base |
| Portfolio balance milestone | Active trading equity reaches a chosen balance, while the same profit eligibility rules still cap allocation |

A schedule determines when to check. A winning-trade count can request a review notification; it cannot satisfy the profit, realized-gain, cash or capital conditions. Define any count on completed position episodes after fees, so splitting one order into fills does not create extra wins. No feature promises guaranteed profit or a fixed income.

Freeze the percentage base at the start of an assessment cycle and show its dollar value. Deposits and manual withdrawals do not change that base mid-cycle or create a threshold crossing. After a completed cycle, establish the next base from retained active equity. This is a percentage of a stated assessment base, not an advertised TWR. A balance milestone crossed solely by a deposit cannot open a proposal; eligibility needs fresh verified investment gain and the profit caps below.

Use a share of eligible profit, not a percentage of total account equity. Any future principal-recovery feature needs a distinct label, event purpose and acceptance criteria.

### Watermark and partial assessments

Maintain H, the cumulative economic profit already assessed, as a monotone ledger value across policy versions. At first activation or a policy-version change, set the new eligibility baseline to `max(prior H, current P, 0)` after resolving old pending operations. Record any previously unassessed gains excluded by that change. This prospective default avoids retroactive increases in the share and does not erase a prior loss-recovery requirement.

At a trigger, capture a cycle profit ceiling U from the current cent-quantized P. One open cycle can assess only profit up to U. Later gains enter a subsequent cycle; a deferred original entitlement cannot expand without another milestone review. At funding, compute:

```text
fresh profit g = max(0, min(P, U) - H)
b = selected profit share in integer basis points, 1 through 10000
C = maximum cash that can be allocated after all profit, cash and capital caps
g_cents = floor(100 * g)
c_cents = floor(100 * max(0, C))
r_cents = min(floor(g_cents * b / 10000), c_cents)
G_cents = ceil(r_cents * 10000 / b)
G = G_cents / 100
r = r_cents / 100
```

Commit only when the trigger is valid, r meets the declared minimum reserve batch, and all financial evidence is complete. Assert `G_cents <= g_cents` and `floor(G_cents * b / 10000) == r_cents`, then atomically reserve r and advance H by G. Store the exact integer slice, share and funded amount together; never reconstruct H later from a cash amount or a changed share. A disabled/zero share or zero rounded amount produces no action. Fractional-cent rounding is explicit and cannot be assessed repeatedly. This selects an exact profit slice that supports the cash amount without the minimum-batch false rejection caused by rounding capacity/share downward first.

This refines the earlier report's `H += reserved/share` sketch. A partial reservation consumes only its exact profit slice, avoiding repeated decimals and ambiguity under share changes. For example, a 33% share with a $10 cash cap assesses $30.31 and reserves $10, with the subcent difference recorded. Residual unassessed profit may remain eligible in the versioned cycle. A previously crossed trigger may remain recorded, but current g, cash, costs and capital are rechecked for each partial commitment. A disappearing gain cannot be promised as a future payment.

Close a fully assessed cycle and establish its next base. If its remaining amount cannot produce the minimum batch, close it as a small deferred remainder without advancing H for that remainder. The global unassessed amount remains available to a later milestone together with new gains. This prevents a permanently open tiny residual from blocking future cycles. A cycle with a temporary cash/capital shortage can remain deferred; it holds no spendable cash until commitment.

Cancelling an uncommitted proposal changes neither H nor reserves. Releasing a funded reserve returns cash to trading but does not lower H or make the same profit slice eligible again. A separate, audited correction process handles proven ledger errors; ordinary settings changes, restarts and profile copies cannot reset the watermark.

### Eligibility and capital caps

All these conditions must hold at commitment:

1. Current P, H and scope flows are financially reconciled; missing prices, basis, fees or unknown external activity make eligibility unavailable.
2. r is no greater than current economic profit remaining after prior funded profit allocations and other profit-backed claims. Include open losses and all booked trading costs.
3. r is no greater than cumulative reconciled net realized investment profit, after losses and fees, less prior profit-backed allocations. Sale proceeds are not realized gains. Track manual tax holds with their funding provenance so the same profit cannot back two claims.
4. r can be funded from reconciled unencumbered cash after existing order commitments, profit reserves, tax holds, fee contingency and operational cash buffers. Provider holds already reflected in available cash are not subtracted twice.
5. Retained active equity after reservation and any required execution cost stays above the effective operating floor, and the resulting portfolio satisfies existing risk limits. The floor is a target enforced at allocation time, not a guarantee against future price declines.

The effective floor is the larger of the user's retained-capital preference and a versioned joint-feasibility requirement for the selected strategy/venue/risk policy. Necessary calculations such as `minimum order / intended position weight` are explanations, not a complete optimizer. If no feasible plan exists, defer, keep cash or reduce the proposed reserve. Never compensate with leverage, higher concentration or larger per-trade risk.

The initial policy funds reserves only from already eligible cash. If there is insufficient cash, the preview may show the sale that would be needed, but creates no order. A later paper-sale phase can prepare the minimum justified sale subject to venue minima and risk limits, model its costs, then wait for filled and fully reconciled outcomes before reassessing P, realized gains, C and r. Do not sell a large position solely to manufacture a tiny payout without showing the extra turnover and resulting cash allocation.

The realized-profit cap is an intentionally conservative initial policy choice, not a mathematical requirement for contribution-adjusted portfolio profit. It can make sale-funded reserves expensive: with $500 basis and $550 marked value in one holding, a $12.50 sale realizes only about $1.14 of gain before costs. Realizing $12.50 would require selling $137.50 under proportional basis, leaving much of the proceeds as ordinary trading cash. That changes exposure far more than a $12.50 cash reservation alone.

Consequently, retain cash-only funding first. Before the optional paper-sale slice, compare this strict cap with a separately specified economic-profit-backed cash policy, where current net portfolio profit and fully reconciled sale cash govern the reserve while tax realized gains are reported separately. The latter still cannot distribute more than unallocated net economic profit, use unknown basis for tax claims, breach the operating floor or bypass existing controls. It is a new research variant, not a silent removal of the initial cap. If neither meets the cost/exposure objective, keep sale-funded reserves unavailable.

A manual tax hold reduces available funds. Optional estimates stay separately labeled with jurisdiction, assumptions and method provenance; they do not certify liability or tax compliance. The first release does not display a pre-tax reserve as a confirmed after-tax amount available for the user to spend.

### Worked policy examples

The following examples use known realized profit and cash, a 25% share and no fees/taxes to isolate the rules. They are accounting illustrations.

| Event | Active equity | Reserve | I | O | P | H | New reserve |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fund account | $500 | $0 | $500 | $0 | $0 | $0 | $0 |
| Earn $50 and assess it | $537.50 | $12.50 | $500 | $0 | $50 | $50 | $12.50 |
| Deposit $200 | $737.50 | $12.50 | $700 | $0 | $50 | $50 | $0 |
| Trading book loses $50 | $687.50 | $12.50 | $700 | $0 | $0 | $50 | $0 |
| Recover $50 | $737.50 | $12.50 | $700 | $0 | $50 | $50 | $0 |
| Earn another $50 and assess it | $775 | $25 | $700 | $0 | $100 | $100 | $12.50 |
| Confirm a $10 external receipt | $775 | $15 | $700 | $10 | $100 | $100 | $0 |

The final row models a future external payment without adding a transfer capability. It does not classify the whole lifetime O as profit; the event purpose provides that distinction.

For partial allocation, P = $100, H = $0, s = 25% and C = $10 gives G = $40, r = $10 and H = $40. Replaying that commitment changes nothing. If current P later falls to $30, g is zero. Recovery to $40 also produces zero new eligibility. At P = $60 with adequate capacity, the remaining newly assessable slice is $20 and can reserve $5.

### Durable operation states

Keep a cash-reserve lifecycle separate from a future payout lifecycle:

```text
observation -> preview -> proposed -> [paper_sale_pending -> reconciling]
            -> cash_eligible -> reserve_committed
```

Every stage can defer, expire or fail with a reason. Ambiguous submission produces `unknown`; lookup and reconciliation precede further action. The optional sale branch exists only after its implementation phase is accepted. A preview neither locks cash nor authorizes execution.

Future transfer concepts such as `payout_proposed`, `in_transit`, `receipt_confirmed`, `failed` and `unknown` are data-model requirements, not enabled commands. A reserved dollar is not a received dollar. No withdrawal endpoint or transfer credential scope belongs in these phases.

Use one deterministic operation identity, an intent journal/outbox, revision-bound previews and database uniqueness constraints. At commitment, revalidate the snapshot, policy, account scope, lease/fencing token, reservations and all current safety controls inside the authoritative mutation boundary. Broker calls remain outside a database transaction, with durable intent before the call and durable reconciliation afterward. Never promise exactly-once delivery across an external broker; provide idempotent local handling and conservative recovery.

## Small portfolio execution design

Introduce a pure capital-feasibility result used by previews, simulator and future paper planning. Inputs include active capital, portfolio, target changes, cash/reservation state, observed native rules, quotes, fee profile, slippage assumptions, concentration and turnover limits. Outputs include executable rounded quantities, rejected intentions, retained cash, risk residuals and exact reasons. Unknown inputs remain unknown.

Keep three separate constraints: native venue minimum/increment; optional discretionary economic threshold; and a policy's risk-reduction treatment. A required exit may bypass a newly reviewed discretionary dollar floor or expected-profit screen, while still respecting venue legality, freshness, quantity ownership, authority and all applicable hard stops. Do not reinterpret frozen historical arms. Tests must expose genuine subminimum residuals rather than invent a successful exit.

Build one account budget projection with identities for each hold. Distinguish broker-reflected order holds from local approved/submitting commitments, tax holds, profit reserves and fee buffers. Cap spending by both reconciled account cash and normalized venue eligibility. Current and queued orders must see the same budget revision. An external debit that underfunds a reserve raises an incident and blocks new allocations; it cannot silently release or replace reserved cash.

Compute strategy weights against active NAV, excluding reserves. Also retain existing account-level risk checks and apply the stricter applicable limits; a new denominator must not loosen a hard limit. Model the consequence of a reserve on already-held position weights before committing. Strategy blending nets desired exposures before orders, while keeping signal attribution.

Do not turn a capital tier crossing into automatic risk expansion. Prefer explicit feasible allocations with stable constraints and cash residuals. The existing sizing helpers need joint constraint tests and demonstrated integration before reuse. The existing contribution planner provides useful arithmetic and copy patterns, but its percentage-cost/batching heuristic is not proof that every small fractional trade is uneconomic; use native rules, fixed costs and actual portfolio deficits.

At the current $25 Coqui threshold, a 5% position needs at least $500 before other constraints; a $100 account needs a 25% allocation merely to meet that floor. A 4% sleeve on $500 is $20 even before splitting it among candidates. Lower native minima can change feasibility; concentration limits may still make the intended trade impossible. Never round up position risk simply to reach a minimum.

With 0.25% fees on each received side, fee-only round-trip break-even is approximately 0.501881% price appreciation, before spread, slippage and other costs. Percentage costs scale with notional; fixed expenses and rounding do not. Measure one-way turnover explicitly and charge each friction component once. Actual fill prices already contain realized spread/slippage effects; do not deduct the same modeled price friction again from observed performance.

## Strategy decisions and failure criteria

| Candidate | Reuse and initial change | Main failure modes | Evidence needed before further integration |
|---|---|---|---|
| Trend with cash | Ablate [momentum](../../packages/core/src/strategies/momentum.ts), [TrendVol](../../packages/core/src/strategies/trend-vol.ts) and existing volatility sizing into simpler comparisons | Late exits, sharp rebound misses, whipsaw, apparent benefit explained by reduced exposure | Net results versus passive and a training-calibrated exposure comparator; stable independent evidence |
| Buffered momentum rotation | Reuse [rotation](../../packages/core/src/strategies/rotation.ts), absolute filter and holding buffer; test a feasible holding count | Turnover, correlated winners, survivor selection, buying the least bad declining coin | Point-in-time eligible universe, replacement-cost attribution and concentration stress |
| Breakout | Preserve [shadow breakout](../../packages/core/src/research/breakout.ts); separately compare slower cadence | False starts, post-signal price gaps, delayed entry and expensive overlap with trend | Next-attainable fills, false-start costs, meaningful incremental value |
| Bounded mean reversion | Reuse [range rotation](../../packages/core/src/research/range-rotation.ts); one bounded entry with declared time/risk exits | Structural breakdown, repeated small wins masking rare large loss, range width mistaken for forecast | Cost-bearing conditional payoff evidence, tail stress and no deleted crash observations |
| Fixed blend and selector | Reuse [selector](../../packages/core/src/research/market-selector.ts); compare a fixed blend before more switching rules | Correlated signals, state labels chosen with hindsight, switch costs, subminimum sleeves | Single-policy and fixed-blend comparisons using the selector's actual book |
| Cost-aware adjustment | Reuse remediation execution arms and add separately versioned no-trade/partial-adjustment comparisons | Stale exposure, missed opportunity, cost gate suppressing a required exit | Same signal and risk policy under matched cost/turnover comparisons |
| Calibrated ML filter | Reuse [selective participation](../studies/selective-participation.md) and [calibration](../../packages/core/src/research/overlay/calibration.ts), ridge/shallow tree | Leakage, unstable calibration, sparse observations, accurate direction with poor payoff sizes | Chronological fitting/calibration, purged labels, coverage and net-value evidence under existing gates |

The breakout cost margin and range `benefitRealization` are heuristics, not expected-return estimates. A shared edge gate must respect instrument, horizon, cost and forecast provenance; no arbitrary heuristic or classifier score can impersonate bound profitability evidence.

General momentum evidence and its [predictability counterevidence](https://scholars.hkbu.edu.hk/en/publications/time-series-momentum-is-it-there-2/) justify a limited contest, not a preferred production default. [Technical-rule research](https://link.springer.com/article/10.1007/s10479-019-03357-1) also contains unfavorable out-of-sample Bitcoin results. The [deep momentum paper](https://arxiv.org/html/1904.04912v3) demonstrates substantial cost sensitivity and the value of turnover-aware training; its futures cost scale is not a retail crypto assumption.

Volatility scaling receives its own ablation: [Cederburg and coauthors](https://www.lehigh.edu/~xuy219/research/COWY.pdf) find no systematic direct improvement across 103 equity strategies, despite favorable results elsewhere in the literature. Reduced exposure, retrospective risk normalization and a predictive edge are different claims.

Evaluate existing inverse-volatility/HRP allocation as components, with correlation spikes and simple equal-weight controls. More coins do not guarantee distinct exposures. News/attention/on-chain features come after baseline validity and timestamp-audited data; existing news infrastructure must prove marginal value. Defer derivatives, shorts, cross-venue arbitrage, market making, martingale/grid expansion and large RL searches from this implementation sequence.

## Architecture and data ownership

| Layer | Proposed responsibility | Existing boundary to reuse |
|---|---|---|
| `packages/core` | Pure external-flow projection, versioned performance, feasibility, reserve evaluation and transition validation | Exact decimals, instrument identity, risk rules, cost model, lot arithmetic and research planners |
| `packages/contracts` | Strict preview/settings/result schemas, assurance states, reason codes and allowed simulation/paper modes | Typed channels and literal `liveExecutionPermitted: false` |
| `packages/storage` | Capital event provenance, immutable policy versions, assessments and cash claims; atomic reserve/watermark updates | Existing SQLite migrations, transaction helpers, execution journals, source IDs and profile eligibility |
| `packages/adapters` | Normalize cash/buying-power/hold semantics, native rules, fees and supported external capital activities | Current read adapters and paper-only Alpaca origin |
| `packages/services` | Assemble trustworthy snapshots; coordinate budgets, preview expiry, scope authority and paper reconciliation | Paper OMS, scheduler, proposal review, fee proof and reconciliation |
| Desktop Main | Own commands, enforce environment/authority and dispatch bounded work | Current host fencing, leases, injected clocks, credential isolation and worker lifecycle |
| Renderer | Show goals, eligibility, consequences and evidence; submit typed settings/review requests | Portfolio, allocation, paper performance, Research and existing terminal components |
| Research runner | Parameterize starting capital and flows through the full book, evaluate policies and export immutable results | Corrected attainable-decimal engine, trial registry, freeze/final claim and cost profiles |

Plan schema migrations around four logical additions: an external-capital event register; immutable reserve-policy versions; assessment records with before/after H and funded cash; and typed cash claims/events. Reuse canonical OMS fills, fees and legs through references instead of copying their balances into an independently mutable journal. Reuse existing settings/snapshot storage where appropriate; the implementation design review should finalize table names and the next unused migration number.

Each preview binds source/cost/rule hashes, account/environment, capital and reserve revisions, policy version, proposed sale/claim and expiry. A changed mark, fee, holding, capital flow, rule, policy or claim invalidates it. Scheduling creates an observation or proposal within the authorized mode; it does not turn a preview into permission.

The intent/reconcile pattern applies to future broker paper sales. Internal reserve commitment is a database transaction and never calls a transfer API. No renderer or worker can write orders, edit broker financial evidence or grant itself execution authority.

Migration and restore preserve historical reports, loss carry-forward, H and already-funded claims. A restored stale backup cannot be assumed to own current broker cash: block connected reserve actions until account-wide reconciliation establishes the latest claims and exclusive writer. A duplicated simulation receives a new virtual identity. Profile duplication continues to remove connections and authority; copying a policy must not reset the original account's watermark or create another spendable claim.

## Settings and user experience

Place a compact **Profit reserves** section beside capital/allocation information. Keep research configuration in Research and execution authorization in the existing paper controls.

Initial controls are goal (`Keep gains invested` or `Preview setting aside gains`), trigger type/value, profit share, retained-capital preference, minimum reserve batch, review cadence and an optional manual tax hold. Defaults preserve current behavior. Percentages always show their dollar assessment base. A new share is a new immutable policy version with a consequence preview, including excluded old eligibility and pending operations that must first be resolved.

The consequence view shows:

- Current contribution-adjusted profit and the amount already assessed.
- Estimated additional reserve, realized-profit/cash limits and retained active capital.
- Expected sale requirement, modeled costs and residual allocation if a sale would be needed.
- The effective operating floor and the limiting native rule, concentration or turnover constraint.
- Clearly separated active cash, reserved cash, tax hold and simulated/confirmed external receipts.
- Comparison with keeping gains invested under explicitly hypothetical upside/downside paths; no invented probability of success.

Use concrete deferral reasons: `No new profit after prior losses`, `Profit is still unrealized`, `Cost basis unavailable`, `Fee accounting incomplete`, `Cash committed to an order`, `Would leave too little operating capital`, `Below reserve batch size`, `Native order minimum not met`, `Preview expired`, `Account ownership unresolved`. Missing evidence displays unavailable, not zero profit or zero risk.

The screen initially offers Save preview settings and Inspect calculation. Later paper modes use the existing explicit review lifecycle. A reserve release is a separate revision-checked paper command and cannot undo assessments. External withdrawal controls are absent; future payment states can be shown only as labeled simulated outcomes or independently verified historical records.

Small balances receive the same truthful controls. If no trade is feasible, show the exact shortfall and cash-accumulation option without recommending larger risk. A $100,000 example must not be the default demonstration of a $500 user's outcome. Do not equate a desire to receive cash with greater risk tolerance.

Accessibility acceptance includes keyboard operation, associated labels/units, focus recovery after expiry/errors, readable narrow layouts, zoom, light/dark/high-contrast themes, and non-color status explanations. Preserve the current terminal components. A scoped update or notification identifies the environment and account without exposing credentials or claiming receipt before confirmation.

## Phased implementation sequence

Each phase is a reviewable delivery slice. Pure accounting/simulator work can proceed while connected-operation review remains pending. New behavior must not be installed into an active campaign merely because its unit tests pass.

| Phase | Deliverable and dependencies | Acceptance criteria | Mode after completion |
|---|---|---|---|
| P0 | Finalize accounting definitions, scope, policy transitions and source inventory; select a coherent implementation base preserving unrelated work | Record exact local/committed identities; settle supported flow types and existing cash-claim ownership; retain all negative evidence and open operational gates | Existing app behavior |
| P1 | Canonical external-flow register and versioned performance projection; depends on P0 | Deposits/withdrawals never create investment return; basis changes are not flows; fees reconcile once; unknown flows/basis remain explicit; append-only corrections and migration/restore tests pass | Read-only accounting |
| P2 | Native-rule normalization, account budget and pure feasibility service; depends on P1 | Joint constraints pass at every declared capital boundary; all budget consumers use the same revision; native minima and discretionary floors remain distinct; no risk increase to force a trade | Read-only feasibility |
| P3 | Profit assessment engine, immutable reserve state and consequence preview; depends on P1/P2 | Conservation, monotone H, partial assessment, policy change, pending-claim and loss/recovery tests pass; all preview routes have zero broker write effects | Preview only |
| P4 | Capital-aware replay and reserve-policy simulator; depends on P1–P3 and corrected engine compatibility | Entire accounting/metrics path parameterized; same frozen decisions replay independently at nine balances; costs and cash flows explicit; infeasible cells reported; all registered boundaries preserved | Offline development research |
| P5 | Narrow strategy contest and separate execution/reserve ablations; depends on P4 plus adequate development data | Freeze finite candidates, cost profiles, objectives, trial counts and selection method; report all variants including none and negative outcomes; no consumed holdout reused | Research and shadow proposals |
| P6 | Internal paper reserve integration; depends on P3/P4, review and applicable paper qualification | Default off; uses existing authority/kill/OMS boundaries; restart and concurrent-budget cases pass; no transfer endpoint; operational status distinct from research qualification | Optional isolated paper behavior |
| P7 | Governed prospective observations and promotion decision; depends on owner registration, valid identities, operational readiness and fresh data | Existing minimum coverage/decision counts, uncertainty, cost and risk gates met; freeze candidate or none; final claimed once; review explicitly accepts paper configuration | Qualified paper configuration only |

P6 may prepare an internal paper sale proposal after its cash-only reserve behavior is accepted and the realized-cap/exposure trade-off above is resolved for that policy version. Treat that as a distinct review slice: add sale consequence modeling, order identity, partial fills, unknown/reconciliation and post-sale reassessment. No direct reserve service-to-adapter submission is permitted. Connecting the policy to an existing Alpaca paper account additionally requires exclusive account ownership and the connected-operation prerequisites below; an internal simulation does not prove those properties.

P6 delivers a capability, not strategy qualification. If an existing paper profitability or evidence gate is unsatisfied, the integrated path stays blocked. Prospective shadow observations can be collected without order submission; their collection does not depend on bypassing that gate.

External payouts and live trading form a future independent project. Destination ownership, current withdrawal availability/fees, narrowly scoped credentials, receipt reconciliation, unknown outcomes and user authorization would need new contracts and review. This plan does not enable those capabilities.

Reserve batch size, minimum crypto sale and minimum external payment are separate settings. A future payment cost rule can require `payment >= fixed fee / allowed fee fraction` using an actual rail quote; no invented transfer fee or venue order minimum belongs in the current cash-only reserve calculation.

### Suggested pull request boundaries

1. Capital-flow contracts, repositories and migrations with fixtures.
2. Versioned performance calculations and labeled read projections.
3. Venue rule normalization and shared budget/feasibility service with integration tests.
4. Pure reserve evaluator, assessment transaction and immutable policy settings.
5. Read-only preview and existing Portfolio/Research integration.
6. Parameterized replay, cost/capital reports and finite research specifications.
7. Optional internal paper reservation and failure recovery.
8. Separately reviewed paper sale preparation/integration, followed by any approved connected-paper verification.

Keep strategy candidates in separate changes from core accounting. If a phase is too large for focused review, divide its storage and read-model implementation while preserving its acceptance gate. Run required repository checks for each actual implementation change; do not run or claim full application tests as evidence that a design or trading strategy works.

### Existing dependencies and roadmap

| Existing work | Required relationship |
|---|---|
| [COQ-12](https://linear.app/coqui-crypto/issue/COQ-12/review-and-integrate-paper-recovery-broker-evidence-and-deadlines) | Review current uncommitted broker recovery, fee handling and deadlines before integrating connected reserve behavior |
| [COQ-13](https://linear.app/coqui-crypto/issue/COQ-13/verify-next-release-artifacts-and-publish-accurate-release-notes) | Preserve exact artifact, packaging and release checks for any eventual app delivery |
| [COQ-14](https://linear.app/coqui-crypto/issue/COQ-14/observe-connected-paper-execution-and-recovery-end-to-end) | Supply connected order/cancel, recovery, manual Resume and authority evidence; simulator success cannot close it |
| [COQ-29](https://linear.app/coqui-crypto/issue/COQ-29/wp-10-authoritative-modeled-proposal-consequences) | Reuse revision-bound modeled consequence work after review; extend it with cash/reserve effects rather than assuming they exist |
| [COQ-31](https://linear.app/coqui-crypto/issue/COQ-31/wp-14-governed-read-only-experiment-workspace) | Reuse governed read-only research views; preview work adds no registration/freeze/final command |
| [COQ-15](https://linear.app/coqui-crypto/issue/COQ-15/complete-owner-deferred-coinbase-view-only-verification), [COQ-16](https://linear.app/coqui-crypto/issue/COQ-16/complete-coinbase-archive-provenance-and-coverage) | Retain owner-controlled account verification and archive/provenance requirements where Coinbase evidence is used |
| [COQ-10](https://linear.app/coqui-crypto/issue/COQ-10/reconcile-research-identities-and-decide-prospective-registration) | Resolve instance identity and owner registration before a prospective start; code or a proposed date is insufficient |
| [COQ-17](https://linear.app/coqui-crypto/issue/COQ-17/track-valid-prospective-observations-and-coverage) | Measure actual valid observations, gaps and each frozen minimum |
| [COQ-18](https://linear.app/coqui-crypto/issue/COQ-18/freeze-development-choice-evaluate-untouched-holdout-and-decide-promotion) | Freeze choice or none, claim untouched final once, evaluate and record promotion decision |

Accounting, feasibility and previews fit the existing research/data-integrity work; connected integration follows operational review; strategy promotion belongs to the existing candidate-evaluation milestone. These are proposed work slices, not newly approved schedule changes. No existing issue, dependency, milestone date or unmet acceptance gate is closed by delivering this plan.

## Evaluation design across small balances

### Separate mechanics, signal and distribution questions

Use $50, $100, $250, $500, $1,000, $2,500, $5,000 and $10,000, with $100,000 as a diagnostic control. Run the actual path at each size; do not scale a $100,000 equity curve. The nine rows share a market history and are not independent alpha confirmations.

First replay one frozen policy to establish mechanics. Record desired versus executable quantities, rejected intentions, drift, idle cash, fees, concentration, turnover, residual positions and risk exits. Inactivity caused by blocked orders is different from deliberate abstention and cannot qualify as successful risk control.

Next compare at most two new structural hypotheses initially: simple absolute trend/cash and buffered rotation, alongside the current allocator, constrained passive holdings and cash controls. Use a single predeclared lookback and decision cadence initially; the existing 120-day lookback is a possible seed, not a validated choice. Any cadence or volatility-sizing comparison is an additional recorded variant. Monitoring and required risk actions retain their independent schedules.

The previous BTC/ETH suggestion needs a refinement: with top one and a two-rank holding buffer in a two-asset universe, both assets can remain inside the buffer, so the intended replacement experiment degenerates. Use a fixed prospective universe with at least three eligible liquid assets, such as the existing BTC/ETH/LTC research universe only after current venue eligibility and data coverage are established, or preregister a distinct score-gap hysteresis rule for a two-asset study. Do not invent missing membership or expand the universe after seeing results. All compared arms use the same declared universe and applicable concentration constraints; a top-one policy retains excess cash rather than exceeding its position cap.

Compare the same selected signal with the legacy execution baseline and one frozen cost-aware alternative as a separate execution question. Evaluate the profit policy separately with 0%, 25% and 50% reserve shares under the same declared trigger/cadence/floor and signal. These are research arms, not default user recommendations. Record every cost, capital, policy and parameter variant in the trial inventory. Avoid multiplying all possible settings into an unrestricted search.

### Costs and data

For each run bind opening capital/holdings, cash-flow schedule, venue/account fee assumption, native rule observations, fee currency, order form, quotes, attainable timing, execution model, source dependencies, seeds, parameter set and metric version. Carry the capital identity through book creation, budgets, benchmarks, profit policy and denominators. Historical native rules not observed at the time are explicitly static scenarios, not reconstructed facts.

Cost scenarios include applicable account terms where verified, a conservative profile and separately labeled doubled variable friction. Show both zero-extra-overhead and actual user-paid fixed-expense outcomes. Model dynamic fee tiers only when the inputs and qualification rules are supported; a hypothetical account cannot inherit a large trader's tier. Do not count fee estimates as observed postings.

Declare cash/reserve yield separately, including a zero-yield baseline. Hypothetical interest cannot be booked as an observed receipt or credited twice to the active and reserve books.

Use completed available bars and the first attainable execution after decision and provider delay. OHLC does not reveal intrabar stop order, spread history, queue fills or capacity. A breakout and stop touched in the same candle need a frozen conservative treatment or exclusion; the engine cannot infer a favorable sequence. Preserve missing data and delisting effects. Coinbase and Alpaca instruments/data/costs do not silently substitute for one another.

Compare no contributions, a predeclared periodic funding schedule and interrupted funding without interpreting deposits as return. Profit-policy comparisons need the same external contribution schedule and initial holdings. Endpoints include remaining account equity plus confirmed net payouts, contributions, costs and any separately modeled taxes; label simulated receipts explicitly. Unpaid pending claims are not additional wealth.

### Fresh evidence and acceptance gates

Declare exposed history as development. Neither the consumed TrendVol final period nor a copied database is a fresh holdout. A new hypothesis that influenced development counts as a trial. Use chronological fitting, purge/embargo appropriate to overlapping labels, complete-date asset grouping and causal volatility/calibration. Record failed and interrupted attempts, choose a candidate or none, and freeze before final access.

Retain the corrected engine's existing qualification requirements and each study's stricter frozen gates. Do not lower a 5% PBO threshold to a more permissive general policy or shorten an existing 365-observation/30-action requirement to make a small account pass. Missing account costs, DSR or sufficient trial history block adoption. A new sparse strategy may require a separate approved power/design assessment, not forced extra trades or an arbitrary calendar deadline.

Primary strategy evaluation measures after-cost excess versus matched passive and cash/exposure controls, paired uncertainty, drawdown/time underwater, worst rolling outcomes and parameter/period stability. Alpha attribution distinguishes market exposure, concentration and timing from incremental skill. A strong return at one small balance and infeasibility at others yields a conditional supported region, not a universal minimum account or a per-balance hindsight winner.

Distribution-policy evaluation uses a different objective: capital returned/reserved, contribution recovery, floor breaches, cash availability and forgone upside relative to reinvestment. Freeze the allowed sacrifice in total outcome and the downside objective before evaluation. A cash-heavy policy can improve drawdown without improving alpha. Test minimum batch and operating floor as declared sensitivities rather than optimizing them on the final period.

For path-dependent reserves, replay orders and allocations inside each resampled joint market path, preserving serial and cross-asset dependence. Do not shuffle an already-withdrawn return series and apply payouts afterward. Complement uncertainty estimates with explicit gaps, prolonged downtrends, sharp rebounds, correlation spikes, venue outage, delayed fees, deposit/withdrawal interruption and reserve-underfunding scenarios. Conditional simulations do not establish crash-proof capital floors.

### Operational questions that must remain explicit

| Missing observation or decision | Safe behavior until resolved | Phase that resolves it |
|---|---|---|
| Actual account fee terms or fee-posting completeness | Labeled scenario preview; no eligible reserve allocation from uncertain profit | P1/P2; owner/account evidence before P7 |
| Current native order rules or eligible buying power | Feasibility unavailable; no guessed fractional minimum | P2 |
| Opening cost basis or complete transfer history | Opening tracking boundary disclosed; affected realized-profit eligibility unavailable | P1 |
| Supported income and adjustment classification | Unknown type blocks policy; supported cash income is separately attributed under its declared accounting version | P0/P1 |
| Exclusive broker-account cash authority across profiles/hosts | Internal simulations only; connected reservation blocked | P2/P6 plus operational review |
| Research lookback, cadence, universe and statistical power | Candidate specification remains proposed; no prospective start or promotion | P5/COQ-10 |
| User share, operating floor and tax-hold preference | Preview defaults off; show concrete consequences before saving an enabled paper policy | P3/P6 |
| Current external payment rail, permissions, fees and destination evidence | No transfer integration | Separate future project |

These are necessary preconditions to later actions, not reasons to invent default account observations or postpone the accounting design.

## Tests and acceptance matrix

| Area | Required tests and invariants |
|---|---|
| Capital identity | Deposit, manual principal withdrawal, paired internal transfer and reserve movement leave P unchanged before actual costs; sale proceeds and basis changes are not contributions |
| Conservation | Exact asset/cash legs, fee currency and actual debits agree; every reserved or pending dollar is counted once; no negative spendable balance; corrections are append-only |
| Returns | Constant prices plus deposits/withdrawals yield zero investment return; flow-adjusted unit NAV drawdown/CAGR are invariant to pure flows; unavailable/non-unique IRR and missing marks remain explicit |
| Profit eligibility | Profitable closed episodes with larger open losses cannot fund a reserve; losses and fees reduce eligibility; unknown basis/fee/flow blocks it; manual principal returns are not labeled profit |
| Watermark | H never falls on ordinary release, settings change, restore, restart or replay; duplicate IDs fund once; partial slices and shares such as 33% obey exact rounding; a completed recovery alone creates no new assessed profit |
| Milestones | Dollar/percentage/balance triggers, frozen percentage base, deposit-only balance crossing, skipped review, price reversal and one still-open cycle; wins and partial fills cannot bypass eligibility |
| Feasibility | Entire capital grid plus values either side of helper boundaries; minimum exactly reached or missed by one increment; small full exit, post-loss dust, native minimum versus discretionary floor, incompatible concentration/turnover constraints |
| Budget | Existing buy hold versus new reserve, two simultaneous proposals, broker-reflected/local holds without double subtraction, external cash debit, fee revision and scope conflict |
| Recovery | Crash before/after intent, broker response, fee evidence, assessment commit and UI acknowledgement; no blind retry on unknown; manual pause/Resume and kill switch remain enforced |
| Authority | Expired/lost fencing token, wrong account/environment/profile, duplicate account across profiles, restored stale claims, malformed IPC and background-worker attempts to mutate orders |
| Research integrity | Capital parameters in every denominator/book; candidate/trial/cost hashes; consumed overlap rejection; no hidden final-data read; missing native-rule history stays a scenario; deterministic rerun of fixtures |
| Strategy behavior | Trend whipsaw/rebound, buffered ranking degeneracy, breakout/stop candle ambiguity, mean-reversion breakdown, correlated blend, ML leakage/calibration/coverage and cost mismatch |
| UI and compatibility | Loading/stale/partial/empty/error states, clear money/base/fee units, subset totals, keyboard/zoom/theme checks; historical reports remain unchanged; saved disabled setting stays disabled |

Use property-based event-sequence tests for conservation, duplicate handling and monotone H, backed by independent hand-calculated fixtures. Integration tests must prove that real budget consumers call the shared projection; helper unit tests alone are insufficient. Failure injection should exercise the actual service/transaction boundaries rather than mirror a pure function's implementation.

For actual code changes, run focused suites first, then the repository's required typecheck/lint/test/build and packaged smoke gates appropriate to the affected layers. Use disposable profiles and mocked/synthetic data for destructive cases. Connected observations require their existing explicit authorization and must not reset accounts, register studies or submit orders as a side effect of verification.

## Completion criteria for this planning task

The design resolves accounting scope, deposit neutrality, partial assessment, policy versions, capital preservation, native-rule handling, fee assurance, strategy reuse and delivery order. Account-specific values and future statistical choices remain gated as shown above. The companion evidence records arithmetic and inspected source identities; it is not a market backtest, registered study or application release.

Only planning artifacts are added. Prior research and runtime source remain unchanged by this task. Implementation acceptance and owner, review, observation and release gates remain separate.

**Prompt used**

Review everything we discussed in this chat and all the research you gathered, then brainstorm how to turn those ideas into practical improvements for Coqui before writing code. If you discover gaps, conflicting findings, outdated assumptions, or unanswered implementation questions, conduct additional targeted research using primary papers and current official documentation before settling on a design. Consider profit-taking rules based on portfolio gains, percentage growth, or dollar milestones, with safeguards that distinguish investment profits from deposits, avoid repeatedly withdrawing the same gains, and preserve enough operating capital for future trades. Treat winning-trade counts as optional triggers rather than proof of profitability, and distinguish selling into cash from withdrawing money to the user. Design around realistic small starting balances, accounting for fees, spreads, slippage, fractional orders, minimum trade sizes, concentration, turnover, and the trade-off between compounding and withdrawals. Evaluate the researched strategies—including trend following with cash, buffered momentum rotation, breakout, bounded mean reversion, strategy blends, cost-aware execution, and calibrated ML filters—and identify which existing capabilities we can reuse, simplify, or improve. Challenge each idea, explain its failure modes, and prioritize evidence over complexity or promised returns. Preserve previous negative research findings and existing safety controls. After brainstorming and resolving necessary research questions, produce a concrete, phased implementation plan covering the architecture, data and accounting requirements, strategy changes, settings and user experience, dependencies, tests, and acceptance criteria. Separate promising hypotheses from validated behavior, define how we will evaluate strategies across small portfolio sizes using realistic costs and fresh evidence, and sequence the work into manageable steps that can then be implemented in the app without prematurely enabling live trading or automatic withdrawals.
