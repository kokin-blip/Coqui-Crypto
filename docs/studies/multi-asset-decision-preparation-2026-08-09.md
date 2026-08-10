# Multi-asset decision-dataset preparation — 2026-08-09

## Decision

The P3 replacement study must consume one exact, verified Coinbase decision
dataset. It may not merge aggregate-provider prices into venue prices or silently
intersect away missing days.

`prepareDecisionDatasetFromArchives` and
`pnpm research:prepare-dataset` implement that boundary. They read immutable N7
Parquet archives, verify their manifests, schema, row counts, byte hashes, and
semantic dataset hashes, then select an explicit Coinbase spot instrument list
and UTC interval. Preparation fails if it encounters:

- a non-Coinbase venue or price source;
- incomplete, synthetic, or legacy close-only bars;
- two records for the same product and UTC day;
- a missing day for any requested product;
- coverage that begins or ends outside the requested boundaries; or
- a source or prepared manifest that fails content verification.

CoinGecko, CoinMarketCap, and CoinPaprika remain useful for market cap, supply,
rank, and cross-provider diagnostics. Their cross-venue prices cannot enter this
dataset because the backtest must use the price series on which Coinbase fills
are modeled.

## Immutable output

Successful preparation writes:

```text
<output-root>/prepared-decision-datasets/<manifest-hash>/manifest.json
```

The manifest binds the exact decision-dataset hash, code revision, ordered
instrument identities, requested boundaries, generated-at time, aligned day
count, required quality, and every source archive's dataset hash, manifest hash,
and code revision. Repeating the same preparation in a different source-directory
order returns the same manifest and directory. A modified manifest or directory
name fails verification.

The CLI reports identifiers, boundaries, and counts only. It does not use
provider keys and does not print market rows or caught payloads on failure.

## Command

```text
pnpm research:prepare-dataset -- \
  --archives=data/archive-a/datasets/<hash>,data/archive-b/datasets/<hash> \
  --products=BTC-USD,ETH-USD \
  --start=2020-01-01 \
  --end-exclusive=2024-01-01 \
  --code-revision=<git-commit-or-build-id> \
  --output-root=data/research-archive
```

Dates are inclusive start and exclusive end at UTC midnight. Product order and
source-directory order do not change the result.

## Current status and next control

The reusable preparation boundary is implemented and tested. Later on
2026-08-09, the owner selected equal-weight `BTC-USD`, `ETH-USD`, and `LTC-USD`.
The Coinbase acquisition command produced a 3,640-day shared continuous span
from 2016-08-21 through 2026-08-08 inclusive and decision-dataset hash
`d56276d736716bc8796be1c6a1c13a458933f5f5b52de262a0943b83890543f5`.

The split was later frozen at 2022-01-01, application revision `037927e` was
committed, and the registered holdout was executed once. See
`docs/studies/trendvol-replacement-v1-2026-08-09.md` for the negative result.
