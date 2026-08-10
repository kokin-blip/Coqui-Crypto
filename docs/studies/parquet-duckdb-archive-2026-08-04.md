# Parquet and DuckDB archive — 2026-08-04

## Outcome

N7 is implemented as a research-only immutable archive in `packages/storage`.
One command exports an explicit cached venue instrument and binds it to the N8
raw-source manifest that produced those rows:

```text
pnpm archive:parquet -- --venue=kraken --product=XBTUSD --source=kraken \
  --source-manifest=data/archive/kraken/.../Kraken_OHLCVT.zip.manifest.json \
  --code-revision=<commit-or-explicit-working-tree-label>
```

The code revision is required rather than guessed. This repository currently
has no Git commit, so silently recording `HEAD` would create false provenance.

## Dataset contract

Dataset directories are addressed by a semantic SHA-256 and contain one JSON
manifest plus Parquet files partitioned by venue, provider product ID, product
type, interval, and UTC year. Schema v1 stores provider OHLCV values as strings.
That is deliberate: DuckDB can cast them for a specific analysis, while the
archive itself never loses precision through a JavaScript `number` or an
undersized fixed decimal type.

The semantic dataset hash covers:

- the ordered canonical rows and archive-schema hash;
- source-manifest and raw-archive SHA-256 values;
- the explicit code revision;
- the Node and DuckDB versions.

The manifest additionally records creation time, partition paths, byte sizes,
row counts, and each Parquet file's SHA-256. Creation time is excluded from the
semantic hash, so exporting identical evidence resolves to the existing
immutable dataset and retains its original manifest.

## Verification and query boundary

No analytical query returns rows until Coqui has checked the manifest hash,
dataset-directory name, current schema hash, every Parquet file's hash and size,
partition row-count total, exact Parquet columns, decoded row validity, and the
re-derived semantic dataset hash. Filters are then applied by a fresh in-memory
DuckDB instance. Parquet is never treated as an operational database.

DuckDB's official documentation supports both `COPY ... FORMAT parquet` writes
and projection/filter pushdown through `read_parquet`. The official Node API is
a primary supported client and provides lossless DuckDB value access:

- [DuckDB Parquet overview](https://duckdb.org/docs/stable/data/parquet/overview)
- [DuckDB client support tiers](https://duckdb.org/docs/stable/clients/overview)
- [Official Node API package](https://www.npmjs.com/package/@duckdb/node-api)

## Dependency and verification

`@duckdb/node-api` is pinned exactly at 1.5.5-r.3. The production dependency
audit reported no known vulnerabilities on 2026-08-04. Because it includes
native bindings, the CI native-dependency matrix loads DuckDB and runs an
in-memory query on Windows, macOS, and Linux. Phase 5 must repeat this check in
the packaged Electron runtime.

Tests prove year partitioning, exact-decimal round trips, filtered DuckDB reads,
content-addressed idempotency, mandatory provenance, duplicate rejection, and
failure before query when a Parquet byte changes.
