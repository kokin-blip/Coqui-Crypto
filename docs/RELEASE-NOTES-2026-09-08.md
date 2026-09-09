# Coqui product completion release — 2026-09-08

This release completes the product-facing train through schema 75. Live order
submission remains compile-time unreachable.

## What changed

- Connected Coinbase and read-only Robinhood Crypto balances now feed immutable
  connection snapshots and the authoritative unified current portfolio. Tax lots
  remain separate accounting evidence and are never double-counted.
- Overview shows connected allocation and held-asset completed-bar performance.
  Markets derives a read-only portfolio watchlist while preserving custom lists.
- Multi-connection paper campaigns use per-connection simulated books,
  deterministic venue selection, exact-next-open settlement, assumption binding,
  and fenced host authority.
- One immutable decision/evidence identity now connects Activity, asset-specific
  chart markers, no-trade details, routes, fills, recovery, and “Ask Coqui why.”
- The shared host drains bounded research workers, persists trigger-to-job links,
  and applies deterministic blockers. Candidate approval, rejection, and rollback
  remain explicit human actions with append-only notes.
- Advisor uses allowlisted stored evidence, deterministic offline explanations,
  provider fallback, and typed navigation without privileged authority.
- Events accept validated local fixtures only, respect first-known/classified
  times, and can request research while remaining unable to influence execution.
- Research, lineage, risk, market-quality, routing, execution, and the restrained
  six-subsystem Operations workspace render persisted evidence and truthful
  unavailable states.

## Data and compatibility

Migrations 71–75 add v2 connections and portfolios, per-connection paper books,
asset evidence links, and research review links. Existing evidence is not reset,
reseeded, deleted, backfilled, or reinterpreted.

For one release, v1 connections, `portfolio.view`, v1 paper campaigns, and
`accounts.coinbase.*` remain readable. V1 connection identities are linked
deterministically to v2, and linked keychain entries migrate with
write–verify–remove ordering. Deprecated IPC use records only its channel name;
payloads are never telemetry. Removal is deferred to a separate explicit release.

## Safety boundaries and deferred work

Robinhood is authenticated read-only and has no real order-placement export.
Coinbase completed daily bars remain the only operational strategy history;
Robinhood quotes are current valuation evidence. Paper routing is simulated.

Direct strategy refinement, automated champion approval, live orders, Event
Alpha trading, external event feeds, additional exchanges, network-accessible
remote hosting, voice/TTS, and guided tours remain deferred.

## Verification record

The release gate is `pnpm verify`, the focused migration and secret-leak suites,
and the production-renderer smoke test. Final test totals and smoke schema are
recorded in the phase commit handoff rather than copied into this document where
they could become stale after later test additions.
