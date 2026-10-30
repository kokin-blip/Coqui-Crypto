# P6-H: disabled account-authority journal foundation

October 29, 2026. Readiness work is committed and pushed as [9164e16](https://github.com/kokin-blip/Coqui-Crypto/commit/9164e163af667c82d66cd3b7cd15146a046e4a96), with 25 selected paths verified against the index/commit and the remote ref verified. Its isolated three suites/13 cases, focused lint and root typecheck pass. [Receipt](evidence/p6-h-readiness-commit-2026-10-29/commit-receipt.json). Unrelated work was excluded. No merge, release or actual connected acceptance.

The following foundation is a separate **local, uncommitted partial H2 delivery**. The full [roadmap](small-portfolio-profit-policy-plan-2026-10-23.md), [P6 plan](small-portfolio-p6-implementation-plan-2026-10-24.md), [H readiness/protocol plan](small-portfolio-p6-h-readiness-plan-2026-10-29.md), [P7 plan](small-portfolio-p7-implementation-plan-2026-10-24.md) and [tracker](small-portfolio-phase-tracker-2026-10-23.md) retain all requirements. This explicitly sequences contract/disabled storage work ahead of H1's deployment review; H2's full acceptance and H3–H6 remain dependent on that review and the unfinished financial/dispatch implementation. No topology is silently selected.

## Implemented foundation and limitations

| File | Implemented behavior |
|---|---|
| `packages/core/src/execution/account-capital-authority.ts` | Versioned strict commands, canonical declared Alpaca/paper account key, deterministic preparation transitions and read-only `AccountCapitalAuthorityPort`. Allowed states are disabled/quarantined. Every view has literal false execution/funded-claim flags. |
| `packages/storage/src/repositories/account-capital-authority.ts` | Explicit new-file creation/reopen, journal-format/application/registry checks, immutable account/event/command evidence, CAS heads, exact retry/conflict handling, bounded preparation lease/fencing, consistent backup. No installed-path default or profile migration. |
| `packages/services/src/paper/account-capital-runtime.ts` | Explicitly injected read projection only. Missing/corrupt/unreadable evidence remains unavailable, with no database-error contents or synthetic fresh scope exposed. No command, provider, scheduler or dispatch port. |
| Core/storage/paper index exports | Expose these internal APIs for subsequent reviewed integration. Preserve pre-existing unrelated exports and code. No Main/composition/IPC/renderer binding is added. |
| `tests/account-capital-authority.test.ts` | Sixteen regression cases, including generated actor orderings, stale-revision races, exact retries/conflicts, expiry/ownership, four initial-write fault points, later-head rollback, immutable evidence, read failure, explicit profile/newer-format refusal and copy/reopen behavior. |

The journal uses the existing canonical JSON/hash, capital scope formula, synchronous immediate-transaction and SQLite consistent-backup helpers. Its private **format1** and application marker distinguish it from profile schema100. Existing profile migration numbering, runner, backups, restore behavior and deletion-impact categories are unchanged. Creation refuses any existing file; reopening refuses the wrong database, registry or unsupported format. No runtime opens a journal automatically. Future journal upgrades need their own reviewed backup/migration contract; this delivery performs no upgrade of any existing store.

The journal's `registryId` identifies this ownership evidence store; it is separate from the research trial/consumption registry and proves none of that registry's completeness or custody requirements.

Preparation sessions serialize metadata work **within one explicitly shared store**. They do not establish broker-account exclusivity, permission or complete financial history. Different physical copies can still prepare independently. Every copy remains unavailable for execution; registry IDs, local fences, expiry or a successful database read are not proof of a current shared authority. A copied/stale journal cannot supply a runtime permit through this API.

Each command binds account, registry, profile, host identity hash, time and exact prior head. An identical retry returns its original immutable result even after later commands; reuse with changed input refuses. A new actor cannot consume an old head; an expired occupied session requires reconciliation, with no automatic takeover, release or Resume. Quarantine advances the generation and retains prior checkpoint/session evidence. No method unquarantines or activates the account.

Checkpoints contain **unverified references** to existing P2 source/claim-head/claim IDs and reconciliation evidence. They hold no amounts, create no funded P2 claims, reconstruct no capital flow, and cannot prove basis, fees, reserve backing or financial completeness. Release changes only preparation ownership; it neither releases a financial obligation nor resets H. The later shared financial protocol must bind actual current P1/P2/P6 source/claims/state/H/backing and supported holds before any cash consumption is possible.

## Verification and evidence

The exact isolated foundation is constructed over pushed readiness, with only seven selected source paths. The paper index is reconstructed over HEAD so unrelated hourly exports are excluded from that validation; their working bytes remain preserved. [Source closure and validation](evidence/p6-h-authority-foundation-2026-10-29/validation.json) records final results separately from the readiness commit's checks.

Final isolated checks pass **351 suites / 2,379 tests**, root typecheck, lint and root build. Working root/renderer typecheck, focused lint and **four suites / 29 cases** also pass. No UI change was made; no new native/fullscreen/packaging/release acceptance is claimed. Prior native evidence remains preserved at its original source scope.

Final review identified a missing mutable-head case: an immutable recorded scope without its head is incomplete/corrupt history, not an unrecorded account. The read now reports journal evidence unavailable and a fresh-scope command refuses. The regression retains the original event; earlier passing source/results are archived separately, with the correction's checks recorded under `isolated-final-*` and `working-final-*`.

The [reproducible separate-process probe](evidence/p6-h-authority-foundation-2026-10-29/cross-process-probe.mjs) runs against an explicitly supplied built closure and disposable synthetic journals only. It verifies one winner/two processes at one head, durable retry after a child exits following commit without acknowledgement, and independent-copy refusal to grant authority. It is not cross-machine deployment, broker recovery or actual account evidence.

Build-derived candidate study manifests are retained separately as new source evidence; existing working generated manifests, historical reports, frozen identities, negative findings and consumed holdouts are preserved. The changed source closure cannot be assumed compatible with an active frozen campaign or inherited qualification. No campaign is adopted, re-registered or installed.

## Remaining requirements and dependencies

- **H1 direction selected; verification pending:** the owner delegated the host choice. Use [this Mac as the sole intended host](small-portfolio-p6-h-single-host-design-2026-10-29.md), with other Coqui hosts observing only after reviewed enrollment. Actual device/credential/writer exclusion and shared local dispatch must still be implemented and verified; account UUID/display-number mapping/dedication, exact COQ-12 source/current capabilities/rights and permitted COQ-14 observations remain pending. The choice grants no current account authority.
- **H2 incomplete:** actual account-wide financial claim coordination/conservation, verified common cuts and enrollment. The preparation-only journal is not acceptance of shared cash ownership. No arbitrary caller hash/reference can establish financial proof.
- **H3 pending:** real shared dispatch enforcement, stale-writer/in-flight fencing and all-consumer injection. No broker-enforced fence is assumed. No connected factory or alternative order path is implemented.
- **H4 pending:** real financial/source corrections, holds/fees/manual activity, unknown settlement, restore/takeover and loss/H/backing reconciliation. Local fixture success does not establish these facts.
- **H5/H6 pending:** applicable disabled app/UX integration and exact lifecycle/native acceptance, followed by separately permitted intended-host account observations. No live or payout capability.
- **Other full-project gates retained:** P5-H adequate permitted development history/global custody/rights/native costs/objectives/resources; P6-G actual F/objective/qualification/operational admission; P7-H owner plus independent reviewer/approved future design/rights/registry/power/resources, I genuine elapsed evidence and J timely freeze/untouched final once/independent exact acceptance. Earlier human/account/release gates remain open.

No installed database/account, paper order/cancel/withdrawal, pause/Resume, collector/registration/final/qualification, deployment or release was touched by this continuation.

## Prompt used

Commit and push the P6-H readiness work, then continue building the account-wide authority using the saved plan. Preserve unrelated work and the full P0–P7 scope, keep unmet evidence gates pending, and update the phase tracker.

Relevant follow-up answer to the intended-host/other-host question:

> Whatever you think is the most sensical

The selected direction and exact question are retained in the linked single-host design; no enrollment or broker action is inferred.
