# Renderer polish performance — 2026-09-04

Measured with `pnpm perf` on darwin/arm64, Electron 43.4.1, production build.
This is a local gate observation, not a universal performance guarantee.

| Measurement | Observed | Gate |
| --- | ---: | ---: |
| Warm useful shell | 293.0 ms | ≤ 1500 ms |
| Interaction p50 | 8.4 ms | Informational |
| Interaction p75 | 8.7 ms | ≤ 200 ms |
| Interaction p95 | 9.3 ms | Informational |
| Synthetic 250 ms blocking control, p75 | 250.5 ms | Must exceed 200 ms |

All gates passed; the synthetic control detected the deliberate regression.
The existing build warning about chunks larger than 500 kB remains. This pass
does not change chart loading or introduce an additional runtime font network call.
