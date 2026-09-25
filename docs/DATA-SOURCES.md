# Data sources

Decision record for research and market-data inputs. Verified against official
provider documentation on 2026-08-04. A provider adapter still requires a live
smoke test before its limits or response shape become a runtime dependency.

## Decision

1. **Coinbase is execution truth.** Coinbase candles, product identity, fees,
   spread, and liquidity assumptions are authoritative for Coinbase simulations.
2. **Binance and Kraken are independent research venues.** Their archives add
   market-cycle depth and help detect a strategy that works only on Coinbase.
   They must never be substituted for Coinbase fill or cost data.
3. **Daily Coinbase product snapshots are the forward point-in-time universe.**
   Exchange archives do not reconstruct historical Coinbase eligibility.
4. **Aggregators are reference data.** CoinGecko, CoinMarketCap, and CoinPaprika
   may enrich explicitly mapped instruments with market cap, rank, supply, and
   cross-provider diagnostics. Their prices are not execution prices.
5. **Do not buy an aggregator yet.** Free exchange history is sufficient to
   re-derive the current price-based strategies. Paid history requires a
   pre-registered study showing that a specific unavailable feature is needed.
6. **TradingView is not a Coqui research or execution source.** Its visible and
   exportable chart history does not grant non-display or automated-processing
   rights. Coqui does not scrape it, call undocumented endpoints, or use it for
   backtests, risk, reconciliation, pricing, or paper decisions.

## Sources to use

### Coinbase historical candles

An active view-only Coinbase connection makes the authenticated Advanced Trade
`GET /api/v3/brokerage/products/{product_id}/candles` route the primary source
for historical charts and daily decision data. Coqui signs each GET in the main
process with the stored connection key. The API returns OHLCV decimal strings,
uses UNIX-second bounds and named granularities, and caps pages at 350 buckets.
Coqui validates each complete response and excludes unfinished buckets. If the
key is absent or an authenticated window fails, that whole window is fetched
from the public Coinbase Exchange endpoint instead. The chosen endpoint is
logged without credentials or tokens. Neither endpoint changes the canonical
Coinbase spot identity or the strict multi-asset gap policy.

The older Coinbase Exchange REST endpoint remains the public fallback and the
research archive source.

- Public candle requests support exactly 60, 300, 900, 3,600, 21,600, and
  86,400-second buckets.
- A request is limited to 300 candles.
- Coinbase warns that historical data can be incomplete and publishes no candle
  for an interval with no ticks.
- Research therefore keeps strict gap rejection by default and never fabricates
  volume or candles.
- `pnpm archive:coinbase` preserves exact raw REST response text, verifies its
  content-addressed acquisition manifest, writes one immutable N7 archive per
  product, and prepares the longest shared continuous multi-asset span.

Source: [Coinbase Get product candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)
and [Advanced Trade Get Product Candles](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product-candles).

### Coinbase market context

Markets and Paper Trading display authenticated Advanced Trade snapshots from
Get Best Bid/Ask, Get Product, and Get Product Book. The active profile's
view-only key signs GET requests in the desktop main process. Each endpoint has
its own availability and observation time; quotes and ten-level books refresh
on screen at most every 30 seconds, while product metadata is cached for five
minutes. Old provider timestamps and failed refreshes appear as stale. A
missing key or failed response does not replace the existing public live quote
stream or product catalog. These snapshots are informational only and never
enter TrendVol, paper order gates, or Alpaca fill reconciliation. Coinbase
order-book depth describes Coinbase liquidity, not Alpaca execution.

Sources: [Best Bid/Ask](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-best-bid-ask),
[Get Product](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product),
and [Get Product Book](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product-book).

### Coinbase authenticated account evidence

The profile-scoped, GET-only Coinbase adapter uses Advanced Trade for permissions, accounts, fills,
and fee-tier strings, plus Coinbase V2 account transactions for deposits, withdrawals, rewards, and
adjustments. Accounts retain `has_next` pagination; fills follow the current cursor-only response;
transaction `next_uri` values are accepted only when they remain on the same Coinbase host and
account path. Exact decimal strings are retained without float coercion. Fee evidence records only
string-valued maker/taker tier facts and does not consume deprecated Coinbase Pro aggregates or
change Coqui's conservative cost policy.

Sources: [Advanced Trade accounts](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/accounts/list-accounts),
[fills](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/list-fills),
[fees](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/fees/get-transaction-summary),
and [V2 transactions](https://docs.cdp.coinbase.com/coinbase-business/track-apis/transactions).

### Robinhood Crypto authenticated account evidence

The Robinhood Crypto Trading API v2 adapter is read-only. It signs the exact
method, request path, timestamp, API key, and request body with Ed25519 and uses
bounded pagination, timeouts, cancellation, capped retry/backoff, strict response
schemas, and sanitized errors for accounts, holdings, open orders, trading pairs,
best prices, and estimated prices. The API key and base64 private key remain in
the OS credential store. Coqui does not implement or export the provider's live
order-placement operation.

Robinhood balances, buying power, pending orders, permissions, rules, health,
and completeness contribute to current unified portfolio evidence. Robinhood
best/estimated prices may value the current display snapshot, but they are not
completed-bar strategy history. Coinbase completed daily bars remain the only
decision-eligible operational market dataset. Robinhood routing is paper-only
through the deterministic simulated venue.

Source: [Robinhood Crypto Trading API](https://docs.robinhood.com/crypto/trading/).

### Local market-event fixtures

Validated local JSON fixtures may add immutable event context with source ID,
source event ID, publication time, first-seen time, classification availability,
affected assets, provenance, and content hash. Replay uses `firstSeenAt` and
`classifiedAt` so information is never shown before Coqui could have known it.
Events may request a debounced research job, but cannot change strategy targets,
risk, routes, or execution. No external event-provider connection exists.

### Binance public archive

`data.binance.vision` is the preferred free bulk source for cross-venue research.

- Daily and monthly files are available without an API key.
- Spot klines support intervals from one second through one month; trades,
  aggregate trades, and futures datasets are also published.
- Every ZIP has a companion SHA-256 checksum. The importer must verify it before
  parsing and record both the upstream checksum and Coqui content hash.
- Spot timestamps changed from milliseconds to microseconds beginning
  2025-01-01. The parser must determine the documented epoch unit explicitly.
- Archive files may be corrected later. A reproducible study pins the downloaded
  bytes and manifest rather than silently replacing them.

The archive can create a **trade-observed Binance universe**: a product is known
to have traded when a valid observation exists. It does not prove the exact
listing or delisting time, continuous eligibility, or Coinbase availability.
Missing observations must not be converted into invented candles.

Source: [Binance public-data repository](https://github.com/binance/binance-public-data)

### Kraken historical OHLCVT

Kraken publishes downloadable CSV history for each market from its inception,
with 1, 5, 15, 30, 60, 240, 720, and 1,440-minute intervals and quarterly
incremental archives. It is useful for a pre-Binance and independent-venue
robustness dataset.

Kraken explicitly omits intervals in which no trades occurred. That absence is
liquidity information, not automatically a feed failure. The importer must keep
the distinction between `no-trade interval`, `missing/corrupt source`, and
`product not observed`.

Source: [Kraken downloadable historical OHLCVT](https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data)

### CryptoDataDownload

CryptoDataDownload offers standardized, third-party CSVs with no login and is a
useful manual cross-check. It is not a load-bearing source when an exchange's
first-party archive exists: provenance is weaker and the upstream data may have
been normalized or republished.

Source: [CryptoDataDownload free historical data](https://www.cryptodatadownload.com/data/)

### TradingView — evaluated, not adopted

TradingView can display long daily histories and lets a person export the data
already loaded in a chart. That makes it useful for a manual visual cross-check,
but not automatically usable as an application dataset.

- TradingView's Advanced Charts `getBars` interface is an API that asks an
  integrator's own datafeed for bars; it is not a TradingView historical-data
  API. TradingView's own tutorial obtains the sample bars from other providers.
- The free chart tier currently exposes a bounded intraday history; daily-based
  charts can show a longer range. Those are product display limits, not a stable
  acquisition contract.
- TradingView's current policy licenses its market data for display use and
  explicitly prohibits non-display processing including automated decisions,
  price referencing, risk controls, and machine-driven use. Its support policy
  also prohibits automated collection and scraping.
- Manual CSV export remains a user feature. Coqui will not import those files
  into research or decision evidence without written provider/data-owner rights
  that expressly cover the intended processing and redistribution.

Therefore no TradingView adapter, scraper, or dataset import is added. Coqui's
existing `lightweight-charts` dependency is only a local renderer for data Coqui
already has lawful provenance for; it does not fetch TradingView market data.

Sources: [Datafeed API](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Datafeed-API/),
[chart-data export](https://www.tradingview.com/support/solutions/43000537255-how-to-export-chart-data/),
[historical bar limits](https://www.tradingview.com/support/solutions/43000480679-historical-intraday-data-bars-and-limits-explained/),
[TradingView policies](https://www.tradingview.com/policies/), and
[automated-collection policy](https://www.tradingview.com/support/solutions/43000674726-why-is-my-account-banned-due-to-suspicious-activity/).

## Reference providers

### CoinGecko Demo

Keep the existing adapter for current/recent reference prices, market caps, and
provider comparison. Demo access is not a historical-universe solution:
CoinGecko states that historical API data is unavailable for inactive or
delisted coins. This remains true even if a paid plan can enumerate inactive
IDs.

Sources: [CoinGecko API pricing](https://www.coingecko.com/en/api/pricing) and
[inactive/delisted historical-data policy](https://support.coingecko.com/hc/en-us/articles/23190618031385-Can-we-access-historical-data-for-inactive-or-delisted-coins-via-CoinGecko-API)

### CoinPaprika Free

Keep the keyless adapter as a comparison/fallback source. Its current free plan
is for personal, non-commercial use and advertises 20,000 calls/month, 2,000
assets, and one year of daily historical price, volume, and market-cap points.
Historical OHLCV depth on the free plan is only the last 24 hours. These are two
different endpoint products and must not be described interchangeably.

Sources: [CoinPaprika pricing](https://coinpaprika.com/api/pricing/) and
[historical OHLC endpoint](https://docs.coinpaprika.com/api-reference/coins/get-historical-ohlc)

### CoinMarketCap Basic

Keep the existing free adapter for current reference comparisons. It adds no
venue-accurate candle history to the current strategy work. The owner's written
support confirmation about retained personal/family data should be archived if
a paid CMC download is ever approved, but it does not make aggregate prices
appropriate for Coinbase fill modelling.

Source: [CoinMarketCap API pricing](https://pro.coinmarketcap.com/api/pricing)

## Optional Phase 3 research inputs

### FRED and ALFRED

Macro series can test an independent regime hypothesis, but the FRED API is not
keyless: every request requires a registered application key. Official terms do
not promise the fixed 30/120 requests-per-minute limits sometimes quoted in
secondary summaries, so the adapter must pace conservatively and honor 429s.

Historical macro research must also respect publication times and revisions.
Use ALFRED vintages (what was known on each decision date), not today's revised
history projected backward. Candidate series should be pre-registered before
testing and must not enter a shipped default merely because they improve an
in-sample result.

Sources: [FRED API keys](https://fred.stlouisfed.org/docs/api/api_key.html) and
[ALFRED](https://alfred.stlouisfed.org/)

### Coin Metrics Community

Coin Metrics Community can support a later, pre-registered on-chain study. The
community API is limited to 10 requests per six seconds per IP and community
data is licensed for non-commercial use. Do not add the adapter until a study
names the required metrics, assets, frequency, and point-in-time policy.

Source: [Coin Metrics API conventions](https://docs.coinmetrics.io/api)

## Correctness traps

- `BTCUSDT` on Binance is not `BTC-USD` on Coinbase. Venue, product ID, product
  type, quote asset, fees, and liquidity stay in every canonical identity.
- A file or first trade establishes observation, not necessarily formal listing
  eligibility. A final trade does not necessarily equal the delisting instant.
- Binance/Kraken archives reduce survivorship bias only within the research
  universe they observe. They cannot repair historical Coinbase membership.
- Empty intervals have provider-specific meanings. Never globally forward-fill
  price/volume or treat every absence as a transport failure.
- Macro releases and circulating-supply histories can be revised. Dataset
  availability time is part of provenance, not optional metadata.
- A downloaded dataset is reproducible only when its raw bytes, checksum,
  license/terms snapshot, parser version, and normalized output hash are pinned.

## Work sequence

1. Continue the daily Coinbase `/products` snapshot immediately (N3).
2. After Phase 2 operational metrics (N6), start N8 acquisition/import groundwork
   with Binance spot daily klines and checksum verification.
3. Add Kraken only after the Binance importer and venue-isolation tests pass.
4. N7 immutable Parquet archives and manifests are implemented; Phase 3 studies
   must cite their verified dataset hash.
5. Prepare a study dataset only from verified Coinbase N7 archives with
   `pnpm research:prepare-dataset`; its immutable manifest binds source hashes,
   instruments, UTC coverage, code revision, and the aligned decision hash.
6. Run each venue as a separate dataset and robustness result. Never merge their
   bars into a synthetic Coinbase history.
7. Keep aggregator and macro features out of shipped defaults until a registered,
   nested out-of-sample study justifies them.

The Binance slice is implemented through `pnpm archive:binance`; see
`docs/studies/binance-bulk-importer-2026-08-04.md`. The Kraken slice is
implemented through `pnpm archive:kraken` and intentionally accepts a local file
instead of coupling the app to unstable Google Drive download internals; see
`docs/studies/kraken-bulk-importer-2026-08-04.md`.

The first Coinbase study acquisition is recorded in
`docs/studies/coinbase-study-acquisition-2026-08-09.md`. Raw responses and
Parquet files remain local under ignored `data/`; their hashes and coverage are
the citable record committed to documentation.

## Local market-event fixtures

Phase 8 deliberately adds no event-provider connection. Operators may import a
validated local JSON array with `pnpm events:import-local`; each record carries a
source identity, source event ID, publication time, first-seen time, and local
file provenance. Duplicate source identities are idempotent only when their
canonical contents match. A changed duplicate is rejected rather than revised.
The desktop Events workspace uses the same parser and service, but Electron main
selects and reads the file. Only sanitized result identities cross back to the
renderer; fixture contents and local paths do not.

Event replay is governed by `firstSeenAt`: an event is absent before that time,
and a classification is absent before its own `classifiedAt`. Events are context
for charts, Advisor evidence, and bounded research-trigger requests only. They
cannot change operational targets or execution.
