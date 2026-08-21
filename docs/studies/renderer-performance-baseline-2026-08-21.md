# Renderer performance baseline — 2026-08-21

## Outcome

The P5 performance harness exists and passes, including its own sensitivity
control. Baseline against the production build:

| Measure | Value | Budget | |
|---|---:|---:|---|
| warm useful shell | 128.0 ms | 1500 ms | ok |
| interaction p50 | 8.3 ms | — | |
| **interaction p75** | **8.4 ms** | **200 ms** | ok |
| interaction p95 | 9.9 ms | — | |

Reference machine: `darwin/arm64`, Electron 43.4.1, production Vite build
(227.19 kB raw / 70.95 kB gzip renderer bundle). Numbers are from a shell with
one channel read, not from finished screens — this is the floor, and Stage 4
will move it.

`docs/UI-UX.md` §5 requires the harness to exist **before feature polish**, which
is why it is recorded now rather than after the scoreboard.

## The control matters more than the baseline

§7.4 requires that a deliberately injected renderer-blocking regression *fails*
the harness. A performance test that only ever passes proves nothing about its
own sensitivity, so every run measures a known-bad build alongside the real one:
a 250 ms synthetic long task scheduled against each interaction.

```
control: 250ms synthetic long task before each interaction
interaction p75               250.3ms   budget 200ms  OVER
control breached the budget as required — harness is sensitive
```

If the control ever comes in under budget the harness fails, regardless of how
good the baseline looks.

## A flaw the control caught immediately

The first working version measured from interaction start to the resolved IPC
promise. It reported **p75 of 0.2 ms** — and the control also reported 0.3 ms
and passed, which failed the sensitivity check and exposed the flaw.

Two things were wrong with measuring the promise. It measures the transport
rather than what the user perceives: a response that has arrived but cannot
paint because the main thread is busy is not fast. And it made the harness blind
to exactly the regression class it exists to catch, since main-thread contention
does not delay a promise that has already resolved.

Latency is now measured from interaction start to the **next painted frame**, via
`requestAnimationFrame` after the response. That moved the honest baseline from
0.2 ms to 8.4 ms and made the control breach correctly at 250.3 ms.

The lesson generalises: the sensitivity control is not ceremony. It found a real
defect in the measurement on its first run.

## What this does not cover

- **Charts.** `lightweight-charts` is installed but nothing renders one yet, so
  the "responsive while panning, zooming, changing range" gate in §7.5 is
  untested. It needs re-running once the evidence panel exists.
- **Representative datasets.** The scoreboard reads ten study runs and twenty
  jobs. §7.4 asks for representative chart and table volumes, which do not exist
  until Stage 4.
- **Other machines.** One reference machine is recorded. CI now runs the harness
  on macOS, Windows and Linux, but the budgets were set against this one.
- **CPU and heap.** §5 also names those; only latency and warm shell are
  instrumented so far.

## Reproduce

```
pnpm perf
```

Builds production artifacts, then runs the baseline and control passes in a real
Electron process against the real composition root and dispatcher.
