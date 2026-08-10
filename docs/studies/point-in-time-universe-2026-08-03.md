# Point-in-time Coinbase universe — 2026-08-03

## Outcome

N3 is implemented as forward observation, not historical guesswork. The command

```text
pnpm universe:snapshot -- --database=data/coqui.sqlite
```

fetches the complete public Coinbase `/products` response, strictly validates
every USD product row, normalizes it to canonical Coinbase spot identity, and
stores one immutable content-addressed snapshot. It records product status,
trading-disabled/cancel-only/limit-only/post-only flags, and available base,
quote, and minimum-market increments.

## Temporal policy

A snapshot observed during UTC day D becomes effective on UTC day D+1. This
prevents a status learned later in the day from affecting an earlier decision.
Strict research timelines require a snapshot effective on every requested day:

- observations never apply backward;
- missing daily observations are uncovered rather than carried forward;
- products absent from a successful full response are ineligible for that
  effective day;
- unknown trading flags are ineligible rather than assumed permissive; and
- delisting affects only days after it was observed.

Consequently, snapshots collected now do not repair survivorship bias in older
backtests. Historical periods remain unavailable for cross-sectional universe
research until trustworthy archived Coinbase product observations are imported.
This is intentional: using today's product list over old bars would preserve the
bias while merely giving it a new table name.

CoinGecko, CoinMarketCap, and CoinPaprika may supply contemporaneous reference
features after explicit canonical mapping. They do not establish whether a
product was tradeable on Coinbase.

## Dataset binding

`bindPointInTimeUniverse` joins a completed decision dataset to exact daily
snapshots. Any uncovered dataset day fails closed. A successful binding exposes
eligible requested assets by day and a `decisionContextHash` derived from both
the market dataset hash and universe timeline hash. Rotation research must use
this bound context when it is re-derived in Phase 3.

## Verification

Tests cover temporal leakage, daily coverage gaps, unknown rules, delisting,
canonical ordering, stable hashes, exact retry idempotency, SQLite tamper
detection, failed-capture atomicity, and dataset binding. A live in-memory smoke
test succeeded on 2026-08-03, capturing 482 Coinbase USD product observations;
because the capture occurred after UTC midnight, it correctly became effective
on 2026-08-05.
