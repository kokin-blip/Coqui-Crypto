# P6 internal cash reserve delivery — October 24, 2026

Local implementation against `775950a0f3c539755a626a1fe058b55ef8f5787f` on `codex/operations-crew-journal`. No P6 commit, push, merge, release or installed-account authorization is claimed.

The [original P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) and [full P6 specification](small-portfolio-p6-implementation-plan-2026-10-24.md) remain unchanged. This delivery implements the default-off A–E cash capability; F records technical acceptance separately from human review and use. P6-G sales and P6-H connected verification remain pending under their full saved requirements. P5-H and all P7 requirements remain pending. P0–P4 and P5-A–G behavior, historical findings and consumed evidence are preserved.

## What the capability does

- Creates an explicit, immutable simulated USD opening only in a fresh dedicated profile. It cannot convert an existing holdings/research/connected book. Opening funding is a single canonical paper ledger entry and a P1 opening valuation, never an inferred contribution or investment gain.
- Adds the separate `paper-reserve-cash-v1` operational domain and migration 99 (nine empty tables). Operational state, requirements, proposals, assessments, authority proofs, events and command receipts are immutable. Only the fenced access/head binding is mutable. Legacy P3 modeled previews and P4/P5 research identities remain separate.
- Reconciles actual orders, fills, ledger legs, fees, cash, holdings, marks and claim backing. Unknown funding, incomplete fee/position evidence, stale/ambiguous marks or unmatched obligations remain explicit. Known recorded fees and realized P&L do not disappear merely because a current asset mark is missing.
- Allocates only the minimum supported economic-profit, realized-profit, free-cash and retained-capital capacity. Existing funded reserves are subtracted once by P2. Exact cents, assessed slice G, monotone H, frozen base/cycle ceiling and lifetime profit backing survive releases and policy changes. Principal tax holds and profit-backed tax holds retain different attribution.
- Commits linked claims, assessment, state, head and accepted response in one SQLite transaction. Exact retries reproduce accepted or refused receipts. A qualification refusal cannot later turn into authorization under the same command ID. Unexpected storage/fault errors roll back without inventing a financial outcome.
- Passes one sealed scope-bound P2 port through new-book manual, immediate, pending, settlement and scheduler execution. Missing/wrong ports refuse; a covered pending order consumes its own claim once. Pending settlement defers new reserve allocations. Actual orders still require the existing approved execution gates and OMS.
- Uses active trading NAV and actual positions under new strategy/decision identities, including the first buy from cash. Native increments/minima, fees and risk limits clip demand down; missing data never forces a minimum trade or creates a fictional holding. Existing legacy denominators/defaults remain unchanged.
- Keeps managed-account performance unchanged by internal cash allocation. Separate active-sleeve performance requires contemporaneous internal-flow marks; a later observation cannot be interpolated into the mutation time.
- Adds local read projections and reviewed setup/save/observe/authorize/review/release/pause/Resume commands. Saving disarms; previews and reads do not acquire authority. Observation cadence produces bounded proposals/observations only, with no catch-up commitment. Reconnect/restart/copy/restore/suspend never recovers a process-local permit automatically.
- Adds an Allocation panel with dated account/active/free/reserve/tax evidence, exact unavailable states, policy and calculation provenance, separate authorization and allocation review, and retained-H release wording. External receipts remain distinct from reserve cash. Keyboard, theme, narrow-layout and zoom evidence is recorded.

## Authority and safety boundaries

Authority is purpose-bound to the exact profile/book/policy, host generation, current execution lease/fence, strategy/configuration, code artifact, cost profile and horizon/normalization evidence. Missing qualification refuses. Every current risk stage other than normal conservatively refuses with an exposure-reconciliation reason. Kill, hard stop, strategy pause, profile operation exclusion and existing permission gates remain effective. Resolving an incident does not Resume.

Positive integration fixtures create disposable synthetic eligibility through the production evidence binder. They establish mechanical behavior only, never economic qualification, fresh research evidence or an installed strategy's eligibility. The production UI smoke deliberately demonstrates qualification refusal.

No reserve service has a broker, sale, cancellation, transfer, payout, registration, holdout, promotion or deployment port. Read reserve channels use local evidence only; explicit observation/normal trading preparation reuse existing GET acquisition outside the financial mutation transaction. No new polling schedule or credentials are added. P6 connected routing explicitly refuses until H.

Profile duplication retains immutable originating provenance, claims and assessment history, archives the new access binding, clears authority and grants no fresh financial identity. Immutable profitability/forward-observation provenance is also preserved rather than rewriting its source profile during a copy. Backup and deletion-impact categories retain their existing manifest contracts.

## Reviewable batch record

| Batch | Delivered | Remaining gate |
|---|---|---|
| A | Baseline, exact source inventory, separate domain/contracts, fixed source/claim semantics and arithmetic fixtures | Human review of the local change |
| B | Empty v99 migration, explicit origin/capture, immutable repositories, CAS and copy/backup impact | Installed upgrade/release approval remains separate |
| C | Exact evaluator, atomic funded claims/release, refusal receipts, concurrency/fault and backing tests | Actual owner policy/parameter approval and qualifying evidence |
| D | All new-book execution consumers, cash-aware decision/consequence adapter, active NAV, stable next-open runtime and lifecycle disarm | No adoption of a P5 candidate; P5-H remains pending |
| E | Local channels, Allocation controls, observation-only UTC cadence and manual Resume | Actual authorization stays default off |
| F | Full and isolated technical checks, production native safety, UI review and preserved-source evidence | Human source review/merge/release; technical evidence is not those approvals |
| G | Pending in full | Cash-only review plus realized-cap/exposure/turnover objective and separate order-consequence/qualification review |
| H | Pending in full | COQ-12/14, owner-authorized intended-host account observations, current provider terms and exclusive account-wide ownership/claim/fencing proof |

## Verification and reproducibility

The durable [evidence directory](evidence/p6-paper-2026-10-24/) contains the 508-entry dirty baseline, 82 protected hashes, exact source inventory and nine reconstructed pre-P6 mixed files. `preservation.json` identifies deliberate integration/current-manifest changes separately from protected historical evidence. The original roadmap and P6 plan hashes remain unchanged; unrelated working files and the Git index are preserved.

`source-isolation.py` constructs P5 HEAD plus the explicit P6 source closure in a disposable directory, applying only verified P6 edits to mixed files. First-party dependency links resolve inside that tree. A private temporary Git index/ref exists only for build metadata and does not change this checkout or create a P6 commit. Current dependency manifests are regenerated independently in each source tree; prior manifest bytes are retained here. Frozen reports, negative findings, consumed holdouts and historical report identities are not regenerated.

Final command results, source hashes and test counts are in `validation.json` and the `logs/` directory. Focused tests cover all nine capital controls, cent arithmetic, tax backing, history conservation, actual OMS spending and pending settlement, order/reserve races, duplicate review/refusal retries, transaction faults, source corrections, lease/host/kill/risk/pause checks, pure reads, scheduler cadence, profile copy and truthful unavailable UI.

Native checks run production Electron with temporary profiles, stubbed providers and scheduler disabled. The six reviewed section captures cover dark desktop, light narrow and high contrast at 200% zoom. The finish review requested visible disabled actions and readable consequence recovery; its verdict scored both fixes resolved. The verdict is limited to those fixes. These technical checks do not establish account ownership or strategy returns.

## Retained requirements before any later slice

Reread the complete saved phase/slice requirements before starting. No sale proceeds pre-fund a reserve. G must retain separate review, deterministic intent, partial/unknown/cancel recovery and post-fill reassessment through existing OMS. H must prove account-wide ownership across profiles/hosts, actual fee/history/hold coverage and intended-host permissions; a profile lease or isolated-book flag is insufficient. P7 retains owner registration, valid fresh identities and coverage/actions, applicable statistical/cost/risk gates, candidate-or-none freeze and final claim once. Live trading and external payments remain a separate future project.

## Prompt used

Ok move onto building P6 using the saved plan. Preserve P0–P4 and P5-A–G, keep P5-H pending and the full P0–P7 scope intact, and keep the phase tracker updated.

## Requested commit and push — October 24, 2026

P6-A–F is now committed and pushed as [5af1b92de230a42c3464cd63be16ddf0d60893d1](https://github.com/kokin-blip/Coqui-Crypto/commit/5af1b92de230a42c3464cd63be16ddf0d60893d1) on `codex/operations-crew-journal`. Remote ref verified. The 142 staged paths exactly matched the isolated P6 tree, including all 74 validated source hashes and independently generated current dependency manifests. Raw evidence logs retain their original whitespace. Unrelated working-tree bytes/deletions were not changed or staged. Earlier local-delivery statements above remain historical; no merge, release, owner authorization or strategy qualification is claimed. P5-H and P6-G/H remain pending in full.

Commit/verification receipt: [P7 planning evidence](evidence/p7-prospective-planning-2026-10-24/p6-commit.json). P7 has a separate saved implementation plan and remains unimplemented/unregistered.

**Prompt used**

Commit and push P6-A–F, then plan P7. Reread its full requirements in the saved roadmap and inspect the code before coding. Keep P5-H and P6-G/H pending, preserve completed work and the full P0–P7 scope, and update the phase tracker.
