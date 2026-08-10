# Binance bulk importer — 2026-08-04

## Outcome

The first N8 source is implemented for explicit Binance spot monthly `1d` kline
archives. It is a research-data adapter only: no Binance account, credential,
balance, order, or execution surface was added.

```text
pnpm archive:binance -- --symbol=BTCUSDT --year=2024 --month=12
```

Optional `--database` and `--archive-dir` arguments select the local SQLite cache
and immutable raw-artifact root. The default archive layout is
`data/archive/binance/{symbol}/{year}/{month}/`.

## Integrity path

One import succeeds only after all of these checks:

1. The symbol, year, and month form a constrained provider path; callers cannot
   supply an arbitrary URL or ZIP entry name.
2. The companion `.CHECKSUM` contains exactly one SHA-256 and the expected ZIP
   filename.
3. The downloaded ZIP bytes match that SHA-256.
4. The ZIP is size-bounded and contains exactly the expected CSV entry.
5. UTF-8 and every 12-column kline row validate; timestamps are UTC daily,
   strictly increasing, and inside the requested month.
6. OHLC relationships, non-negative volume fields, and trade counts validate.

The importer understands Binance's documented spot timestamp transition:
archives before 2025 use milliseconds, while archives from 2025 onward contain
microseconds. Both normalize to integer milliseconds only after strict parsing.

## Provenance and persistence

The raw ZIP and upstream checksum are preserved immutably. A JSON manifest pins
the provider-relative path, archive and CSV SHA-256 values, byte sizes, record
count, time bounds, retrieval time, and a stable manifest hash. An existing raw
artifact is accepted only when its bytes match; a conflicting artifact fails.

Normalized SQLite rows preserve provider decimal strings exactly and use the
canonical identity `binance|spot|{symbol}` with `source = 'binance'`. They cannot
silently join Coinbase rows. N7 will promote these raw artifacts and manifests
into the immutable Parquet/DuckDB research archive.

## Dependency decision

ZIP extraction uses exactly pinned `fflate` 0.8.3. It is a pure-JavaScript,
zero-dependency ZIP implementation, avoiding platform-specific shell utilities.
The install passed the repository supply-chain policy and `pnpm audit --prod`
reported no known vulnerabilities on 2026-08-04.

## Verification

Tests cover millisecond and microsecond timestamps, exact decimals, checksum
tampering, wrong ZIP entries, wrong-month CSV rows, explicit provider URLs,
canonical venue isolation, SQLite round trips, and binary HTTP responses.

A live smoke import downloaded `BTCUSDT-1d-2024-12.zip`, matched Binance's
published SHA-256, extracted 31 daily records, and produced stable archive, CSV,
and manifest hashes. The smoke used an in-memory database and a temporary raw
artifact directory.

