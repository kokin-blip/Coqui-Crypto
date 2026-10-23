# P0/P1 capital accounting implementation addendum

The complete [P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains the durable source of truth, in full. This addendum implements only its P0/P1 sequence. Original roadmap SHA-256: `fda3c0b76897bbb4497cf0e13a7a70d5b9d0e75c441fea4a1044c500ae5cdd25`; companion evidence: `ff2b0270f0de0af52b87cd7e3f6eb168e34956b3857ab085c4290d2bfff287a4`.

## Accepted decisions

- Evidence ingestion only. No manual cash-flow entry/correction screen; tax lots and reconciliation notes do not establish capital flows.
- Exact or unavailable, per metric. No assumed flow timestamps, historical prices, interpolation, Dietz approximations or bridging missing daily marks. Independently supported balances/P&L remain visible.
- Financial account identity and environment govern the USD pool; profile identity only governs access. No combined multi-account performance.
- Economic opening capital is separate from tax basis. Historical performance without supporting evidence is unavailable; forward tracking has an explicit opening boundary.
- Corrections are append-only and lineage-bound. Provider IDs, not acquisition-run IDs, identify financial events. Conflicts cannot be resolved by receipt order.
- Preserve all legacy calculation semantics, immutable reports, dataset hashes, frozen research, negative findings, consumed holdouts and safety gates.
- Only read-only financial projections are added. No strategy/budget/reserve/order/withdrawal/deployment/registration changes.

## Source inventory and coverage

Baseline: [source and dirty-tree manifest](evidence/capital-accounting-2026-10-23/baseline.json). The initial commit and existing modified/untracked files are recorded there; changes must use focused hunks without reset, stash or broad formatting.

Local paper reuses immutable origin, actual book ledger, fills and valuation observations. Coinbase reuses sync evidence plus a separate capital envelope retaining retail portfolio membership, counterparties, fees and timing; legacy schema-2 hashes remain untouched. Alpaca reuses existing bounded account/history/activity/order reads, persisting sanitized evidence without widening credentials, polling or write capabilities. Robinhood balances remain observed balances; capital performance is unsupported until adequate flow evidence exists.

Coinbase creation/update timestamps do not prove financial effect time; `native_amount` does not independently establish historical arrival valuation. Bare buys can be bank-funded. Completed USD fiat deposits/withdrawals are capital candidates, not automatically verified flow-time events. Transfers need scope and matching legs. Alpaca CSD/CSW are candidates; JNLC remains ambiguous, date-only records retain their uncertainty, and history buckets never become intraday timestamps.

Primary references: [Coinbase transactions](https://docs.cdp.coinbase.com/coinbase-app/track-apis/transactions), [Alpaca activities](https://docs.alpaca.markets/us/docs/account-activities). Existing bounded acquisition success is not a claim of complete lifetime history.

## Architecture and acceptance

Add immutable scopes, source batches, event revisions, epochs, valuations and versioned reports; only access bindings/checkpoints are operational metadata. Decimal strings and canonical JSON/SHA-256 identify the financial facts. Additive migration follows v95; migration creates empty tables, never synthetic funding.

Economic P&L = terminal equity − economic opening equity − contributions + confirmed net external outflows. Equity already reflects account costs; fee attribution is not another deduction. Confirmed user receipts are a distinct subset. Basis uncertainty affects scoped lot P&L independently of total economic P&L.

Calculation version `capital-flow-performance-v1` uses actual before/after flow valuations to issue/redeem units. Total TWR can be available without daily risk coverage. Daily statistics require a complete consistently timed daily series. Annualized TWR requires 365 elapsed days; IRR requires supported dates and certified uniqueness. Zero capital/total loss/restart segments remain explicit and cannot erase lifetime losses.

Channels `capital.scopes` and `capital.performance` read local evidence only. Current displays use the new projection; old channels/reports retain compatibility. Every unavailable metric includes reasons, missing evidence and restoration guidance. Copied facts are archived, bindings/checkpoints cleared, and no financial identity/hash or authority is rewritten into a fresh account.

Delivery batches: P0-A baseline/specification; P0-B definitions/regressions; P1-A storage/contracts; P1-B local ingestion; P1-C connected ingestion; P1-D calculations; P1-E projections/displays; P1-F integrated acceptance. Track each batch in the [phase tracker](small-portfolio-phase-tracker-2026-10-23.md). Before any later phase, reread all its saved requirements.

Tests cover deposit/withdrawal neutrality across nine balances; cost/basis changes and sale proceeds; internal transfers; fees once; confirmed receipts; pending/duplicate/conflicting/corrected events; missing dates/marks/history; metric-independent availability; zero capital and IRR; wrong account/environment; migration rollback, backup/restore/duplication; legacy/report/research preservation and zero financial side effects. Focused tests precede typecheck, lint, full tests and build. These checks establish software behavior, not profitability, connected ownership, study qualification or release approval.

## Delivery record and exact prompt

The [exact initiating implementation prompt](evidence/capital-accounting-2026-10-23/prompt-used.md) is preserved without reconstruction. [Source inventory and acceptance evidence](evidence/capital-accounting-2026-10-23/implementation-evidence.md) describe the actual integration, limitations and checks. [COQ-35](https://linear.app/coqui-crypto/issue/COQ-35/implement-p0p1-capital-flow-accounting-and-versioned-performance) tracks implementation separately from the completed research issue COQ-34.

Migration 96 is additive. Connected projections consume existing acquisitions; `capital.scopes` and `capital.performance` perform local reads only. Historical normalization retries after durable acquisition or local capture, outside the migration and read handlers. The terminal account-performance view now uses the capital projection; archived campaign and ledger comparisons remain explicitly exploratory/legacy views.

Reconnecting a freshly verified connected account can restore an archived access binding to the same economic scope. This changes access metadata only and neither changes financial facts nor supplies coverage. A copied local paper book cannot reactivate its source scope automatically.

The build regenerates the existing current transitive-dependency manifests when public exports change. Exact pre-build manifests are archived alongside the baseline; frozen study reports, negative findings and holdout identities are not regenerated. The Node lint environment also recognizes the standard `URL` global, leaving the historical source-probe script unchanged.
