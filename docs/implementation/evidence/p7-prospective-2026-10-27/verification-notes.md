# P7 verification notes

The final validation JSON and referenced final logs identify accepted source and checks. Earlier interrupted/checkpoint runs are not acceptance. No installation, actual study, genuine market qualification or release is implied.

## Reproduce the isolated source

Run the retained `isolate-source.py.txt` from the repository root (rename/copy to a temporary `.py` path for execution). It exports pushed P6 5af1b92 to a disposable directory, reconstructs five mixed baselines against recorded SHA-256 values and applies only P7 changes. External installed dependency bytes are reused; each Coqui workspace resolves to the isolated packages/apps. It never stages, resets or commits the original checkout. `source-closure.json` includes the final added stylesheet and SHA-256 values; five mixed files intentionally differ from the combined checkout by excluding unrelated edits.

The installed pnpm automatic dependency-status check initially requested reinstalling modules in the isolated directory and refused a non-TTY purge. Do not enable that purge against shared dependencies. Accepted isolated checks instead invoke the already-installed TypeScript/ESLint/Vitest/Vite JavaScript entry points directly. Set `GIT_DIR` to the original repository's read-only Git directory and `GIT_WORK_TREE` to the isolated tree for build identity/metadata commands. The final original Git index hash is unchanged.

Run the manifest builder before TypeScript compilation. The accepted root build is TypeScript project build; typecheck covers root and renderer configurations; lint scans the isolated tree; Vitest uses one worker. Desktop build then runs preload bundling, Vite, and build metadata from the isolated desktop directory. Preceding setup failures (missing app workspace dependency link or Git metadata) were corrected and are not counted as passes. Current generated manifests are specific to each tree; frozen registered reports/hashes are not regenerated.

## Financial/statistical fixtures

The 46 focused cases are software mechanics. Disposable positive registration/freeze/review proofs are explicitly synthetic; they are not research outcomes. The policy-path case advances all nine books and both cost scenarios through full funding/reserve transitions. Frozen strict gates remain applicable; small samples and missing normalized edge evidence can legitimately produce none/insufficient. A larger frozen trial bound is never replaced with a smaller observed registry count. Assessed reports bind current registry identity and qualification rejects later revisions.

The final combined and isolated full suites are recorded separately. The combined tree includes the user's unrelated work. Tests added while intermediate work was still changing are superseded by the final stable-source runs; only those final logs support accepted counts.

## CLI and native checks

`cli-smoke.mjs.txt` records the disposable CLI procedure: explicit current-schema DB/profile manifest/workspace/host, future synthetic design, prepare without writes, missing-owner refusal, exact retry, four local reads, sealed absent-report refusal and no order/claim/automatic collector. Both trees use the same 12 checks. Help is side-effect-free and selects no installed database.

The P7 native script uses production composition, dispatcher and sandboxed preload, a disposable synthetic profile, stubbed providers and disabled schedulers. It checks empty boot, explicit selection, sealed action counts, unverified collector health, associated labels, narrow overflow, keyboard, read-only persistence and disabled live execution. Complete target-section captures include pagination and expanded provenance; full-page capture coordinates account for 200% zoom. These screenshots are source/UI evidence only.

The existing standard safety smoke retains its original assertions. Repeated runs timed out during macOS's native fullscreen transition; failure logs are retained. Diagnostics show HTML fullscreen enters while the native window remains unfocused. Computer use confirmed the Mac is locked and requires manual unlock. After the user manually unlocked the Mac, the unchanged original standard safety smoke passed, including native fullscreen and focus recovery. No assertion, timeout, authentication or application fullscreen behavior was weakened. Locked-host failures are retained as superseded diagnostic evidence. The existing Vite large-chunk advisory remains an advisory, not a new P7 behavior.

## Preservation

`verify-preservation.py.txt` checks 506 initial dirty paths, 1,386 initial source identities, five reversible mixed patches, the original roadmap/full P7 plan and Git index. It also verifies identical unmixed bytes in the isolated source. `recover-baseline-manifests.mjs.txt` reconstructs the pre-P7 generated manifest bytes using baseline-verified sources and proves their recorded hashes before saving them. Current manifests can change without rewriting old reports, negative findings, consumed identities or those retained prior bytes.
