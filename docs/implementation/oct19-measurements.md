# October 19 measurements

Source `b14da3de77df16821d6042d4c446620bc2af1de5`; source hash `da161324d68a65c1d140ef0a05e493172cb805bcec9f7a675726eac8ccb5ad65`. Apple M4 Pro, 12 logical CPUs, 24 GiB RAM, macOS 26.6.1, Electron 43.4.1. All feeds here are synthetic; no actual account, provider or Main migration was used.

## Fresh-process startup and interactions

Five processes each use a fresh disposable Chromium/browser/session directory and generated schema-94 DB. OS file caches are not forcibly flushed. Each loads 2,000 bars and performs twelve navigation cycles, forty real IPC reads and 120 native pointer-to-paint samples. These are fresh-process measurements, not a rebooted/cold-disk certification. Pointer-to-paint uses native input dispatch followed by two animation frames; it is a reproducible proxy rather than a hardware photon timestamp.

| Run | Spawn to useful chart ms | Chart stage ms | Navigation p75 ms | IPC p95 ms | Pointer-to-paint p95 ms | First command menu ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1125 | 370 | 15 | 0.30 | 18 | 351 |
| 2 | 985 | 385 | 16 | 0.40 | 19 | 345 |
| 3 | 993 | 382 | 17 | 0.60 | 19 | 344 |
| 4 | 961 | 363 | 17 | 0.30 | 18 | 347 |
| 5 | 996 | 381 | 16 | 0.20 | 18 | 345 |

Median spawn-to-useful-chart: **993 ms**. All five existing benchmark gates pass. Main event-loop sampling has a 20 ms resolution; its baseline floor must not be interpreted as 20 ms of extra IPC latency. Per-run p95/max, heap and native process memory are retained in `evidence/oct19/performance/cold-*.json`.

## Startup confound and targeted repair

The inherited harness isolated application DBs but shared Electron browser storage. Five preliminary chart waits were approximately 4.4 seconds. A renderer CPU profile attributed about 4,049 ms to the first `sessionStorage.getItem` in advisor-navigation. A controlled run with a disposable browser/session directory measured a 394 ms chart stage and about 12 ms in that same function. The supported fix isolates browser data in the benchmark. It is not evidence that an actual Main-profile stall is repaired; source/workload identities differ and actual live-data traces remain an open gate. Raw profiles and both harnesses are retained in `performance-shared-browser-data/`.

## Ionic first-open cost

The final-source trace measured **339 ms** to visible command content (including overlay/rendering), with the approximately 1.07 MB Ionic chunk requested on first open.
- Chromium file-load interval: 1.538 ms; encoded bytes: 1067534.
- v8.parseOnBackground: 7.538 ms.
- v8.compileModule: 0.009 ms.
- Dynamic module-graph evaluation event: 10.399 ms (no individual-script attribution in this event).

Events may nest or execute on background threads; do not add their durations as exclusive main-thread blocking. Resource Timing entries for file URLs were absent, so loading evidence uses CDP Network events instead. Cold-run aggregate ScriptDuration and first-menu timing are recorded separately. This evidence supports measuring overlay/module work, not replacing Ionic or changing budgets from chunk size alone.

## Full-suite output diagnosis

After the explicit standard reporter fix, the final suite passed **271 files / 1,815 tests** in 158.56 seconds. Final run timing: 2.99 s transformation, 41.66 s accumulated imports, 100.93 s tests; these phases overlap and do not sum to wall time. The first completed-file line arrived at 26.342 s, after the long wider-universe case; fixed HEAD is verified at both ends. On the preceding 270-file source, timed standard reporting produced its first completed-file output after 2.367 s (receipt retained under source-0202177/).

A separate `vitest list --json --maxWorkers=1` discovery/import/collection probe completed in **56.42 seconds** without executing test bodies. Its inventory and timing receipt are retained; it is a separate run with cache/process overhead, not an additive phase of the full test run. The probe overlaps approximately minute 10 of the retention workload.

Before the fix, an auto-selected reporter run passed 270 files / 1,814 tests in about 167.66 seconds, but emitted no completed-file progress. Installed Vitest source selects `isAgent ? 'agent' : 'default'` when no reporter is specified; its AgentReporter is MinimalReporter, whose `printTestModule` returns unless the module failed. The root configuration now explicitly selects `default`. The earlier baseline verbose run passed 267 files / 1,787 tests in 177.92 seconds; the first wider-universe long case took about 28 seconds. No test-run hang was reproduced.

The first integrated full run failed 13 exact schema/table/channel expectations. Those were updated without relaxing assertions, and both new channels were added to the secret-leak sweep. No automatic test retries were introduced. A separate local performance-gate attempt failed because simultaneous build-producing commands cleared `dist/renderer` while it loaded; its ERR_FILE_NOT_FOUND/mount-timeout receipt is retained. Build and execution were then separated, and the existing gate passed with its injected slowdown still exceeding the 200 ms budget.

## Thirty-minute retention

**Completed and passed the existing benchmark gates on the final source.** The workload ran 1,800 nominal feed seconds, with 1808.496 s total process wall time, 32 raw memory samples and 31 unique minute positions (the final position is sampled twice). Build/workload hashes match the clean tested revision. Navigation p75 19 ms; viewport drift 0 px; removed canvases 0; unchanged-history extension re-evaluations 0; renderer long tasks over 200 ms: 0.

| Elapsed min | Renderer forced-GC heap MiB | Main heap MiB | Main RSS MiB |
| ---: | ---: | ---: | ---: |
| 0 | 25.57 | 42.34 | 238.72 |
| 5 | 27.07 | 30.79 | 155.25 |
| 15 | 27.89 | 33.17 | 153.09 |
| 25 | 29.37 | 36.10 | 156.28 |
| 30 | 29.55 | 29.53 | 169.97 |

Renderer forced-GC heap changed by **3.98 MiB**. The harness deliberately retains per-frame timing arrays; no subtraction or application-only leak attribution was performed. This measures growth under the instrumented workload and does not establish leak-free operation. Main event-loop p95 22.200 ms, max 189.923 ms, at 20 ms histogram resolution. Raw native renderer memory fields remain inspectable in the receipt.

The workload samples forced-GC renderer heaps and native memory once per minute, with synthetic 1 Hz feed updates. Forced GC and retained instrumentation arrays affect memory/timing. A short separate Ionic first-open trace overlaps the opening minute, and the final exact-HEAD full suite overlaps approximately minutes 5–8; the separate collection probe overlaps minute 10, and a 65-second disposable Activity polling check overlaps minutes 13–14. Build/package work finished before these final cold runs. The machine was not reserved as an exclusive lab host, and OS file caches were not flushed. Lower-powered hardware, theme/GPU combinations and actual live-market/connected-account responsiveness remain unverified.
