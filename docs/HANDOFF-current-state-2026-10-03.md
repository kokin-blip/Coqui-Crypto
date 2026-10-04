# Coqui Crypto — application handoff

**As of:** October 3, 2026
**Repository baseline:** `bc88e99` (`p5-shell-and-ui`, experimental beta.13)
**Working tree:** heavily modified and uncommitted. This handoff describes both the committed baseline and the substantial in-progress work; it is not a claim that the current tree has been released or fully reverified.

## Executive summary

Coqui Crypto is a local-first Electron research and paper-trading workstation for one operator. It emphasizes provenance, exact accounting, risk controls, honest missing-data states, and careful separation of connected-account evidence from simulated books. It is **not a live-trading app**: live execution is contractually disabled, there is no real-order route, and no leverage, derivatives, transfer, or withdrawal path.

The committed beta.13 baseline has a usable desktop shell, Coinbase read-only market/account paths, local paper execution and reconciliation, research/backtest workflows, profiles, scheduler and a headless paper-only host. The current working tree is a large, unfinished change set that appears to add a unified trading terminal, Coinbase order-book/tape display, broader historical market acquisition, and stronger research-integrity tooling. Its accompanying terminal report records green verification, but the changes remain uncommitted; re-run the release gates on the exact current tree before treating those results as reproducible.

## Current product surface

- **Desktop:** Electron + React workstation with Overview, Markets, research, risk, portfolio, paper, settings and specialist views. The in-progress UI consolidates old Simple/Advanced modes into one terminal with market chart, depth, recent trades, algorithm observations, holdings, proposals, and performance tabs.
- **Market data:** Coinbase public/authenticated read-only paths supply product, candle, quote, depth and account evidence. Public venue streams are informational; order-book and tape data are explicitly not decision-eligible. Binance and Kraken bulk archives are used as separate research datasets, not as synthetic Coinbase history.
- **Research:** canonical algorithm lab, registered studies, versioned datasets/costs/code identity, immutable reports, benchmarks, and prospective forward evidence. Backtests and paper results are evidence, not proof of future returns.
- **Paper execution:** exact-decimal ledger and internal OMS, human review by default, fresh gates at submission, idempotent intents, order/fill reconciliation, kill switch, lease/fencing checks and explicit unknown states. Desktop/headless paper operation only.
- **Storage/security:** local SQLite with forward-only migrations, profile isolation, OS credential store, sandboxed preload, validated typed RPC, CSP and denied browser capabilities.

## What is in progress

The working tree contains extensive edits across renderer, main-process handlers, core/services/storage/contracts, tests and docs. New untracked files include terminal components and styles, Coinbase microstructure/depth modules, bulk download and market archive acquisition, a research-integrity engine and governance flows, migration 86, and terminal verification screenshots. `SimpleNavigation.tsx` and `WorkspaceModeControl.tsx` are deleted as part of the apparent shell consolidation. Preserve and review this work as a coherent feature branch; do not discard/reset the tree or assume `HEAD` contains it.

The terminal handoff says its exact check run passed `pnpm verify`, 232 test files / 1,487 tests, production Electron smoke 66/66, performance (warm shell 686 ms, interaction p75 8.9 ms), depth stress checks, and 13 visual overflow captures. It also records a large-chunk warning from the Ionic command popover, and says test captures use offline/unavailable book/tape states; deterministic protocol tests do not prove a live exchange stream. The final Figma spacing/runtime refinements were not synced back due to Starter tool quotas.

## Recent shortcomings and corrective work

### Strategy evidence is weak or negative

- The shipped TrendVol replacement study was negative; the strategy remains unvalidated and profitability gates should remain closed absent qualifying evidence.
- A prior forward-edge registration was retired after an implementation identity mismatch: the scheduled code was a saved-allocation rebalancer rather than the claimed Momentum + VolTarget strategy. Historical records stay immutable and cannot be relabeled as valid strategy evidence.
- A frozen hourly TrendVol ML shadow report had 293 development and 450 holdout checks but exactly identical baseline/overlay returns (11.42198576323754%), zero lift and degenerate zero interval endpoints. The stored summary does not establish effective independent observations or valid performance; it is unqualified, not a success.
- Research-integrity work now distinguishes legacy exploratory engines from a corrected timestamp-aware engine, accounts for trial/holdout reuse, applies attainable-price timing and explicit cost scenarios, and prevents development/final contamination. It does not retroactively repair old studies or create an edge.
- The confirmatory forward edge requires 365 observed days and at least 30 cost-bearing rebalance events. Those observations cannot be backfilled or replaced with fixtures; until sufficient verified evidence exists, the edge gate stays at zero.

### Paper runtime has had reliability and observability failures

- Historical account review (September 30) found $100,000 opening equity versus $97,897.17 reviewed equity, five distinct fills, about $211.93 in reported-price fee equivalents, and roughly 85% of the loss attributed to LTC. This is dated evidence, not a new account check; fee attribution was incomplete.
- The review also found stale/missing product rules, source-change failures, incomplete evaluations, tolerated overweight, and a nearly 21-hour scheduler observation gap. The gap's cause was not proven; it cannot be called a network failure or sleep with certainty.
- An October 1 `paper_execution_unknown` event was traced to a frozen-client diagnostics Proxy that could throw before the broker method ran. This strongly supports a local wrapper defect, but does not prove broker health or explain earlier outages.
- An ML target was stale/unavailable for an hourly slot. The old asynchronous refresh could complete after that slot had already been recorded, and research collection was coupled to active/recoverable paper state.
- September 30 / October 2 remediation adds bounded execution deadlines, safer GET retry budgets, immediate pre-submit validation, reconciliation-first recovery, explicit lifecycle/gap events, deterministic ambiguous-order lookup, better fee accounting, and independent ML shadow collection. ML cannot change operational weights. These are software repairs; live owner-host/keychain/broker validation and new investment evidence remain outstanding.
- Existing owner evidence records 1,873 scheduler checks, 65 gaps over five minutes, 136 `alpaca_unavailable` reconciliation errors, and pause reasons including 13 stale product-rule events. These counters describe that captured interval and should not be mistaken for current live health.

### Historical data is useful but still incomplete

The October 3 archive run verified Binance BTC/ETH daily archives from 2017-08-17 through 2026-10-03 and Kraken XBT/ETH histories beginning 2013/2015 through 2026-06-30. The acquisition is explicitly incomplete: Coinbase BTC-USD and ETH-USD yielded zero rows because the official market-data terms page returned Cloudflare 403. Do not silently substitute other-venue prices for Coinbase execution evidence or mix venue series. Resume the documented acquisition when provenance access is available. Raw capture/report artifacts are local and ignored; reports and hashes are recorded in `docs/studies/market-acquisition-2026-10-03.md`.

### Product and design handoff gaps

- The current UI unification is uncommitted and must be reviewed against existing routes, saved layouts, profile settings, keyboard/accessibility behavior and platform packaging.
- The Figma design remains editable, but the last responsive-spacing corrections and some runtime refinements were not synced to it.
- Current terminal screenshot captures intentionally show unavailable stream states; they are visual/UI validation, not live data verification.
- Vite still reports a large chunk around the existing Ionic command popover; the stated performance gate passes, but the warning remains.

## Safety and operating constraints

1. Keep real and paper portfolios separate; never imply the connected account is simulated or vice versa.
2. Do not enable or add real order submission, transfers, withdrawals, leverage, or derivatives as part of routine follow-up.
3. Unknown, stale, incomplete, or unreconciled state must block authority-changing paper actions and remain visible as unknown.
4. Never blind-retry an ambiguous order. Reconcile by deterministic client identity and persisted attempts.
5. Preserve immutable historical studies and failures; do not backfill forward observations, reopen consumed holdouts, or promote from fixtures/synthetic input.
6. Keep API credentials out of logs, reports, screenshots and renderer state. Real Coinbase key verification remains owner-deferred.

## Recommended next steps

1. **Stabilize the current working tree:** inspect `git diff --stat`, review the terminal/backend changes as one integrated feature, then run `pnpm verify` and Electron smoke on the exact tree. Capture failures and distinguish baseline issues from regressions. Do not reset or overwrite uncommitted owner work.
2. **Complete Coinbase archive provenance:** retry the official terms/provenance acquisition; publish Coinbase data only when its source manifest and terms checks pass.
3. **Supervise real read-only operational checks:** on the intended host, validate OS keychain access, Coinbase/Alpaca read-only calls, scheduler lifecycle/fencing, and reconciliation. Observe actual deadline and freshness distributions. No orders are required for these checks.
4. **Keep studies prospective:** explicitly register the next study with exact behavior/data/cost identities and fixed dates before collection. Wait for sufficient observations; report insufficient evidence honestly when coverage/power is inadequate.
5. **Finish design sync:** resolve the noted Figma spacing/runtime drift and document owner visual review for the consolidated shell.
6. **Only then consider external paid services:** start from a specific remaining data gap. A broad aggregator may aid discovery but cannot replace venue-specific execution data or solve provenance/licensing by itself. QuantConnect is not a necessary app dependency at present.

## Key documents

- Product/constraints: `README.md`, `apps/desktop/PRODUCT.md`, `docs/ARCHITECTURE.md`
- Current roadmap and older phase notes: `docs/PLAN.md` (some status text is historical; prefer this handoff and dated evidence for current details)
- Data boundaries: `docs/DATA-SOURCES.md`, `docs/studies/market-acquisition-2026-10-03.md`
- Research integrity: `docs/studies/research-integrity.md`, `docs/studies/algorithm-remediation-research-2026-09-30.md`
- Execution operation: `docs/studies/execution-remediation-implementation-2026-09-30.md`, `docs/studies/ml-shadow-reliability-v2-2026-10-02.md`
- Terminal: `docs/terminal-implementation.md`, `docs/terminal-verification.md`, screenshots in `docs/design/screenshots/terminal-2026-10-03/`
- Prospectively measured edge gate: `docs/studies/forward-edge-preregistration-2026-08-24.md`

## One-paragraph handoff

Coqui is a sophisticated, evidence-first local crypto research and paper-trading app with real execution deliberately disabled. Its strongest pieces are careful accounting/safety boundaries, reproducible data/research provenance and broad desktop functionality. Its biggest shortcomings are that no strategy has demonstrated a trustworthy positive edge, historical Coinbase coverage is currently blocked by terms-page access, observed paper operations have had stale-rule/reconciliation/scheduler reliability issues despite substantial recent repairs, and the latest terminal/data/research expansion is still an uncommitted working tree. Preserve the current work, reverify it, complete real read-only operational and Coinbase provenance checks, and let prospective evidence—not more indicators or a paid platform—determine whether any strategy merits confidence.
