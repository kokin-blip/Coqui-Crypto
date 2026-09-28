# Wider Coinbase / Alpaca universe — September 26, 2026

## Boundary and selection rule

This is a research and shadow-only addition. The existing BTC/ETH/LTC TrendVol
wrapper, persistent anchor, ML shadow experiment, execution-policy registration,
and Alpaca order/reconciliation authority remain intact. No new-asset order path
or strategy promotion was enabled. Range rotation and the three-strategy selector
receive a reusable dynamic-input seam; their strategies are not implemented here.

The versioned [policy](wider-universe-policy-v1.json) selects from the complete
Coinbase USD spot catalog intersected with the connected paper account's Alpaca
crypto catalog. Matching records bind canonical Coinbase product identity to an
Alpaca asset ID and exact USD pair. Duplicate/ambiguous identities fail closed;
owner verification of underlying assets and renamed tokens remains required
before execution. This is a rule-driven universe, not a new fixed coin list.

Eligibility requires 180 consecutive completed, reported Coinbase daily OHLCV
bars; online/tradable market-order states; current non-auction, non-disabled
Coinbase product metadata; positive quantity/quote/price increments; and an
unblocked, correctly bound USD paper account. Native minimum sizes, including
Coinbase's base and quote minimum, must round to at most $25. Observed candle age
is a lower bound on product age, not an invented listing date. Duplicate bars,
gaps, incomplete/invalid candles and insufficient age have explicit evidence.
Hourly readiness is reported separately as `not_collected` for this new universe.

Both venues require independently timestamped quotes/books no older than 60
seconds, with no future timestamps, and a spread at most 50 bp. Each side's
displayed depth within 50 bp of midpoint must support 10× proposed notional.
Discovery uses a $25 probe; hypothetical orders recheck their actual size and
retain a computed maximum supported notional. Coinbase liquidity never stands
in for Alpaca execution liquidity. Quote/book disagreements, crossed books,
missing rules and unavailable endpoints cannot become permissive defaults.

Sources: [Alpaca crypto assets, quantities, books and fees](https://docs.alpaca.markets/us/docs/crypto-trading),
[Coinbase product metadata](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product).

## Point-in-time data and shadow operation

Complete joint catalogs are captured daily. A catalog observed on UTC day D can
establish membership only on D+1; there is no backward application or carry
across missed days. Each execution frame is bound back to that exact immutable
catalog, including every excluded product. Current rules, account status and
market evidence are recorded at the frame, not inferred from a later catalog.
Newly listed assets therefore cannot silently join earlier history.

Migration 80 adds profile-scoped, append-only evidence. Policies, studies,
catalogs, individual observations, complete frames, failures and shadow decisions
have canonical hashes and immutable keys. Backups preserve the records; profile
duplication copies only policy, removing account evidence, study state and shadow
history. No credentials or execution qualification are copied.

The main-process collector runs after the existing authoritative paper pass.
It acquires at most four supported assets' histories per pass, resumes from
durable per-slot records, and refreshes the full cross-section's market evidence
before a shadow decision. Reads are scoped to the current slot rather than
reparsing the whole historical ledger. Finished slots do not repeatedly query
credentials or providers. A stopped experiment stops collection. Collection
failure cannot pause or modify the operational TrendVol target.

Shadow records contain baseline/proposed targets, eligibility evidence, input
hashes, hypothetical decimal quantities, rejected orders, and an explicit
`executionEnabled: false`. Quote expiry, unknown holdings, unavailable portfolio
evidence or missing baseline history produce a blocked shadow record, not an
order. Functional readiness and historical qualification remain separate from
submission authority, with no automatic promotion.

The dynamic dataset retains the requested six-slot UTC calendar, canonical
identities and histories. Missing slots or unverifiable catalog bindings are
not silently intersected away. Zero eligible assets produce cash targets when
baseline context is available. Excluded holdings remain in modeled portfolios
until an evidenced executable exit; dust and blocked exits remain recorded.
Missing held-asset valuation invalidates the comparison rather than inventing
a liquidation or carrying an unmarked position at zero.

## Registered research comparison

The host freezes a separate study on first collection for each policy hash,
starting the next UTC day: 60 development days followed by 90 untouched holdout
days. Dates never roll forward to hide missing coverage. The existing execution
study and its holdout are not modified. The registration binds the installed
implementation hash, anchor, policy, candidates, shared costs and guardrails.
Changed implementation content blocks evaluation against the old registration.

The three declared candidates are unchanged three-coin TrendVol, equal-base-weight
TrendVol across eligible assets, and a stricter variant with at most 25 bp spread
and at least 20× depth. All use the same original BTC/ETH/LTC market-state series,
anchor and signal parameters. Targets use completed daily bars and are held
through that day's four-hour slots. Universe eligibility and execution feasibility
are checked separately at each slot. Strategies do not normalize over an
arbitrarily shortened survivor calendar.

Matched replay uses identical starting cash, execution slots, 5% daily/1%
intraday drift, venue quantity minima/increments, $25 trade floor, and the same
frozen auto-trade guardrails. All candidates face 25 bp modeled taker fees,
observed half-spread and 15 bp adverse slippage, and the same doubled-cost
scenario. Buy fees reduce received crypto; sell fees reduce received USD.
The operational local Coinbase simulator retains its separate 60 bp fee model;
its displayed returns are not treated as matched Alpaca evidence.

Outputs include calendar/asset coverage, exclusions, membership changes,
turnover, modeled costs, net returns, drawdown, maximum asset weight,
concentration index, effective asset count and cash exposure, with paired
net-return differences. Synthetic comparisons test accounting and timing only.
Reported depth constrains size but does not prove fills, queue priority, latency
or partial-fill behavior. No simulated result is represented as a broker fill.

## Commands and remaining checks

### Connected observations and verification

The September 26 read-only connected audit found 488 Coinbase USD products,
73 Alpaca crypto products across quotes, and 34 exact USD matches. The other
454 products failed the Alpaca intersection. All 34 matches had 180 consecutive
completed daily candles. Evidenced age was at least 399 days for 33 products and
234 days for HYPE; this does not establish their original listing dates.

Thirteen matches passed the other current-market checks in this sampled audit.
Failures included 15 stale Alpaca observations, nine excessive Alpaca spreads,
three insufficient Alpaca depths, and one Coinbase book inconsistency/depth
failure (reasons overlap). These are timestamped observations, not a recommended
coin list. Every match failed prior-day catalog eligibility: today's accessible
products and candles cannot establish historical account access or liquidity.

The [machine-readable coverage report](wider-universe-coverage-2026-09-26.json)
records reasons and measured checks for all 488 assets, policy/cost/mapping/data
hashes, installed-source and dirty-tree provenance, and content-addressed local
evidence paths. Full normalized observations are retained under the ignored
`data/wider-universe-audits/` directory. A later full-catalog supplement has the
same mapping hash but a different catalog hash; it is explicitly a separate
observation and is not substituted for the earlier catalog.

The installed owner database was opened read-only and was not migrated. It has
zero wider-universe catalog days, complete frames, observations or shadow
records. No prospective study is registered there yet; registration and fixed
development/holdout dates occur when the verified build is deployed and its
collector first runs. Study, membership-timeline and matched-dataset hashes are
therefore unavailable, rather than hashes of invented historical evidence.

| Comparison output | Connected evidence result |
| --- | --- |
| Historical eligible asset-days / execution slots | 0 / 0 recorded |
| Baseline, wider and stricter-liquidity matched returns | Unavailable |
| Base-cost and doubled-cost paired differences | Unavailable |
| Historical concentration, turnover and drawdown | Unavailable |
| New-asset execution qualification | Disabled; not promoted |

`pnpm verify` passed after implementation: 214 test files and 1,355 tests, plus
lint, type checking and build. Fixtures exercise dynamic cardinalities,
membership changes, temporal leakage, missing evidence, decimal boundaries,
liquidity, dust/blocked exits, cost comparisons, holdout isolation, immutable
storage and resumable shadow collection. Existing baseline and reconciliation
checks also pass. The synthetic complete-period comparison verifies accounting;
it does not supply evidence of improved investment performance. Connected
catalog/quote/book access was observed; connected new-product order behavior
was not exercised. No orders were sent by these audits.

After building, run a read-only stored-evidence report:

```sh
pnpm research:universe-report --database=/absolute/path/to/coqui.db --profile=main
```

Development reporting excludes holdout frames at the SQL read boundary. Explicit
`--phase=holdout` cannot evaluate before the fixed holdout end. Missing or changed
evidence returns unavailable results, not zero returns. The report reads existing
databases without migrating them and records both Git revision and dirty-source
content hashes.

To inspect today's connected catalogs and market data without starting a scheduler:

```sh
pnpm research:universe-audit --database=/absolute/path/to/coqui.db --profile=main --output=/absolute/path/to/new-audit.json
```

This command runs in Electron main, opens the database read-only, refuses
credential mutations, never sends orders, and writes a new report without
overwriting an existing file. Its current inventory is not historical membership
and does not register or open a holdout.

Configuration is explicit and versioned:

```sh
pnpm research:universe-config --database=/absolute/path/to/coqui.db --policy=/absolute/path/to/policy.json
```

Use the published JSON schema example and a new version for changed thresholds.
Configuration permits stricter rules and 180–400 history days, not weakening the
agreed eligibility floors. This command writes configuration and applies normal
forward migrations: deploy the compatible build before using it on an older
installation's database. It never enables new-asset execution. Policy changes
receive a new hash and prospective registration; they do not rewrite old studies.

Owner checks remaining: deploy the verified source; inspect the first daily
catalog, prospective registration, fixed dates and complete frames; verify
exact asset mappings, account access and metadata precision; retain the host
during all six observation windows; inspect disk growth from retained immutable
histories; independently verify partial fills, rejection/unknown recovery and
fee denomination before any later new-product execution integration. Existing
broker reconciliation tests do not attest untested products. No limit fills,
hourly strategy readiness, market-state selector or performance improvement is
claimed by this change.
