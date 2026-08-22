# Study — forward paper run against live Coinbase bars

**Registered:** 2026-08-22
**Status:** REGISTERED, NOT YET RUN
**Owner decision it implements:** "Both — simulated in CI, then a real run"

## Why this exists separately from the CI harness

`tests/paper-seven-day-run.test.ts` drives seven days with a stepped clock in
milliseconds. It proves the *mechanism*: one completed decision per day, a
complete journal, a replayed slot changing nothing, recovery across a restart,
and a reconciliation harness that quantifies a divergence in basis points.

What it cannot prove is that the mechanism survives contact with a real venue —
bars arriving late, a provider restating yesterday, the machine asleep at the
UTC boundary, a rate limit at exactly the wrong minute. Those are the failures
that make a backtest dishonest in practice, and only wall-clock time finds them.

This study is registered **before** the run so that its success criteria cannot
be chosen after seeing the result. That is the same discipline invariant 7
applies to parameter searches, applied to an operational claim.

## Precondition — currently unmet

The profitability gate weighs estimated cost against a **registered** per-trade
net-edge estimate. No study in this repository has registered one for the shipped
strategy, whose own version string is `trendvol-legacy-unvalidated`, so
`paper.net_edge_estimate_pct` defaults to zero, every intent is refused, and
every run stands down as `gates_refused`.

A run under that default is still worth something — it exercises cadence,
recovery, journalling and the observed-day counter — but it produces **no fills**
and therefore cannot exercise the OMS or the reconciliation harness against live
data. Two options, and the choice belongs to the owner:

1. **Run it as-is.** Records seven honest days of stand-down. Proves scheduling
   and recovery. Leaves fills and reconciliation unproven against live data.
2. **Register an estimate first.** Requires a pre-registered study that derives a
   per-trade net edge from the holdout window, with its trial count reaching the
   deflated-Sharpe calculation. That is a research task, not a configuration
   change, and it is the honest route to a run that fills.

Setting the value without a study behind it would be exactly the false
confidence invariant 4 exists to prevent, and this document exists partly to make
that temptation visible.

## Protocol

| | |
|---|---|
| Duration | 7 consecutive UTC days, minimum |
| Cadence | Daily, `86_400_000` ms, offset 0 — the scheduler's own UTC boundaries |
| Venue | Coinbase public `/products` and daily candles; no key required |
| Machine | The owner's Mac, ordinary use, sleeping overnight |
| Recording | `wallet_decision_runs`, `wallet_execution_journal`, `paper_orders_v3`, `paper_fills_v3`, `runtime_incidents` |

Start the app and leave it. No intervention; an intervention ends the run and it
restarts.

## What will be reported, whatever it says

- Observed days versus elapsed days, and the gap explained. A machine asleep
  across a boundary should show as a missed slot picked up on wake, not as a
  silently skipped day.
- Every stand-down, with its reason code.
- Reconciliation: fill count, aligned / diverged / unverifiable, and the signed
  mean and worst price divergence in basis points.
- Every `runtime_incidents` row raised during the window.
- Any crash, and what recovery classified afterwards — particularly whether
  anything landed in `unknown`.

## Pre-registered success criteria

1. Observed days equal the days the app was running, with each discrepancy
   attributable to a recorded cause.
2. No decision run in a non-terminal state at the end of the window.
3. No order left in `unknown` after recovery, or, if one is, an explanation of
   what the venue said that made it ambiguous.
4. If fills occur: the reconciliation harness reports a *quantified* divergence,
   whatever its magnitude. A harness that reports nothing has not been exercised.
5. The kill switch, engaged mid-run, halts paper from both halt sources.

## What would count as a failure worth recording

A negative result here is a result. If the scheduler misses boundaries after
sleep, if bars arrive too late for a UTC-midnight decision, or if divergence
against live data exceeds the severe threshold, that belongs in this document
and in the negative-findings ledger — not in a fix that quietly makes the number
look better.
