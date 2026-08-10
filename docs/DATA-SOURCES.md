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

## Sources to use

### Coinbase Exchange REST

Coinbase is already integrated as the daily decision-dataset source.

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
