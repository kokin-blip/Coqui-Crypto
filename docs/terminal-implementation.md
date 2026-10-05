# Unified trading terminal implementation

Design specification: https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs

The editable specification was composed and visually reviewed before renderer
implementation. The Starter account permits three pages, so Foundations and
Handoff share a page. Coin vectors originate in the user-supplied community pack.

## Implementation sequence

1. Add validated order-book and recent-trades read channels. Keep all sockets,
   snapshot/update processing, reconnect recovery, and bounded caches in main.
   Subscribe to unauthenticated Level 2 Batch (50 ms) only for the selected terminal product. Existing ticker,
   matches, and candle functionality continues on the same public connection.
2. Reuse AdvancedMarkets and TradingWorkstationChart in the terminal. Share the
   primary product with book, depth, recent trades, and asset-scoped decisions.
   Preserve saved layouts, comparisons, drawings, extensions, and indicators.
3. Compose compact tabbed account/evidence tables and the algorithm sidebar from
   existing CoquiClient channels. Preserve proposal review and performance views.
4. Replace navigation composition with one shell. Treat old simple/advanced
   preferences identically without deleting stored settings. Preserve all URLs,
   themes, motion preferences, account profiles, and execution restrictions.
5. Verify streaming arithmetic/recovery, renderer boundaries, Electron smoke,
   performance, and visual overflow. Separate baseline failures from regressions.

## Read-model contracts

- market-data.order-book: productId, positive decimal aggregation, bounded limit;
  canonical instrument, connection, initialized/stale/unavailable state, bids and
  asks with exact cumulative amounts, observation timestamp, source and literals
  informationalOnly=true / decisionEligible=false.
- market-data.recent-trades: productId and bounded limit; exact price/size,
  product-scoped trade IDs, taker side, observation time and incomplete-tape flag.
- Book updates replace absolute sizes; zero removes a level. Reconnection drops
  old book state and awaits a new snapshot. A heartbeat never initializes a book.
- Bids aggregate down and asks up to increment multiples using fixed-point
  arithmetic. Only plotting coordinates and visual depth ratios use Number.
- Trade cache is bounded and deduplicated. A detected heartbeat gap is explicit;
  this UI tape does not promise complete historical exchange records.

## Source mappings

Algorithm: decision.timeline/detail. Risk: risk.dashboard/evidence-gate.
Connected assets: portfolio.current. Paper positions: paper.portfolio and
paper.exploratory.portfolio. Proposals: paper.execution.proposals with existing
PaperProposalReview. Performance: existing Performance and paper metrics.
Research: research.runs/scoreboard. No confidence score is fabricated.

## Compatibility

The terminal becomes Overview; Markets remains the expanded workstation.
No new execution permission or manual order-entry path is introduced. Connected
balances and simulations remain separate. Existing backend/research edits are
outside the redesign and must be preserved.

## Implemented mappings and migration

- `TerminalWorkspace` is Overview; `AdvancedMarkets` remains Markets and is
  embedded unchanged in purpose within the terminal. Shared primary-product
  state controls chart, depth, tape, and decision scope. Existing drawings,
  extensions, indicators, comparisons, layouts, and chart preferences remain.
- `TerminalOrderBook` and `TerminalDepthChart` use the new read-only channels.
  `CoinbaseMicrostructure` handles initialization, absolute updates, removals,
  bounded caches, trade deduplication, and explicit dropped-match detection.
  Invalid depth restarts the feed and awaits a new snapshot; old socket and
  unsubscribed-product messages are ignored.
- `TerminalDataTables` reads connected holdings separately from simulation
  ledgers. Proposals retain the existing hash-bound review workflow.
  `TerminalPerformance` identifies ledger versus exploratory performance and
  never treats exploratory evidence as validation or live-execution permission.
- One compact top navigation replaces mode-specific composition. Legacy mode
  values remain valid in storage; both select the same interface. Existing hash
  routes and specialist views remain. Query refresh retains same-request data
  without carrying one product's values into another product's loading state.
- Electron fullscreen is restricted to the application's renderer. The native
  permission callbacks now use Electron's actual signatures. All other browser
  capabilities remain denied; security tests cover foreign frames and origins.

## Figma handoff completed — 2026-10-04

After access was upgraded, the remaining quota-blocked work was completed in the
existing editable file. Foundations and Handoff retain their combined page.

- Corrected body fill constraints and 8px padding on both sides across desktop,
  responsive, and state frames. The 1440px and 1280px right edges remain visible.
- Rescaled all five coin components to their 18px slots and corrected asset-row
  alignment so the shared 8px icon/text gap actually applies.
- Added linked market selection to book controls, restrained cumulative depth
  shading, exact illustrative totals, and neutral amount/total typography.
  Responsive examples show fewer outer levels so bids remain visible.
- Synced current-campaign source selection in positions/performance, added an
  exploratory performance example, and added catalog-fallback and fullscreen
  frames. The handoff records source options, reconnect/reset behavior, and
  preservation of chart preferences. Loading/offline examples do not claim live
  observations.
- Reviewed fresh desktop, 1440px, 1280px, drawer, catalog-fallback, exploratory,
  disconnected, and fullscreen exports. Structural inspection found 21 screen
  frames, 835 component instances, IBM Plex Sans throughout, and no image fills.
  Text, vectors, and component instances remain editable.

Reviewed exports: `docs/design/screenshots/figma-terminal-2026-10-04/`.
This follow-up changes the Figma specification and handoff documentation; it does
not change application code or replace the prior runtime verification results.


## Responsiveness and recorded activity — 2026-10-04

The existing chart now creates its canvas only for instrument/series identity
changes. Candle and volume updates, marker updates, price lines, drawings, chart
height, indicators, and comparisons have separate update paths. Crosshair lookup
uses binary search; accessible observations are memoized. Chart/facts queries
share the same candle-aligned history range across navigation, and signed extensions evaluate stable completed
OHLCV inputs rather than polling object identities or retrieval timestamps.
Query cancellation follows the existing synchronous profile reset. Hidden
algorithm panels are mounted only when visible.

The editable activity specification is [desktop](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=29-2196),
[1440](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=31-2739),
and [1280](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=31-3191).
Reusable table rows/headers and position labels use existing semantic variables,
editable typography and Auto Layout. Missing-data and shared/combined-scope
examples remain editable; illustrative financial data is explicitly labeled.

Read-only channels `trading.activity.scopes`, `.summary`, `.trail`, and `.shared`
are typed and validated. Main-process adapters resolve persisted ordinary,
exploratory, parallel Coqui, and Alpaca paper facts. Every trail record includes
profile, source, campaign, canonical/reported instrument, and recorded wallet or
account attribution. A fill is deduplicated by its persisted identity (Alpaca
activity ID where available). A review or order state does not create a fill.
Combined simulations stay separate from individual wallets. Connected assets
filter actual account contributions. The original proposal review workflow stays
in the profile-wide Proposals tab; Operations retains the full decision timeline.

FIFO projections expose remaining lots through their quantity, average entry and
fee-inclusive basis. Partial closes report realized profit separately from open
unrealized profit. Price friction is embedded in execution prices; only venue
fees are added to basis or subtracted from proceeds. Imported opening holdings
and unknown broker fees keep total profit unknown, with labeled known-basis
subtotals. Recorded account quantities that disagree with fill history invalidate
complete P&L. Marks carry source, observation time and freshness.

Shared evaluations open only manifest-allowlisted profile files, read-only and
without migrations, under the existing profile-operation gate. They have bounded
record/row reads, originating profile/time labels, and no balance or authority
mutation. Existing strategy targets and recorded outcomes are displayed; no new
profit-percentage exit target or strategy behavior was introduced.

The production `pnpm perf:terminal` harness uses a disposable profile with 2,000
completed candles, provisional updates, Level 2 updates, a bounded trades tape,
an enabled extension, and a saved drawing used to measure viewport drift.
`COQUI_PERF_DEV_URL=http://127.0.0.1:5173` runs the same workload against Vite.
`COQUI_PERF_ACTIVITY=1` adds synthetic persisted purchases, a partial close and a
pending proposal; these fixtures never enter the user's database.
