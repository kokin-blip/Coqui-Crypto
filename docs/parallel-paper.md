# Parallel TrendVol paper experiment

This is a paper-only experiment. Coinbase remains read-only. Coqui copies a fresh, complete Coinbase portfolio **USD value** into a new cash-only local simulator; it does not copy Coinbase holdings or obtain Coinbase trading authority. Alpaca uses the dedicated paper account's actual USD cash and equity. Both legs receive the same frozen TrendVol v4.2 targets from completed Coinbase UTC daily bars. Their order timing, fills, and balances can differ.

## Setup

1. Create a dedicated, empty Alpaca paper account and obtain its **paper** API key ID and secret. In Coqui Settings → Connections → Alpaca Paper, enter the pair. Coqui verifies it with `GET /v2/account` on the hardcoded `https://paper-api.alpaca.markets/v2` endpoint before storing it in the OS secret store. The fields are cleared after submission; the values necessarily pass through the form briefly. The app exposes no live Alpaca endpoint.
2. Sync a Coinbase read-only account and confirm its latest snapshot is complete, healthy, and less than 24 hours old. The Alpaca paper account must have USD cash and no positions or open orders. Coqui will not reset, liquidate, or seed that external account.
3. Before unattended use, submit a small *paper* test order and verify its order ID, fill/partial-fill activity, position, and cash independently in the Alpaca API and dashboard. This integration's automated tests use mocks; they do not substitute for that live-paper smoke check. If the test leaves a position or open order, use a separate clean paper account for the experiment.
4. In Settings → Paper, attest that the independent smoke check is complete and explicitly start the parallel experiment. The daily scheduler will thereafter send Alpaca **paper** orders; pause or stop from the same panel. Stop requests cancellation of outstanding experiment orders and keeps existing paper holdings. Disconnecting Alpaca removes the stored keys and pauses the experiment without deleting its ledger.

## Reading results

Paper Trading shows opening balances, current marked equity, percentage return, holdings, targets, trades, and modeled costs for each leg. Alpaca's records are **externally recorded paper fills** from its simulator, not live exchange executions. The local leg models a 0.60% fee plus 0.10% spread and 0.15% slippage in fill prices. The Alpaca cost envelope shown in Coqui is a comparison estimate; Alpaca account equity is the external account's actual paper value, and no additional modeled charge is deducted from it.

Order intent and a deterministic client order ID are persisted before each Alpaca submission. A lost or ambiguous response is reconciled by client ID, never blindly retried. Missing market data, changed account, unexpected orders, rejected/partial orders that cannot finish in the daily execution window, or unresolved outcomes pause new submissions. Pausing does not cancel existing Alpaca orders; stopping requests cancellation and requires terminal order confirmation before the experiment is marked stopped.

Alpaca documents the [paper environment](https://docs.alpaca.markets/us/docs/paper-trading), [crypto orders](https://docs.alpaca.markets/us/docs/crypto-orders), and [account activities](https://docs.alpaca.markets/us/reference/getaccountactivities-2).
