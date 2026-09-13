# Exploratory paper mode — observation protocol

**Registered:** 2026-09-12
**Status:** OPERATIONAL OBSERVATION ONLY
**Strategy:** `trendvol-exploratory-paper-v1`

## Purpose

This mode lets the owner observe the shipped, unvalidated TrendVol composition in
an unattended simulator without inventing a historical edge. It is not a study
that can validate the strategy, not a parameter search, and not evidence for live
execution. Its records are permanently ineligible for validation, candidate
promotion, and champion selection.

## Admission and safety

Starting requires an explicit campaign confirmation and one complete, nonempty
connected-portfolio snapshot. Missing validated edge is recorded as unavailable;
an available profitability assessment that fails is recorded as `would_refuse`.
Those two admission results are observational in this mode. The global paper-off
policy, kill switch, hard stops, guardrails, completed-bar freshness, fresh rules,
reconciliation, execution fencing, idempotency, nonnegative balances, and exact
next-open settlement remain enforced.

## Portfolio protocol

The opening connected quantities are copied once. Known USD is copied; absent cash
is zero with `unknown_assumed_zero` provenance. Imported accounting lots are not
used. Assets with a Coinbase USD reference instrument, fresh rules, and the
required 121 aligned completed daily bars enter the managed sleeve. All other
copied assets remain visible and unmanaged. Opening managed weights never adapt,
and later changes in connected accounts are a separate reference only.

## Timing and reporting

A decision uses completed bar N and may submit only for N+1. Settlement waits for
that exact bar to complete and uses its recorded open. A missing exact interval
expires the order; an incomplete interval remains pending. Observations begin only
after campaign start and are never backfilled.

The product reports paper return from opening, the opening buy-and-hold benchmark,
relative performance, accumulated modeled costs, recorded-equity drawdown, and
submitted/filled/pending/expired/refused/no-trade counts. Missing valuations remain
missing. These measurements describe simulator behavior and confer no execution or
research authority.
