# Quarantined language spike

This directory is benchmark-only. Production packages must not import it. It compares the same
deterministic, registered-shaped rolling research workload in TypeScript, Rust/N-API, and a
persistent Python worker. It never reads Coqui's registered dataset or final holdout.

Pinned tools: Rust 1.97.1, `@napi-rs/cli` 3.8.0, CPython 3.14.6, NumPy 2.5.1.

The workload is deliberately narrower than the production backtest. Its results can reject a
language candidate or justify a full parity port, but cannot by themselves promote a backend.
Promotion still requires the production golden fixture and failure-outcome gate.

Build the native spike with `node_modules/.bin/napi build --cwd benchmarks/language-spike/rust --platform --release --strip`, then run `node benchmarks/language-spike/run.mjs`. The runner uses 20 measured repetitions by default. A lower repetition count is diagnostic only and is not adoption evidence.
