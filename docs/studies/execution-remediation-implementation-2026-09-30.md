# Execution remediation implementation — September 30, 2026

This pass repairs operation and accounting and adds a prospective research framework. It does not establish alpha, explain unobserved trades, recover past losses, or authorize deployment or promotion. The account review remains dated evidence: $100,000 opening equity, $97,897.17 reviewed equity, five distinct filled orders, approximately $211.93 reported-price fee equivalents, and roughly 85% of the $2,102.83 loss attributed to LTC. The tolerated 4.69-point overweight, source-change failures, incomplete evaluations, and later nearly 21-hour check gap remain in their original records. No new connected-account observation was made in this implementation pass.

## Operational behavior

TrendVol's BTC/ETH/LTC completed Coinbase daily-bar inputs and signal parameters remain unchanged. Daily execution retains its 5-point drift band and completed-close sizing; intraday execution retains its 1-point band and midpoint sizing at the existing slots. ML proposals are recorded in shadow and cannot change operational target weights. No hourly operational orders, passive limits, live venue, or candidate promotion were added.

Readiness now separates completed-bar validation, Coinbase rules verification, credential access, broker read receipt, broker reconciliation, and the immediately-before-order quote/account/asset validation. Safe operation names, failure reasons, timestamps, and elapsed durations are append-only. Transport receipt is not a freshness attestation. The market readiness observations are global market evidence; broker evidence remains experiment/profile scoped.

Requested Coinbase rules must include each unique requested canonical product exactly once. Alpaca asset responses must match the requested symbol and have valid increments/minima. An explicit inactive or nontradable asset immediately blocks submission; an explicit disabled Coinbase product blocks preparation. Immutable rule content is reused, while successful observations attest subsequent verification separately. Eligible Coinbase observations can be reused for at most 30 seconds for exactly the same universe. Failed, omitted and malformed responses do not renew verification. Valid current completed daily history is reused, with original retrieval provenance intact.

A single 30-second ordinary-check deadline covers preparation, secrets, reconciliation, planning and submission checks. It is capped by the remaining 15-minute execution window. Wall time detects elapsed windows after sleep; monotonic time bounds work. This is an initial engineering budget, not an investment threshold. HTTP rate-limit queueing, attempts and backoff share the budget. Existing safe GET retry behavior remains, without an outer retry loop. Execution requests precede waiting research requests within the same limiter; research acquisition has a 10-second budget and is canceled when a new execution pass begins. A noncancellable read may finish later, but cannot resume an expired paper pass.

Submission checks now re-read current account, positions, Alpaca rules, quote freshness, pause/kill switch, deadline and execution ownership. Insufficient cash, changed increments, dust after rounding, or insufficient holdings block the old intent with `material_sizing_inputs_changed`; this deliberately makes the legacy path more conservative. The operational sizing formulas were not replaced by B/C/D. A blocked legacy intent is not silently resized. Review/reconciliation is required before an incompatible legacy plan can proceed. New shared-planner plans can be explicitly revised with new identities before any attempted intent; attempted intents require reconciliation instead of amendment.

Ambiguous submissions remain lookup-only by deterministic client ID, without blind resubmission. Pending/partial orders block later execution. Explicit user pauses remain paused. Slot outcomes distinguish observed/no-order from missing or stale evidence, deadline exhaustion, pending orders, pause and host absence. Checks outside an eligible window are readiness checks, not successful slot decisions.

## Host lifecycle and unattended boundary

Launch, tick start/finish, suspend/resume, shutdown, authority generation and diagnostic artifact evidence are durable. Desktop power events abort the active pass. Unobserved elapsed slots are recorded as host unavailable, with `no_recorded_host_tick`; this does not infer sleep, a network failure or another cause. Every submission validates the lease and authority fencing generation again, including after restart or takeover. The new code does not assign or take over host authority.

The headless composition now supplies the same OS keyring secret-store implementation as desktop and declares its headless identity. Native keyring module/API loading was tested without reading owner credentials. Connected OS keychain access, unattended credentials, actual host suspend/wake and broker reconciliation still require a supervised check of the built host. Do not call this verified unattended Alpaca operation. No background host or second scheduler was started.

## Study identity and immutable evidence

Forward migration 85 adds a content-verified append-only evidence table. Existing registrations, failures and books remain unchanged. New registration is an explicit storage port; collectors do not register or restart owner studies. A study identity binds profile, experiment, candidate, signal/policy/execution/cost/data versions, opening convention, dates and behavior hash. Observations, failures and virtual books are namespaced by instance. Profile duplication discards copied research/host evidence in the temporary clone instead of making a copied study look prospectively valid.

The tested TypeScript import manifest follows transitive static exports/imports and literal dynamic imports, and includes lockfile/build settings and its own generator. Nonliteral dynamic dependencies fail manifest construction. The closure is deliberately conservative across workspace barrels. Changes to signal, eligibility, sizing, costs, timestamps and relevant parsers change the hash. Renderer changes do not. Generated manifest output is excluded from its own hash. A separate diagnostic hash covers application workspace modules/assets; it is not the strategy identity or a notarized distribution signature.

Collection and read-only reporting use the same provenance validation. Legacy registrations use their originally recorded hash, never a replacement. Selector, breakout, range and hourly candidates stop on mismatch. New candidate definitions must agree with the enclosing instance's source and dates. A failed provenance gate leaves a failure; it does not erase evidence, backfill observations, rewrite registration, or restart a study. Legacy incomplete registrations remain incomplete.

## Shared planner and matched shadow books

The pure Decimal planner separates completed-day target identity from prices and holdings. A reduction/increase compares the immutable target weight with the preceding target weight; falling prices alone do not imply a target reduction. Pending changes persist until directionally within their threshold or superseded. Fulfilled changes subsequently use routine drift logic. Required risk exits override the target; venue ineligibility blocks an impossible submission rather than pretending a fill.

Plans bind input hashes, revisions, deterministic intent/client identities, venue rounding, $25 minimum after rounding, cash reservation, sell-first stages, pending-order blocks and explicit portfolio/order/turnover limits. Unfilled sell proceeds cannot fund buys. Cumulative modeled partial fills are idempotent, conserve cash/holdings and carry pending state across restart.

Seven declared arms are A (reproduced legacy behavior), B (1-point fresh-quote target rebalance), C (1-point reductions, 3-point increases, 3-point drift to nearest edge), D (C plus 0.5% fee/half-spread discretionary-entry screen), passive BTC, passive equal BTC/ETH/LTC, and cash. All bands are portfolio-weight points, not relative-position percentages. B changes quote sizing and band consistency; C adds both classification and edge sizing; D adds a gate. Their results cannot be attributed to a single mechanism without another separately declared trial.

Each registered phase has independent $100,000 cash-only opening books, common observation frames, constraints and cost versions. Actual Alpaca and the existing $47.69 wallet are preserved and remain separate evidence. Seven arms × base/doubled costs produce fourteen books, not fourteen selectable policies. Model fills are immediate market assumptions, with buy fees in received crypto and sell fees in cash. They cannot establish actual fill, queue, latency or partial-fill behavior.

Every slot and a boundary terminal frame are mandatory. Interrupted writes can finish the same stored frame idempotently. A missing predecessor blocks the book; it cannot skip time or reset holdings. The development evaluator reports return versus A, drawdown, turnover, modeled fees, tracking error, blocked entries and per-coin P&L at both costs. It uses paired 7-day block uncertainty with 10,000 fixed-seed replicates and simultaneous bounds across B/C/D. Fewer than eight weekly units, broad uncertainty, or incomplete coverage means insufficient evidence. Missed-opportunity monetary value remains unavailable without separately observed counterfactual evidence. The development report never reads holdout book bodies and never freezes or promotes a winner.

## Fee and execution measurement

Observed cash fees, crypto fee quantities, reported-price USD equivalents, valuation timestamps and attribution/coverage are separate fields. Unknown attribution remains account-level; delayed CFEE/FEE rows are not assumed to belong to the nearest order. Reported-price value is not necessarily contemporaneous realized cash cost. No modeled cost is deducted from Alpaca equity. Conservative historical local and 0.85% comparison assumptions remain labeled separately from the new 0.25%-fee market-shadow model; future shared definitions are centralized.

Cash reconstruction is opening cash minus buys plus sells minus observed cash fees. Crypto reconstruction is purchases minus sales minus crypto-denominated fees. Residuals are diagnostics, not forced balancing entries. Coverage remains partial because delayed or omitted activities are possible; a queried empty response does not prove zero fees.

Observed execution measurement uses pre-order midpoint, activity VWAP, signed shortfall, observed first/completion latency, partial-fill history and the next recorded matched quote. Missing arrival quotes, fill timestamps or subsequent marks remain unavailable. Historical five-order evidence is not retroactively given arrival quotes. An immediate equity decline is not automatically slippage. Passive limit execution remains absent.

## Registration proposal and research basis

See [the concrete proposal](execution-remediation-registration-proposal-v1.json). Development is October 15–December 13, 2026, with three fixed 20-day folds. The untouched holdout is December 14, 2026–March 13, 2027 (March 14 exclusive). Register before development starts; freeze winner/none using the complete development report before any holdout performance is opened. Collecting sealed holdout evidence is different from evaluating it. All seven arms and earlier registrations stay in trial accounting. No owner study was registered and no holdout was opened during this pass.

Sections actually read from the supplied corpus (PDF file-page numbering):

| Source | Section read | Applied design |
|---|---|---|
| Narang, *Inside the Black Box*, p.30 | Trading-system components | Separate signal, portfolio/risk, cost and execution roles |
| Carver, *Systematic Trading*, pp.218–219 | Position inertia | Test buffers; do not transfer a position-relative threshold to portfolio-weight bands |
| Chan, *Algorithmic Trading*, p.25 and introduction cost caveat | Walk-forward validation | Independent chronological evidence and explicit costs |
| Kaufman, *Trading Systems and Methods*, fifth ed., p.42 | Transaction costs and monitoring | Compare actual behavior with expectation; label assumptions |
| López de Prado, *Advances in Financial Machine Learning*, pp.132–134, §7.4 | Purging and embargo | Prevent overlap leakage for future labeled models |
| Bailey et al., *The Probability of Backtest Overfitting*, pp.2–3 | Selection across alternatives | Trial accounting and untouched evaluation |

Corpus pointers are in [the survey](quant-resources-survey-2026-09-26.md), and the original interpretation is in [the remediation research](algorithm-remediation-research-2026-09-30.md). These publications provide methods; their examples do not validate Coqui or make the experimental thresholds operational defaults.

## Validation and follow-up

Final `pnpm verify` passed: TypeScript checks, ESLint, **222 test files / 1,414 tests**, and the manifest generation/build. `git diff --check` passed. Report-script syntax checks passed, and the native keyring module/API-load probe passed without reading owner secrets. Existing golden numerical tests passed; the deliberate operational changes are conservative stand-down checks and removal of ML influence, not new B/C/D order sizing. Tests cover requested-rule omissions/malformations, renewed verification, cache expiry/halts, deadlines and queue/retry budgets, lifecycle/restart gaps, fencing/takeover, explicit pauses, ambiguous and partial orders, source changes/isolation, baseline sizing, target classification, venue rounding/cash, cost exemptions, crypto/cash fee reconciliation, matched coverage and absence of fabricated observations.

Mocked functional tests establish software invariants only. They provide no investment-performance evidence.

Before deployment: review the operational conservative stand-down changes and source manifests; make a profile backup; verify migration against an isolated backup; supervise keyring access and connected read-only Coinbase/Alpaca requests; observe real deadline distributions and lifecycle/fencing behavior on the intended host; reconcile actual fees, cash, quantities and IDs. Execution ownership must be chosen separately. Register any future study explicitly before its fixed start, with actual profile/experiment and current behavior/artifact identities. No replay rescue or date extension is permitted. A failed or underpowered study should conclude insufficient evidence.
