# Coinbase study acquisition — 2026-08-09

## Outcome

The approved equal-weight research universe is `BTC-USD`, `ETH-USD`, and
`LTC-USD`. Public Coinbase Exchange REST candle pages were acquired without an
API key for the requested interval 2012-01-01 through 2026-08-08 inclusive.

The source returned:

| Product | Reported daily records | Acquisition manifest hash |
|---|---:|---|
| `BTC-USD` | 4,038 | `6707cdb3140928aa9c43185603bf7b062690d290728ae5cd3b26b4c299b47ce3` |
| `ETH-USD` | 3,733 | `e7895cfa0ee413079ed4bb800c5c1b00cd8534073e829d99ddf80c95c6729e09` |
| `LTC-USD` | 3,643 | `60a9103b8c573ca5a6026cc6743e09c62f130ab00745a8ec715fc60d440aa33a` |

The deterministic longest shared gap-free interval begins 2016-08-21 and ends
at the exclusive boundary 2026-08-09: 3,640 daily bars per asset. The prepared
manifest hash is
`668be06c3dcd6a741e88a2cd865f4ab7ffa52397f81e7b63dda8ba3d98438a60`;
the decision-dataset hash is
`d56276d736716bc8796be1c6a1c13a458933f5f5b52de262a0943b83890543f5`.

## Acquisition control

`pnpm archive:coinbase` requests explicit 300-day UTC windows through the
shared rate-limited HTTP boundary. It parses the restricted candle-array JSON
grammar without converting provider decimal tokens through binary floating
point, preserves the exact response text, and binds every page hash, byte count,
request boundary, and retained-record count into an immutable manifest.

The command then writes exact-decimal N7 Parquet archives, verifies their bytes,
schema, rows, and semantic hashes through DuckDB, computes the longest common
continuous run, and creates the immutable multi-asset preparation manifest.
Malformed pages, conflicting intervals, incomplete final boundaries, raw
artifact tampering, Parquet tampering, mixed providers, duplicates, and gaps all
fail closed.

Local raw and Parquet data live under ignored `data/` and total roughly 1.1 MB
for this acquisition. No `.env` file, exchange account, or provider credential
was used.

## Remaining pre-registration decisions

No strategy candidate or holdout result has been evaluated. Before registration:

1. freeze one chronological development/holdout split inside the verified
   2016-08-21 through 2026-08-09 coverage;
2. create a stable repository revision—the repository currently has no commit;
3. prepare the dataset under that stable code revision if required; and
4. register the exact 16-candidate plan once.

The acquisition parser label `working-tree-acquisition-v1-2026-08-09` identifies
the code used to normalize the raw responses. It is not a substitute for the
stable application revision required by the final registered study.
