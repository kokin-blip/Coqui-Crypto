# P3 delivery: profit assessment and preview evidence

Local implementation of the [saved P3 plan](small-portfolio-p3-implementation-plan-2026-10-23.md), based on c563d4e. The [complete P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains unchanged. [Phase tracker](small-portfolio-phase-tracker-2026-10-23.md). Verification is evidence of implementation mechanics, not trading efficacy, current account verification or release.

## Implemented behavior

`profit-reserve-preview-v1` evaluates dollar-profit, fixed-base percentage and absolute active-balance milestones. A balance crossing needs growth alone to reach its target as well as the current active balance; deposits, manual withdrawals and reserve releases cannot manufacture a crossing. Completed flat-to-flat winning episodes can request advisory review, but cannot establish profit eligibility or issue a notification.

The pure engine preserves one bounded cycle ceiling, a monotone modeled watermark, prospective policy exclusions, loss recovery, cent-exact partial profit slices, minimum batches and residual closure. A 33% share with a $10 cap assesses $30.31 and models $10 of reserve. Release frees modeled cash without reducing H or recycling assessed gains. Unknown or underfunded operations stay recorded; no timeout releases them. Core financial facts and output amounts use exact decimal arithmetic.

Allocation is capped independently by complete contribution-adjusted economic profit, complete net realized investment profit, shared free cash after obligations and supported retained capital. Profit-backed tax holds have separate provenance. Costs enter the account/economic identity once; execution prices already contain spread/slippage, and attribution does not create another debit. USD interest is separately attributed where supported. Outside-account expenses affect a labeled hypothetical user-net comparison once, without changing account P&L.

`profit-reserve-eligibility-v1` reuses the original P1 epoch and canonical event/valuation evidence, exact local origin/fills/fees and P2 source/claim heads. It rejects unproved same-time financial ordering, unknown opening basis, incomplete fee/history/position evidence and inconsistent cuts. No manual lot, cost basis change or reconciliation note creates funding or verified profit. Current legacy local initialization starts from tracked holdings at zero cash; its market value is not acquisition basis. These histories may correctly remain unavailable. Connected account basis/fees/coherent cuts/ownership are also evidence requirements rather than assumed facts.

`reserve-capital-witness-v1` derives and verifies sufficient retained-NAV inequalities for an exact, fixed P2 request. It checks current and post-request weights, entry fractions, cash before sale proceeds, costs, native legality and stricter account limits. A full-request P2 witness must agree; clipping, unmodeled equity components and an empty trading request cannot certify a floor. Explicit cash-only examples have a limited cash objective and do not certify future trades. P2's global floor result and all P0–P2 numerical versions remain unchanged.

## Storage, services and compatibility

Empty additive migration **98** adds the six planned preview policy/eligibility/state/assessment/report/head structures plus **`capital_reserve_commands_v1`**, an immutable receipt journal required for exact retries after subsequent commands. This additional table implements the accepted retry requirement; it is not a financial ledger. Existing backup-before-migration, transactional rollback and newer-schema rejection remain intact.

Facts use canonical JSON/content hashes, decimal text, foreign keys, linked predecessors, operation uniqueness and no-update/no-delete triggers. Operational heads use revision CAS. The actual isolated modeled transaction rechecks current sources and state; tests inject failures at state, assessment and head writes. Stored previews round-trip without changing identity. A replay after lost UI acknowledgement returns the original result. Profile copies archive preview heads and preserve immutable origins/H; restore preserves original dates and obligations without asserting fresh connected ownership. Deletion-impact counts use existing categories; backup-manifest keys and the profile-scoped table contract remain unchanged.

The four new local channels are `capital.reserve.view`, `capital.reserve.preview`, `capital.reserve.settings.save` and `capital.reserve.inspect`. The read routes do not write. Save/inspect explicitly persist only preview configuration/evidence, use the existing profile-operation gate and check financial/policy/state revisions. An inspection may capture a cycle but never applies an assessment or locks cash. A private `isolated_preview` boundary exercises durable modeled assessment for separately identified local preview books; it has no order/claim callback or public IPC command.

Actual P2 profit/tax claim storage remains disabled. Modeled state is never promoted into account financial facts. No scheduler, provider polling, order/cancel/withdrawal client, strategy adoption, study registration, installed upgrade, deployment or release is introduced. Existing permission, host/fencing, fee proof, manual Resume, pause, kill and qualification controls remain intact.

## User experience

The Allocation screen adds a compact Profit reserves section beside the existing capital information. Account and environment selection, observed balances, scoped P&L, independent availability and source times remain visible. Cash capacity and previews expire on screen; recorded balances retain their original dates. A separate $500 hypothetical cash book is available without a connected account. Its assumptions cannot become observed financial evidence.

Default account behavior is Keep gains invested. Save preview settings and Inspect calculation write only local preferences/evidence. Controls cover all three milestones, share, retained capital, batch, advisory cadence/win count and a hypothetical tax hold. Changed inputs clear old results; no scheduler is installed. The consequence view exposes caps, fixed B/U, modeled H versus actual reserve subsets, excluded gains, exact inputs, provenance, rounding, hypothetical sale costs/residuals and a deterministic ±20% comparison with zero reserve yield. A sale's proceeds are never presented as profit or added to this preview's eligible cash. Pre-personal-tax labels and unavailable basis/operating proof remain explicit. Performance/Research links do not add study commands.

## Verification and preservation

Acceptance passes: **299 test files / 2,213 tests**, including **73 new cases** in seven focused suites; repository typecheck/lint, root/desktop builds, standard native safety smoke and **24 P3 native checks** pass. Dark desktop, narrow light and high-contrast 200% screenshots were inspected. The [final summary](evidence/p3-reserve-2026-10-23/summary.json) records the exact assurance and open gates. No additional full run is needed for these final documentation-only records.

[Evidence directory](evidence/p3-reserve-2026-10-23/) contains the dirty-tree baseline, exact pre-build current manifests, command logs, source preservation audit and disposable native screenshots. Initial full verification found three stale expected schema/channel lists; those were updated without changing financial fixtures. A superseded full run was interrupted when the final cash-expiry regression was added; it is not claimed as a passing final run.

The preservation audit finds **487 of 495** pre-existing changed files byte-identical. Six mixed source/test files contain only exact P3 insertions: removing those insertions reproduces their baseline hashes. Two generated current dependency manifests have exact original archives. The original roadmap, companion evidence, accepted P3 plan, P1 calculation, P2 budget/feasibility and frozen remediation planner hashes match. Historical study results, negative findings and consumed holdouts remain untouched; generated dependency hashes do not migrate a registration or create fresh data.

[COQ-37](https://linear.app/coqui-crypto/issue/COQ-37/implement-p3-profit-assessment-immutable-preview-state-and) is In Review; the issue and milestone progress updates are synchronized. This delivery is local and uncommitted. Human review, actual account basis/fees/coverage/native/ownership evidence, owner qualification and release remain separate gates. P4–P7 remain pending in full. No installed account's historic profitability or strategy return is asserted.

**Prompt used**

Ok move onto building P3 using the saved plan. Preserve P0–P2 and the full P0–P7 scope, and keep the phase tracker updated.

## Exact commit-source acceptance

The isolated P3 closure on c563d4e passes **293 files / 2,106 tests**, typecheck/lint, root/desktop builds, standard native smoke and 24 P3 native checks. Six mixed files exclude unrelated hourly/execution edits; current manifests are generated by the committed generator. Original combined-checkout 299-file/2,213-test evidence is retained. [Commit-isolation evidence](evidence/p3-reserve-2026-10-23/commit-isolation/summary.json). This acceptance does not close human review, account verification, owner, qualification or release gates.

**Prompt used**

Commit and push P3, then lets move on to P4. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P3 and the full P0–P7 scope.

## Committed and pushed

P3 is pushed as [9c6b2fccebc9e809ba2800fc538e831bab0c5c66](https://github.com/kokin-blip/Coqui-Crypto/commit/9c6b2fccebc9e809ba2800fc538e831bab0c5c66). Origin was verified at this commit. Exact commit-source checks above passed; unrelated work remains uncommitted. COQ-37 remains In Review. No merge, install, release, financial action or qualification is claimed. P4 planning is saved separately; P0–P3 and full P0–P7 scope are preserved.
