# Kraken bulk importer — 2026-08-04

## Outcome

The second N8 source is implemented for Kraken's downloadable OHLCVT archives.
It remains research-only: no Kraken account, credential, balance, order, or
execution surface was added.

```text
pnpm archive:kraken -- --file=C:\Downloads\Kraken_OHLCVT.zip --pair=XBTUSD
```

`--origin=quarterly` identifies an incremental archive. Optional `--database`
and `--archive-dir` arguments select the SQLite cache and raw-artifact root. The
default archive layout is content-addressed as
`data/archive/kraken/{pair}/{archive-sha256}/`.

The command accepts a local file deliberately. Kraken distributes the archives
through Google Drive, whose direct-download behavior and opaque file identifiers
are not a stable data API. The application does not scrape or embed those
internals.

## Integrity path

The importer streams the ZIP instead of loading the full archive into memory.
One import succeeds only when all of these checks pass:

1. The caller supplies a constrained uppercase pair and safe ZIP basename.
2. Every encountered ZIP path is relative and traversal-free.
3. Exactly one entry has the basename `{pair}_1440.csv`; other pairs are not
   decompressed.
4. The selected decompressed CSV stays under a fixed size ceiling and is valid
   UTF-8.
5. Each row has the OHLCVT archive shape, or the API-equivalent shape containing
   VWAP; timestamps are integer seconds at UTC day boundaries and strictly
   increase.
6. Prices are positive, volume and trade counts are non-negative, and OHLC
   relationships are valid.

Kraken documents that intervals with no trades are absent. The parser therefore
allows daily gaps and counts them in `missingDailyIntervals`; it never fills a
price or zero-volume candle.

## Provenance and persistence

Kraken does not publish a companion checksum for these archives. Coqui computes
SHA-256 values while reading the ZIP and after extracting the selected CSV, then
records `upstreamChecksumAvailable: false`. This proves local identity and later
detects changes, but it does not authenticate the first download.

The raw ZIP is copied into its SHA-256 directory with exclusive-create semantics
and verified after copying. A stable manifest pins origin, pair, archive and CSV
hashes, byte sizes, row/time bounds, gap count, and retrieval time. SQLite keeps
the provider decimal strings exactly under `kraken|spot|{pair}` with
`source = 'kraken'`, preventing silent joins with Coinbase or Binance.

## Verification and limitation

Tests cover small-chunk streaming, both accepted row shapes, exact decimals,
no-trade gaps, path traversal, missing and duplicate pair entries, malformed
OHLC, canonical venue isolation, and exact SQLite round trips.

The official complete archive link returned a Google Drive quota-exceeded page
on 2026-08-04, so a live archive import could not be truthfully claimed. The
adapter is fixture-verified and ready for a manually downloaded official ZIP.
The first real import should be treated as an acceptance check: if Kraken's
actual filename or row contract differs, fail closed and revise this parser from
the preserved bytes rather than guessing or weakening validation.
