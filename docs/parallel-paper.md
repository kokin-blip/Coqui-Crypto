# Parallel TrendVol paper experiment

This is a paper-only experiment. Coinbase remains read-only. Coqui copies a fresh, complete Coinbase portfolio **USD value** into a new cash-only local simulator; it does not copy Coinbase holdings or obtain Coinbase trading authority. Alpaca uses the dedicated paper account's actual USD cash and equity. Both legs receive the same frozen TrendVol v4.2 targets from completed Coinbase UTC daily bars. Their order timing, fills, and balances can differ.

The daily dataset requests up to 400 days of historical Coinbase candles on refresh, so its 121-bar minimum does not require 121 days of app uptime. A connected view-only Coinbase key makes the authenticated Advanced Trade candle route primary; a failed or unavailable authenticated request falls back to the public Coinbase Exchange candle route. Both routes retain completed-bar filtering and strict alignment. This change does not address an Alpaca API outage or automatically resume an experiment already paused for `alpaca_unavailable`.

## Setup

1. Create a dedicated, empty Alpaca paper account and obtain its **paper** API key ID and secret. In Coqui Settings → Connections → Alpaca Paper, enter the pair. Coqui verifies it with `GET /v2/account` on the hardcoded `https://paper-api.alpaca.markets/v2` endpoint before storing it in the OS secret store. The fields are cleared after submission; the values necessarily pass through the form briefly. The app exposes no live Alpaca endpoint.
2. Sync a Coinbase read-only account and confirm its latest snapshot is complete, healthy, and less than 24 hours old. The Alpaca paper account must have USD cash and no positions or open orders. Coqui will not reset, liquidate, or seed that external account.

The Coinbase snapshot sizes only the optional local comparison book; it does not fund Alpaca. Any positive, fully valued Coinbase snapshot can start the experiment. Alpaca orders use only the separate Alpaca paper account's cash and venue limits.
3. Before unattended use, submit a small *paper* test order and verify its order ID, fill/partial-fill activity, position, and cash independently in the Alpaca API and dashboard. This integration's automated tests use mocks; they do not substitute for that live-paper smoke check. If the test leaves a position or open order, use a separate clean paper account for the experiment.
4. In Settings → Paper, attest that the independent smoke check is complete and explicitly start the parallel experiment. The daily scheduler will thereafter send Alpaca **paper** orders; pause or stop from the same panel. Stop requests cancellation of outstanding experiment orders and keeps existing paper holdings. Disconnecting Alpaca removes the stored keys and pauses the experiment without deleting its ledger.

The legacy seven-day campaign exercise is only a research record. It does not stop either paper simulator or the separate Alpaca paper account, and acknowledging its record is not required to start this experiment. Older profiles may still store an active `campaign_exercise` stop; execution and status ignore that historical marker. Explicit operator stops and risk hard stops remain separate controls, as do the Alpaca order and reconciliation safeguards.

## Reading activity and results

Paper Trading → Overview leads with **Alpaca paper activity**. It shows the most recent scheduler check and completed-bar decision, the TrendVol inputs and target weights, and up to 20 recent recorded events. Planned orders, submission attempts, Alpaca-reported order states, fills, and no-trade outcomes have distinct labels. Alpaca order IDs can be compared with the linked paper dashboard. A planned or submitted order is not presented as a fill. The status distinguishes waiting for a completed daily bar, an in-progress check, pending order activity, a reconciled daily pass, a user pause, and an attention state. A scheduler check more than three minutes old is marked overdue. The check timestamp is runtime-only and starts empty when Coqui opens; the decision and order history comes from the append-only experiment ledger.

The Overview also shows **Coinbase market context** for BTC-USD, ETH-USD, and
LTC-USD: authenticated best bid/ask, spread, product state, and bounded book
availability with separate timestamps. Markets shows up to ten bid and ask
levels for the selected product. This context is informational only. It does
not affect TrendVol targets or Alpaca paper orders and cannot verify an Alpaca
fill.

The daily scheduler runs while the Coqui desktop host is open and authoritative. A connected account alone does not mean the experiment is running. Coqui normally checks once per minute, but a new daily decision must pass the completed-bar and 00:00–00:15 UTC execution window. If the app starts after that window, it waits for the next UTC day’s window; it does not make a late decision. The activity panel shows the next window time so this wait is distinguishable from an order failure. A no-trade is a valid recorded outcome. A daily pass is called reconciled only when it had no Alpaca orders or recorded fill activity matches every completed Alpaca order; an order reported filled can remain pending while its activity record arrives. To verify actual paper execution, compare the Alpaca order ID and activity with the Alpaca paper dashboard; the Coqui timeline is a local readout of recorded evidence.

Balances, current marked equity, percentage return, holdings, trades, and modeled costs remain under **Balances, returns, and paper fills**. Alpaca's records are **externally recorded paper fills** from its simulator, not live exchange executions. The local leg models a 0.60% fee plus 0.10% spread and 0.15% slippage in fill prices. The Alpaca cost envelope shown in Coqui is a comparison estimate; Alpaca account equity is the external account's actual paper value, and no additional modeled charge is deducted from it.

Order intent and a deterministic client order ID are persisted before each Alpaca submission. A lost or ambiguous response is reconciled by client ID, never blindly retried. Missing market data, changed account, unexpected orders, rejected/partial orders that cannot finish in the daily execution window, or unresolved outcomes pause new submissions. Pausing does not cancel existing Alpaca orders; stopping requests cancellation and requires terminal order confirmation before the experiment is marked stopped.

Alpaca documents the [paper environment](https://docs.alpaca.markets/us/docs/paper-trading), [crypto orders](https://docs.alpaca.markets/us/docs/crypto-orders), and [account activities](https://docs.alpaca.markets/us/reference/getaccountactivities-2).
