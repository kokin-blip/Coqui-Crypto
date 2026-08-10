# CoinGecko public-adapter decision — 2026-08-01

Phase 2 rechecked the predecessor's CoinGecko fallback against the current
official API contract before transplanting it.

Official sources checked:

- The keyless public API uses `https://api.coingecko.com/api/v3`, has a dynamic
  shared IP-based limit, and directs clients to back off after HTTP 429. CoinGecko
  describes it as a low-volume testing and prototyping surface rather than a
  production-reliability promise.
  <https://docs.coingecko.com/docs/keyless-public-api>
- `/simple/price` accepts unique CoinGecko IDs and multiple comma-separated IDs.
  IDs take precedence over names or symbols, and `precision=full` is supported.
  <https://docs.coingecko.com/reference/simple-price>
- `/coins/markets` accepts an explicit `ids` filter, returns price, market cap,
  volume, rank, change, image, and update time, and permits at most 250 IDs per
  request.
  <https://docs.coingecko.com/reference/coins-markets>
- CoinGecko recommends REST for on-demand reference data and periodic polling;
  its own trading guidance positions streaming data as the real-time path.
  <https://docs.coingecko.com/docs/data-delivery-methods>

Decision:

- Keep Coinbase as the app's primary venue and execution truth. CoinGecko fills
  missing reference prices and market metadata only; it cannot authorize an
  order or replace venue-native execution quotes.
- Join providers solely through each `AssetRef.coingeckoId`. Never infer a join
  from ticker symbol, name, rank, or result order.
- Batch no more than 100 IDs per call, below the documented 250-ID markets cap
  and with URL-length headroom. Malformed rows and failed batches degrade to
  missing optional data.
- Normalize spot USD values into branded decimal strings before they cross the
  adapter boundary. Preserve binary numbers only for non-ledger percentages.
- Pace the public host at the predecessor's conservative 30 requests/minute.
  This is a local ceiling, not a claim about the dynamic shared allowance; the
  HTTP boundary also honors 429/`Retry-After` and bounded exponential backoff.
- The keyless route is acceptable for development and light optional fallback.
  Before a packaged production app treats CoinGecko as reliably available, its
  shell must support the appropriate keyed plan through the OS-backed secret
  store and send credentials in headers, never query parameters.

Implementation correction:

The predecessor's fallback maps canonical assets through a symbol-keyed registry
and returns binary-number prices. Phase 2 instead receives venue instruments,
resolves only their explicit CoinGecko IDs, and returns decimal prices keyed by
`InstrumentKey`. Market enrichment uses the same explicit map, eliminating the
predecessor's remaining ambiguous cross-provider symbol path.
