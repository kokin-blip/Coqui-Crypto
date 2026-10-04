# Market-data foundation

## Acquisition

The research-only workflow acquires daily spot observations directly from first-party
sources and publishes verified immutable Parquet datasets without reading or writing
operational SQLite. Start with the checked-in BTC/ETH configuration:

```sh
pnpm archive:market -- --config=config/market-acquisition.json \
  --code-revision=<git-commit-or-explicit-working-tree-label>
```

The configuration has `schemaVersion: 1`, a nonempty `products` array, optional
`start` and `endExclusive` UTC dates (`YYYY-MM-DD`), and `sourceDir`, `archiveDir`,
and `reportDir`. Every product explicitly declares `venue`, `productId`,
`productType: "spot"`, `baseAsset`, and `quoteAsset`. Additional assets require
configuration entries, not a parser or orchestration rewrite. Paths resolve from
the command's working directory.

Without date bounds, Coinbase scans from January 2012, Binance from July 2017,
and Kraken uses its published full archive plus later published quarterly
increments. One UTC cutoff is captured at startup, excluding unfinished daily
bars. Provider coverage differences and publication lags remain visible.
Coinbase also retains its existing five-minute finalization delay; a run within
five minutes of UTC midnight can report a final-window validation failure rather
than assuming that the last candle has finalized.

Binance prefers monthly ZIPs and falls back to daily ZIPs only when the monthly
endpoint returns HTTP 404. A missing file is recorded; it does not establish a
listing or delisting. Authentication failures, failed transport, invalid checksums,
and parser errors are failures. Timestamps use the documented epoch unit:
milliseconds before 2025 and microseconds from 2025 onward.

Kraken discovery reads the official support article and published checksum list.
The currently documented full release ends June 30, 2026. The downloader validates
part numbering, each published part checksum, and the checksum of the concatenated
archive. Parts are preserved once and streamed in order into the ZIP64-capable
parser; the workflow does not write another assembled multi-gigabyte copy. Only
configured 1440-minute CSVs are decompressed. Scientific-notation source decimals
are expanded exactly, including small historical Kraken volumes. The downloader uses bounded memory,
validated Range/If-Range resumption, cancellation, declared-length checks, and a
256 MiB disk-space reserve. A changed object or unsupported Range restarts safely.
Missing upstream checksums fail closed rather than claiming upstream verification.

## Reproducibility and reports

Raw bundles are content-addressed and atomically published. Version 1 acquisition
envelopes bind raw bytes, upstream checksums, source documentation/terms snapshots,
original capture times, parser version, and the configuration hash. Parquet's
existing `sourceArtifacts` references bind each contributing envelope, preserving
compatibility with existing archive manifests. Raw bytes and every envelope are
reverified before cached acquisition is reused. Provider parsers then reconstruct
the observations; mutable normalized-cache rows never become the research source.

Rerunning resumes verified captures with their original retrieval times. Use
`--refresh` (or configuration `refresh: true`) to download upstream corrections as
new immutable versions. Existing versions are retained. Interrupted downloads keep
partial bytes and validators, and completed acquisitions survive later failures.
Identical overlapping observations deduplicate; differing values fail rather than
silently choosing a replacement.

Every instrument gets a separate year-partitioned Parquet archive, retaining exact
OHLCV decimal strings, canonical venue/product identity, and quote denomination.
The workflow verifies file hashes, row counts, and dataset hashes through DuckDB.
Binance USDT observations are never converted into Coinbase USD execution history.
Coinbase decision-dataset eligibility and strategy/cost defaults remain unchanged.

JSON and Markdown reports record requested and observed coverage, unobserved ranges,
unavailable provider files, source failures, envelope paths, and verified dataset
and manifest hashes. Overall success requires a nonempty verified dataset for every
configured product and no unresolved source failure. Verified partial coverage can
be archived while the overall run remains incomplete. For Kraken, absent intervals
within successfully acquired coverage indicate no reported trades; data after the
published release cutoff is unavailable history, not a no-trade observation.
No missing candle is manufactured.

Raw artifacts and reports stay under ignored `data/`. Commit citable acquisition
results and hashes in study documentation, not the bulk archive.

## Source terms correction

The research handoff describes Binance as freely downloadable provider data rather
than a generic CC dataset. The current dataset-specific terms are more precise:
Binance's Vision Dataset Terms, version 1.0 dated August 26, 2026, specify
CC BY-NC-SA 4.0 and personal non-production historical research among their permitted
uses. The repository's MIT software label does not replace those dataset terms.
The workflow captures the terms in each acquisition's provenance. It does not add
commercial redistribution, compensated signals, or live execution.

Sources: [Binance documentation](https://github.com/binance/binance-public-data/blob/master/README.md),
[Binance dataset terms](https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md),
[Kraken archive documentation](https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data),
and [Coinbase historical candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles).

## Alternative-data roadmap

1. GDELT: acquire a bounded crypto-news metadata corpus, preserving URLs rather
   than mirroring publisher text. Bind stable source IDs, publication time,
   first-seen/availability time, retrieval time, queries, raw hashes, and terms.
   Historical retrieval must not invent historical first-seen times. Register one
   daily news hypothesis and a point-in-time cutoff policy before testing it.
2. Ethereum activity: register one on-chain hypothesis and its exact metrics,
   asset/contract mappings, chain IDs, block ranges, and information-availability
   policy. Select a free source only after verifying current limits and terms.
   Pin block identity and handle reorganizations before freezing the dataset.
3. Both tracks enter registered out-of-sample research first. They do not change
   operational strategy defaults as a consequence of an acquisition experiment.

Neither alternative-data adapter is implemented by this phase. Reddit, paid X
feeds, audio corpora, desktop screens, and cross-venue strategy comparisons remain
outside this acquisition work.

The first live result, including coverage, hashes, and the Coinbase access failure,
is recorded in [market-acquisition-2026-10-03.md](market-acquisition-2026-10-03.md).
