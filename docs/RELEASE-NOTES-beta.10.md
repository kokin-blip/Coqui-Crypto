# Coqui 0.1.0-beta.10 — experimental macOS Apple Silicon

This build brings the current Alpaca paper activity, execution reliability, and strategy research work into one macOS release.

- Paper Trading shows the daily and intraday decision trail, Alpaca order acknowledgments, partial fills, fee activity, and retryable connection failures. The execution path records bid/ask and modeled order costs and reconciles ambiguous submissions before another order.
- Coinbase historical candle requests use the connected view-only key first, with the public endpoint as a fallback. Markets and Paper Trading show authenticated Coinbase quote, product, and book diagnostics separately from Alpaca fills.
- The bounded ridge-model ML worker records predictions and proposed target adjustments in shadow mode. It does not change Alpaca paper orders.
- The wider eligible coin universe, breakout candidate, range-rotation candidate, and market-state selector record independent shadow portfolios and prospective study evidence. They cannot submit Alpaca orders. The operational Alpaca paper target remains TrendVol over BTC, ETH, and LTC.

Coqui evaluates while the desktop app is open. Coinbase remains read-only; Alpaca orders are **paper orders** at Alpaca, not live exchange trades. Historical and virtual results use modeled costs and fills. Connected-key collection and an Alpaca paper-account order/dashboard reconciliation remain owner checks; no profitable strategy result is claimed.

This release contains only macOS Apple Silicon DMG and ZIP artifacts. The app is ad-hoc signed, not Apple Developer ID signed or notarized. See [installation guidance](INSTALL.md) for the first-launch prompt and checksum verification.
