# ADR-0006 — TradingView is presentation inspiration, not a data source

**Status:** ACCEPTED
**Date:** 2026-08-27

## Context

Coqui needs trustworthy completed history for research and a responsive live
market view for people. TradingView exposes excellent charting products, but its
Advanced Charts library contains no market data: an integrator must provide its
own feed. TradingView-supplied market data is licensed for human display and its
policy prohibits non-display processing such as automated decisions, price
referencing, order verification, and risk control. Automated collection is also
prohibited.

Remote TradingView widgets are not compatible with the renderer boundary. Coqui
ships `connect-src 'none'` and `frame-src 'none'`, disables webviews, and keeps
all network access in Electron's main process. Relaxing those controls for a
third-party script would be a security regression.

Sources: [Datafeed API](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/),
[charting-library terms](https://www.tradingview.com/free-charting-libraries/),
[market-data policy](https://www.tradingview.com/policies/), and
[automated-collection policy](https://www.tradingview.com/support/solutions/43000674726-why-is-my-account-banned-due-to-suspicious-activity/).

## Decision

- Do not add a TradingView data adapter, scraper, CSV importer, remote widget,
  embedded script, Pine signal path, or webhook-driven execution path.
- Keep `lightweight-charts` as the local Apache-licensed renderer for data whose
  provenance Coqui owns.
- Keep historical decision and research bars on completed Coinbase REST data.
- Use Coinbase's unauthenticated Exchange WebSocket feed for a display-only live
  quote cache in the main process. Subscribe only to bounded profile-selected
  products and expose validated snapshots over IPC.
- Mark every live quote `informationalOnly: true` and `decisionEligible: false`.
  It may improve the Markets screen and freshness reporting; it cannot enter a
  study, risk gate, paper proposal, fill model, or ledger transaction.
- Keep authenticated Direct Market Data deferred with the owner's personal-key
  verification. Sandbox endpoints are development fixtures, never production
  evidence.

## Consequences

Coqui gains a responsive market surface without changing its research record or
renderer CSP. Live prices may be stale or temporarily offline and the UI must
say so. The main process owns reconnects, heartbeats, bounds, and diagnostics.

Reopen this ADR only if TradingView and the underlying data owners provide a
written license covering Coqui's exact machine-processing use case, or if
Coinbase materially changes the public feed contract. Neither event silently
changes the execution boundary.
