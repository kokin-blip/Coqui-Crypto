# Free market-provider comparison — 2026-08-02

## Decision

Keep Coinbase venue candles and products as execution and backtest truth. Add
CoinGecko Demo, CoinMarketCap Basic, and CoinPaprika Free as reference providers
for market cap, volume, rank, coverage, and cross-provider diagnostics. Do not
join on ticker symbols and do not substitute aggregator prices for Coinbase
fills.

The comparison records latency, mapped/returned coverage, HTTP outcome, and
pairwise midpoint price deviation in basis points. It is an evaluation surface,
not an automatic provider-selection or trading signal.

## Provider contracts checked

- CoinGecko Demo uses `https://api.coingecko.com/api/v3` and the
  `x-cg-demo-api-key` header. The adapter retains the predecessor's conservative
  30 requests/minute pacing and honors runtime 429/Retry-After responses.
- CoinMarketCap uses `https://pro-api.coinmarketcap.com`, the
  `X-CMC_PRO_API_KEY` header, and `/v3/cryptocurrency/quotes/latest` with numeric
  IDs. The current documentation lists Basic support, 60-second quote updates,
  and one credit per 100 assets.
- CoinPaprika Free uses `https://api.coinpaprika.com/v1` without a key. The
  all-tickers endpoint returns up to 2,000 assets on Free and updates about every
  five minutes; the published Free quota is 20,000 requests/month.

Primary references:

- <https://docs.coingecko.com/docs/setting-up-your-api-key>
- <https://docs.coingecko.com/reference/coins-markets>
- <https://coinmarketcap.com/api/documentation/guides/authentication>
- <https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency>
- <https://docs.coinpaprika.com/api-reference/rest-api/introduction>
- <https://docs.coinpaprika.com/api-reference/tickers/get-tickers-for-all-active-coins>

## Secret boundary

Development keys are loaded by Node from `.env` into the main-process
environment using `COINGECKO_DEMO_API_KEY` and `COINMARKETCAP_API_KEY`.
Production storage remains the OS credential manager. Authenticated clients
attach headers only to the exact HTTPS provider host and reject redirects.
Keys, request headers, provider response bodies, and backend error messages are
absent from smoke output and typed failures.

Run `pnpm build` followed by `pnpm providers:smoke`. The command reports only
configuration presence and sanitized comparison metrics.
