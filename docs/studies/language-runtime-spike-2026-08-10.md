# P1-P3 language runtime spike - 2026-08-10

## Decision

No non-TypeScript backend is promoted. Rust/N-API and the persistent Python/NumPy worker both
matched the quarantined workload exactly, but neither passed the existing performance gate. The
optimized TypeScript implementation remains the safe authoritative fallback. These results do not
open the registered holdout, validate strategy defaults, or unblock P3.

## Scope and controls

- Owner-authorized local Nautilus source only; SHA-256 anchors are in the adoption matrix.
- Quarantined `ResearchKernelV1` spike: three canonical assets, 3,860 generated daily observations,
  16 candidates, and 5,000 deterministic bootstrap resamples. The full production five-fold and
  16-partition orchestration remains outside this rejection-only micro-kernel.
- Seed: `20260809`; implicit NumPy/BLAS and Rust parallelism disabled.
- Packed asset-major `Float64Array` input, stable dimension/price failure codes, deterministic event
  ordering, and no disk, network, clock, secrets, storage, UI, scheduler, or execution authority in
  any kernel.
- This deliberately narrower generated workload can reject a runtime but cannot promote one. It
  does not execute the production golden fixture or registered-study contract, and macOS arm64 load
  and packaged-artifact parity remain unrun.

## Environment

| Item | Value |
|---|---|
| OS/runtime | Windows x64; Node 24.18.0 |
| CPU | AMD Ryzen 5 3600XT; 6 cores / 12 logical processors |
| RAM | 17,076,944,896 bytes (15.90 GiB) |
| Rust | 1.97.1 (`8bab26f4f`, 2026-07-14) |
| N-API build CLI | `@napi-rs/cli` 3.8.0 |
| Python | CPython 3.14.6 |
| NumPy | 2.5.1 |
| Rust Windows artifact | 248,320 bytes |
| Python worker source | 4,838 bytes, excluding interpreter/NumPy environment |

## Results

Twenty production-build warm repetitions were measured after one parity diagnostic. Every backend
returned output hash `8ced8a797d85aa532e7f43c69b31a2248bbe4ed2c0daf74ca35f8bf5be7d6ad2`
on every measured run. Both stable failure cases passed for all runtimes, and the input hash was
unchanged after execution.

| Backend | E2E p50 | E2E p95 | Invocation p50 | Boundary/decode p50 | Relative to TS | Saved vs TS p50 |
|---|---:|---:|---:|---:|---:|---:|
| Optimized TypeScript | 158.499 ms | 164.736 ms | 158.489 ms | 0 ms | 1.00x | 0 ms |
| Rust through N-API | 111.110 ms | 111.214 ms | 111.074 ms | 0.018 ms | 1.43x faster | 47.389 ms |
| Persistent Python/NumPy | 534.449 ms | 538.945 ms | 534.410 ms | 0.038 ms | 3.37x slower | -375.950 ms |

Cold process/package measurements are incomplete: the runner measured in-process addon load at
4.600 ms through the generated platform loader and worker spawn at 10.920 ms, but did not measure a
packaged Electron cold start or peak
resident memory. That missing evidence independently prevents promotion.

## Gate evaluation

| Requirement | Rust | Python |
|---|---|---|
| Spike numeric, event-order, failure, and repeated-hash parity | Pass | Pass |
| Production golden and complete failure-outcome parity | Not run; cannot pass promotion | Not run; cannot pass promotion |
| At least 3x kernel speed | Fail (1.43x E2E/invocation) | Fail (slower) |
| At least 2x cold end-to-end speed | Fail/not established | Fail/not established |
| At least one second saved or a latency-budget violation removed | Fail (47 ms) | Fail |
| Windows x64 load | Pass | Pass |
| macOS arm64 packaged load/parity | Not run | Not run |

The result is therefore rejection, not a close call. Rust remains viable if later profiling finds a
larger, genuinely dominant pure batch with enough compute per boundary crossing. Python remains
valuable for exploratory vectorized research, but this exact-order scalar/bootstrapped workload is
not a reason to add an operational worker.
