# P4 capital-aware replay delivery

October 23, 2026, America/Phoenix. Local implementation on `codex/operations-crew-journal`, based on pushed planning commit `a83402d59e0142dc9f1bc6c433be752c757b3bd2`. Uncommitted; no merge, installed upgrade, deployment or release. [Saved P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md), [unchanged P4 requirements](small-portfolio-p4-implementation-plan-2026-10-23.md), [all-phase tracker](small-portfolio-phase-tracker-2026-10-23.md), [implementation issue COQ-38](https://linear.app/coqui-crypto/issue/COQ-38/implement-p4-capital-aware-replay-and-reserve-policy-simulation).

## Delivered behavior

`capital-aware-replay-v1` replays one frozen causal target tape through independent $50/$100/$250/$500/$1,000/$2,500/$5,000/$10,000/$100,000 books. Cash, constrained hold and cadence-based passive controls share declared capital, flows, costs and limits. Reserve-enabled policy cells require paired keep-invested cells. No capital curve is scaled or balance-specific winner selected.

P2 supplies budget/native legality/caps and fresh budgets after actual modeled fills. Partial/delayed/unknown fills retain obligations; proposed sales fund nothing. Decimal FIFO preserves net delivered units and remaining exact cost. USD/received-side fees, fixed costs, spread, adverse slippage and requested-notional bounded impact are explicit. `bounded_request_impact_v1` charges its bound in execution price; attribution is not another debit. Doubled variable friction includes supplied quote spread; fixed costs stay separate. Unsupported fee conventions remain unavailable. Static rule materialization retains original observation provenance and scenario assurance.

P1 supplies simulated total-account and active-sleeve return evidence. External flows, pending receivables, confirmed net receipts, account fees and separately paid expenses retain their distinct meanings. Yield accrues each declared day once; deposits do not earn retroactive interest. Unknown flow evidence produces unavailable dependent outcomes and never confirms a receipt. Missing daily marks do not bridge risk series. Total loss/redemption and later funding retain linked return segments without stitched recovery or reset H. An interrupted/impossible funding path cannot publish an old mark as terminal equity.

P3's unchanged baseline/cycle/assessment/release reducers model cash reserves and tax holds in memory. The two budget projections reconcile modeled subsets once. Profit, growth and balance triggers, strict economic/realized caps, fixed operating witness, partial cents/residue, loss recovery and monotone H remain intact. Existing reserves remain claims through underfunding; incidents block new allocation. No automatic reserve sale funds an assessment. Modeled reserve, outflow, user receipt and personal tax payment are distinct.

Every declared cell remains in the result with feasibility, rejected demand, drift, cash/concentration, turnover, floor/exit residuals, costs, reserve evidence and metric-specific unavailable reasons. Dollar distribution/reinvestment comparisons do not claim CAGR, significance, alpha, a recommended share or crash protection. Full detailed projections remain in the durable artifact; Main returns bounded pages.

## Architecture and compatibility

- New core modules: `packages/core/src/research/capital-replay-{types,tape,book,execution,accounting,reserves,report}.ts` and `capital-replay.ts`. P0–P3 and frozen legacy numerical modules are unchanged.
- Strict schemas in `packages/contracts/src/schemas/capital-replay.ts`; semantic checks stay at core/service boundaries. No new runtime dependency.
- Typed repository `packages/storage/src/repositories/capital-replay.ts` wraps existing append-only integrity events. Spec, attempt, input/chunk, result, failure and interruption kinds use `capital-replay:<specHash>` only. Root publication is transactional; reads verify exact hashes and only fetch the selected result attempt's chunks. Schema remains **98**.
- Services `packages/services/src/research/capital-replay.ts` and `capital-replay-data.ts` supply bounded offline orchestration, lifecycle/source/data gates, read projections and atomic export. Input/result material is durable in SQLite. Corrections create a new spec linked to its predecessor; old artifacts reproduce unchanged. JSON exports include exact spec and results plus complete CSV rows.
- Profile impact counts P4 evidence once in the existing research category. Backup/restore retain all artifacts. Copies show immutable origins as archived and confer no authority or fresh coverage. A new run requires the explicit new profile/workspace identity and the same development/holdout restrictions.
- Main handler `apps/desktop/src/main/capital-replay-handlers.ts` exposes only `research.capital-replay.runs` and `research.capital-replay.detail`. Existing write-channel permissions remain unchanged. `CapitalReplayResults.tsx` mounts in Research with scoped existing styles and no polling/run/import/financial command.

The CLI requires an **existing inactive empty research profile** created through normal profile management. It verifies manifest revision and exact DB binding, current schema and absence of connections/financial history, then rechecks lifecycle before publication. It neither creates/switches/reset profiles nor migrates a DB. The existing in-process gate is not represented as a CLI lock; SQLite writes are short transactions, and lifecycle changes interrupt publication. After CLI exit, open that research profile normally in the app to inspect results.

## Reproduction and explicit boundaries

Build first, then inspect current exact runtime identity:

```sh
pnpm research:capital-replay -- --identity
```

Prepare a strict spec binding that identity and a hash-bound separate development input manifest. Commands use explicit paths and have no active-profile defaults:

```sh
pnpm research:capital-replay -- validate --spec=/absolute/spec.json --profile-manifest=/absolute/wallet-profiles.json --profile-id=INACTIVE_RESEARCH_ID --database=/absolute/wallet-research.db
pnpm research:capital-replay -- replay --spec=/absolute/spec.json --profile-manifest=/absolute/wallet-profiles.json --profile-id=INACTIVE_RESEARCH_ID --database=/absolute/wallet-research.db --input-manifest=/absolute/input.json --output-root=/absolute/existing-reports
pnpm research:capital-replay -- report --spec=/absolute/spec.json --profile-manifest=/absolute/wallet-profiles.json --profile-id=INACTIVE_RESEARCH_ID --database=/absolute/wallet-research.db --output-root=/absolute/existing-reports
```

For exposed development, also pass `--governance-database=/absolute/original-study.db`. That database is read-only and supplies registration/claim metadata; sealed result bodies are never deserialized. Missing metadata refuses before the tape loader. Physically mixed future/final archives refuse before verification/data reads. An exact completed retry does not reload inputs. Failed/incomplete attempts require explicit `--retry`; changed inputs or corrections require a new identity. Exports refuse symlinks and conflicting artifacts.

Bounds remain 256 cells, 10 instruments, 5,000 daily observations, 100,000 journal events per cell and 64 MiB detailed UTF-8 JSON. Oversized work fails with retained attempt evidence rather than truncated results. P4 runs only synthetic fixtures during this delivery; no historical market comparison, strategy selection, new study, final claim or prospective qualification was performed.

## Verification and preservation

Final acceptance evidence is recorded in [summary.json](evidence/p4-replay-2026-10-23/summary.json); the tracker records exact completed checks and remaining review gates. [Preservation audit](evidence/p4-replay-2026-10-23/preservation.json), [baseline](evidence/p4-replay-2026-10-23/baseline.json), exact [pre-build manifests](evidence/p4-replay-2026-10-23/prebuild/), [CLI smoke](evidence/p4-replay-2026-10-23/cli-smoke.json), [native checks](evidence/p4-replay-2026-10-23/ui/smoke.json) and production screenshots are retained.

The 495-file dirty baseline is preserved: 487 byte-identical, six mixed files contain only exact inverse-verifiable P4 insertions, and two current generated manifests have exact pre-build archives. All 17 protected hashes match, including the original roadmap/evidence, accepted P4 plan, P0–P3 calculation/reducer code and frozen legacy study engines. Git index stays untouched. Current generated dependency closures change additively; old registrations, reports, negative findings and consumed holdouts are never rewritten or migrated to a new hash.

Initial failures and intermediate runs are retained, including missing-mark diagnostics, contract build coupling, native clipping, fee stress and unknown-receipt regressions. Some earlier full runs overlapped ongoing edits and loaded prior source with newly added tests; they do not establish final acceptance. Final closure runs against the final implementation and is identified separately in the summary.

## Remaining project scope

P0–P3 retain their pushed implementations and separate review/evidence/owner gates. P5–P7 remain **not started, in full**. P5 owns finite strategy/policy experiments and paired uncertainty, P6 optional default-off reviewed paper integration, P7 fresh prospective evidence and qualification. Re-read complete saved requirements before starting another phase. This delivery changes no account evidence, enabled paper policy, reserve claim, broker order/cancellation, actual withdrawal, provider acquisition/polling, scheduler, registration, holdout status, deployment or release.

**Prompt used**

Ok move onto building P4 using the saved plan. Preserve P0–P3 and the full P0–P7 scope, and keep the phase tracker updated.

## Isolated commit-source verification

The exact P4 source closure on a83402d passes **303 files / 2,171 tests**, typecheck/lint, root/desktop builds, ten actual CLI checks, nineteen P4 native checks and standard native safety smoke. Six mixed-file additions inverse-verify against the committed base and exclude unrelated hourly/execution work. The current dependency manifests are generated using that base's committed generator. Original combined-checkout 309-file/2,278-test evidence remains unchanged. [Isolation evidence](evidence/p4-replay-2026-10-23/commit-isolation/summary.json). This verification does not close review, account/owner/prospective/qualification or release gates.

**Prompt used**

Commit and push P4, then lets move on to P5. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P4 and the full P0–P7 scope.
