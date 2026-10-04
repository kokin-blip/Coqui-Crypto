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

## Figma handoff limitation

The saved file contains semantic variables, reusable components, original
editable coin vectors, six bottom-tab states, depth/trades, state examples, an
algorithm drawer, and desktop/responsive frames. The Starter account's three-page
limit required merging Foundations and Handoff. The tool quota then blocked the
last responsive polish: check the 1440-frame body padding/right edge and the
spacing between coin vectors and asset labels. The implementation corrects these
spacing issues. Final runtime additions (catalog fallback, current-campaign
source selection, and fullscreen recovery) are documented here but could not be
synced back to Figma after the quota was reached.
