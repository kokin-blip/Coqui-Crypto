# Market dataset pipeline — 2026-08-03

## Outcome

The Phase 2 operational dataset path is implemented in
`packages/services/src/market-data/decision-dataset.ts`. It builds daily decision
datasets from Coinbase venue bars only. Aggregator prices are intentionally not
substituted for Coinbase prices because the strategy must be evaluated against
the venue where simulated or future orders would fill.

## Contract

One command builds a live dataset and prints compact provenance:

```text
pnpm dataset:coinbase -- --products=BTC-USD,ETH-USD --days=365 --min-days=300
```

The command fetches every requested product as one batch, persists nothing from
that batch if any fetch fails, validates each canonical identity and daily UTC
calendar, atomically caches valid bars, excludes the normal current incomplete
candle, and then applies cross-asset alignment. Research uses `reject-on-gap` by
default. The result contains:

- canonical instrument keys;
- aligned UTC day keys and OHLCV rows;
- source, quality, retrieval, coverage, missingness, and drop provenance;
- minimum-history and latest-completed-bar freshness gates; and
- a deterministic lowercase SHA-256 dataset hash.

The in-memory object is deeply frozen. The operational SQLite cache remains
mutable by design; the immutable Parquet archive required for citable long-lived
research remains N7 and must store the full rows, not merely this hash.

## Fail-closed cases

- one requested provider fetch fails or throws;
- a returned bar identifies another product or source;
- OHLCV is invalid, duplicated, non-monotonic, or discontinuous;
- strict cross-asset alignment has a missing day;
- fewer than the requested minimum observations remain; or
- the latest expected completed Coinbase UTC bar is absent.

Focused tests cover each case, stable hashing across asset request order, exact
non-exponent decimal persistence, incomplete-candle exclusion, and runtime
immutability.

## Live smoke result

On 2026-08-03, the command ran against public Coinbase with BTC-USD, a three-day
window, and an in-memory database. It fetched four rows, excluded the current
incomplete row, retained three aligned completed UTC bars, and emitted a valid
SHA-256 dataset hash. No provider credential or `.env` value was needed or read.
