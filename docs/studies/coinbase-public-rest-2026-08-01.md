# Coinbase public REST contract check — 2026-08-01

Phase 2 rechecked the predecessor's public market-data routes against Coinbase's
official documentation before transplanting them.

Official sources checked:

- Exchange product candles use
  `GET https://api.exchange.coinbase.com/products/{product_id}/candles`, accept
  granularities including 86,400-second daily bars, return OHLCV buckets, and
  cap a request at 300 candles. Coinbase warns that intervals without trades may
  be absent and that a response may include candles preceding the requested
  start.
  <https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles>
- Exchange product stats use
  `GET https://api.exchange.coinbase.com/products/{product_id}/stats`; quoted
  prices such as `last` are decimal strings.
  <https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats>
- The Exchange currency catalog remains available at `GET /currencies`.
  <https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/currencies/get-all-known-currencies>
- Advanced Trade also publishes unauthenticated market routes under
  `https://api.coinbase.com/api/v3/brokerage/market/...`.
  <https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api>

Decision:

- Preserve the predecessor's Exchange public REST transport for read-only stats,
  product discovery, and historical candles. Its response shape matches the
  tested predecessor contract and its 300-candle pagination is explicit.
- Store spot prices as validated decimal strings keyed by canonical Coinbase
  product identity. Do not convert them through binary floating point.
- Normalize daily OHLCV into provenanced `MarketBar` values. Reject an entire
  malformed page, retain the five-minute completion delay, filter documented
  pre-start rows, and surface missing intervals later through alignment.
- Preserve distinct product identities even if display symbols collide. Do not
  deduplicate or join instruments by symbol.
