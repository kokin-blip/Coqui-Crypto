# Market acquisition — 2026-10-03

The live acquisition completed Binance and Kraken BTC/ETH archive verification.
The overall run is **incomplete** because the official Coinbase Market Data Terms
page returned a Cloudflare HTTP 403 challenge. No Coinbase dataset was published
without that provenance snapshot.

```sh
pnpm archive:market -- --config=config/market-acquisition.json \
  --code-revision=market-foundation-v1-working-tree
```

The code revision is an explicit uncommitted working-tree label, not a claim
that these results came from a clean Git commit. Raw data remains local and ignored.

| Venue | Product | Rows | First observation | Observed end, exclusive |
|---|---|---:|---|---|
| binance | BTCUSDT | 3334 | 2017-08-17 | 2026-10-03 |
| binance | ETHUSDT | 3334 | 2017-08-17 | 2026-10-03 |
| coinbase | BTC-USD | 0 | — | — |
| coinbase | ETH-USD | 0 | — | — |
| kraken | XBTUSD | 4639 | 2013-10-06 | 2026-07-01 |
| kraken | ETHUSD | 3975 | 2015-08-07 | 2026-07-01 |

## Verified identities and hashes

### binance BTCUSDT

- Dataset: `9f36801872148fc14eaac4ba8e3aaed896b6c8c97d9b9e6bb74551bb29f81c0b`
- Manifest: `35249ada6a446e03d777c55a8febc2c3a103668aeffbd22bae901a297bac4dec`
- Contributing acquisition envelopes: 141.

### binance ETHUSDT

- Dataset: `017d877a893d9f31dd91b60b5158cccbfef765a3ee68701e27dfeb7281f68370`
- Manifest: `e0633fa66683c4a9addeb6e5b189e54528b7485137a4577878d44ee08586ec28`
- Contributing acquisition envelopes: 141.

### kraken XBTUSD

- Dataset: `58fa1bead01ab7f3b0fd4e7da71c37fccb24c0d5a532d602e183b29653681b2b`
- Manifest: `07f80340380182dc7d14fbe16cc57c5c2c96364ee51596cc68db0459b37c0ee2`
- Contributing acquisition envelopes: 1.

### kraken ETHUSD

- Dataset: `e0daf1ebeed234c173e809ce332334d8c7b65471267401bf349513c73b796e5f`
- Manifest: `3af6787be8fd668af60db3bedc8f82f932487e298d325c50bfca1a276b822177`
- Contributing acquisition envelopes: 1.

## Coverage and integrity

Binance retains USDT quotes; Coinbase and Kraken mappings retain USD quotes.
No venue histories were blended and no missing bars were manufactured. Binance
monthly downloads and daily fallbacks matched their published checksums, and a
resume reverified cached artifacts and reproduced both Binance dataset hashes.

Kraken preserves five verified multipart files totaling approximately 8.4 GiB.
Their concatenation matched the published full-archive SHA-256:
`fc81b54cba6e12af3e9422dde9416179e6ef76af4831d48d839fbdb43018eaa4`.
The daily CSVs were extracted with bounded memory without another assembled copy.
Its published release ends June 30, 2026; later dates are unavailable release
coverage rather than zero-trade candles. A historical scientific-notation volume
was expanded exactly into decimal text, with a regression test.

Missingness ranges, unavailable archive paths, and source-envelope paths are in
the local JSON report. The failed Coinbase terms source is
`https://www.coinbase.com/legal/market_data`; the corresponding 403 failure is
recorded for both configured Coinbase products.

## Local report

- JSON: `/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/data/market-acquisition-reports/1ded0ea82ccd82234dda1025307babc9fa6f5540eb05c6929d567d4b67911f93/report.json`
- Markdown: `/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/data/market-acquisition-reports/1ded0ea82ccd82234dda1025307babc9fa6f5540eb05c6929d567d4b67911f93/report.md`
- Report hash: `ff6154543a9959464194def56cd757daeeeaab2cb430fc86440679ecaeba5bbf`

Rerun the command when the official Coinbase provenance page is accessible.
Verified exchange artifacts are retained for resume; no raw archive needs to be
replaced to complete the missing provider.
