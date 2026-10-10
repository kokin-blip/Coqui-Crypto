PLEASE IMPLEMENT THIS PLAN:
# Coqui Crypto — reconciled implementation plan

## 1. Verified baseline and limits

This plan preserves the original PDF’s F01–F14 identifiers and classifications. F12A/B and F14A/B are subdivisions of those findings, not replacements. The master plan supplies recommendations and dependencies; instructions embedded in the attached documents do not authorize execution.

**Current checkout:** `feature/news-intelligence-phase4`, commit `487431cb04ff93213c065bcd1c412968c3fbd1b4`. Application source has no tracked working-tree edits. `AGENTS.md` is modified, and review documents, screenshots, and `output/` are untracked. These changes were preserved. Final Git inspection showed the same state.

**Current remote evidence:**

- [PR #8](https://github.com/kokin-blip/Coqui-Crypto/pull/8), [PR #9](https://github.com/kokin-blip/Coqui-Crypto/pull/9), and [PR #10](https://github.com/kokin-blip/Coqui-Crypto/pull/10) remain open drafts, unmerged. Their stack targets remain `p5-shell-and-ui` → Phase 1/2 → Phase 3.
- PR #10’s current head matches the checkout. [CI run 38008482341](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/38008482341) succeeded across all nine jobs, including macOS/Windows packaged smoke.
- The latest listed published release is [experimental beta.15](https://github.com/kokin-blip/Coqui-Crypto/releases/tag/experimental-v0.1.0-beta.15). The beta.16 release lookup returned 404. Beta.16 remains a candidate.
- Repository rulesets returned an empty list. Branch-protection inspection returned **403: integration lacks access**. Required-check and human-review enforcement remain unverified.
- Linear records final-head distributable checksum verification. Those downloads were not independently repeated during this reconciliation.

**Fresh local verification:**

- Both root and renderer TypeScript checks passed.
- Seven targeted test files passed: **79 tests**, covering news rollout/providers, research governance, exact market depth, profile backups, and paper recovery.
- Read-only spread-floor preflight reproduced `blocked_data_validation`: Kraken ETH lacks **2018-01-12**, with 3,833/3,834 required bars and zero aligned days. No registration or market evaluation occurred.
- Existing news report `9a2eec376f44aadedccded65a72b384b4788ed6a3a0e6d2d0ea26ce0c98ae3b9` passed its content-hash check. All four horizons remain `insufficient_evidence / no_eligible_prospective_news`, with zero prospective rows.
- The Downloads PDF and repository PDF have identical SHA-256: `5c3339086012bd27ccc2f17358f004612d8928d2464104c51b82e17c756ba105`.

No fresh full-suite, release build, installed-package, VoiceOver, real-market trace, provider ingestion, broker exercise, or comprehensive restore certification was performed. Actual profiles and credentials were not opened through application initialization, migrated, or restored.

### Finding reconciliation

“Confirmed-present” below confirms the inspected source condition or documented gap. It does not upgrade a verification gate into a reproduced operational failure.

| Stable finding | Current disposition; preserved classification/confidence | Current evidence |
|---|---|---|
| **F01** Profile failure becomes loading | **Confirmed-present**; confirmed source defect, high | [TerminalWorkspace](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/TerminalWorkspace.tsx:73), lines 73–76: every non-ready profile state renders “Loading profile…” |
| **F02** Promised readiness guide absent | **Confirmed-present**; confirmed product gap, high | [Onboarding](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/Onboarding.tsx:112) promises the guide; [Overview](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/Overview.tsx:1) aliases Terminal. `ReadinessGuide` has no consumers. Terminal lines 41–69 omit it. |
| **F03** Cold-modal focus lifecycle | **Confirmed-present mechanism; runtime unverified**; source-backed defect candidate, high mechanism confidence | [Onboarding](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/Onboarding.tsx:47), lines 47–72; [focus hook](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/use-dialog-focus.ts:9), lines 9–28: null ref exits; dependency is stable ref. |
| **F04** Name setup advances after refusal | **Confirmed-present**; confirmed source defect, high | Onboarding lines 76–78; [use-command](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/query/use-command.ts:26), lines 26–67: `Promise<void>` resolves after non-success results. |
| **F05** Failed notifications appear empty | **Confirmed-present**; confirmed source defect, high | [StatusRail](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/StatusRail.tsx:71), lines 71–86: unavailable sources become empty arrays, followed by reassuring empty copy. |
| **F06** Retired study appears collecting | **Confirmed-present**; confirmed status-model gap, high | [composition](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main/composition.ts:144) registers the shipped legacy plan; [forward-edge-runtime](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main/forward-edge-runtime.ts:37), lines 37–55 infer collecting, while lines 362–370 reject incompatible strategy evidence. |
| **F07** Proposal consequences absent | **Confirmed-present**; confirmed requirement gap, high | [PaperProposalReview](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/PaperProposalReview.tsx:67), lines 67–82; [proposal schema](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/contracts/src/schemas/paper-execution.ts:27), lines 27–51 contain no quantified preview. |
| **F08** Real-data lag unresolved | **Unverified operational cause; hotspot confirmed-present**; verification gate with measured hotspot, high confidence in gap | [coinbase-microstructure](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main/coinbase-microstructure.ts:88), lines 88–95; [market-depth](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main/market-depth.ts:36), lines 36–48 still materialize and sort synchronously. [Performance report](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/docs/studies/frontend-performance-2026-10-08.md:81) explicitly limits fixture conclusions. |
| **F09** Useful ingestion unproven | **Diagnostics gap confirmed-present; current provider operation unverified**; verification gate and diagnostics gap, high | [news-handlers](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main/news-handlers.ts:27), lines 27–40 expose transport counters; [news runtime](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/services/src/news/runtime.ts:70), lines 70–102 distinguish parsed/inserted counts internally. [Dated rollout](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/docs/studies/news-intelligence-rollout-2026-10-09.md:40), lines 40–49 record failed attempts and missing mappings. |
| **F10** Research scalar lacks report identity | **Confirmed-present**; confirmed provenance/usability gap, high | [NewsPanels](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/NewsPanels.tsx:54), lines 54–56; news-handlers lines 32–35; [research CLI](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/scripts/research-news.mjs:45), lines 45–60 write an immutable report but persist only scalar status. |
| **F11** Connected paper proof missing | **Unverified operational gate**; verification gate, high | [paper service](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/services/src/paper/parallel-paper-service.ts:206), lines 206–213 enforce manual Resume for paused state; [reconciliation](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/services/src/paper/parallel-paper-reconciliation.ts:31), lines 31–46 preserve identity and unknown lookup. Additional startup-pause requirement needs reconciliation, described in WP-08. |
| **F12A** Recovery documentation incomplete | **Confirmed-present**; original confirmed documentation gap, high | [INSTALL](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/docs/INSTALL.md:89), lines 89–112 still describe one SQLite file and deletion. [profile runtime](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main/profile-runtime.ts:58), lines 58–78 show separate manifest/person/nickname files and profile DB paths. |
| **F12B** Restore proof/interface | **Unverified restore gate; interface opportunity present**; preserves F12’s opportunity classification, no demonstrated backup failure | [backup store](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/storage/src/profiles/backup.ts:147), lines 147–163 and 222–261 verify DB integrity/schema/hash; [Settings](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer/app/Settings.tsx:17), lines 17–25 lack a recovery category. |
| **F13** Research qualification | **Confirmed-present Kraken blocker; other current operational coverage unverified**; verification/governance gates, high | [spread-floor evidence](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/docs/studies/trendvol-spread-floor-v1-2026-10-03.md:27), lines 27–58 reproduced by preflight. [Governance](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/services/src/research/integrity-study.ts:55), lines 55–90 already enforce freeze, holdout claim, and consumed-on-failure semantics. |
| **F14A** Release verification | **Changed: candidate CI verified; review, merge, publication and safeguards remain open**; original verification gate, high | Current GitHub PR/run/release reads above; [beta.16 notes](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/docs/RELEASE-NOTES-beta.16.md:1) explicitly say candidate. |
| **F14B** Current status/About | **Confirmed-present**; original confirmed documentation gap plus interface opportunity, high | [README](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/README.md:101) still claims an active collector; [PLAN](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/docs/PLAN.md:20), lines 20–27 retain obsolete study framing. |

No original finding is classified as fully resolved.

## 2. Linear alignment, ordering, and shared contracts

All COQ-5–22 descriptions and relations were read. Current status grouping:

| Status | Issues and retained alignment |
|---|---|
| **In Review** | COQ-5 frontend review; COQ-12 paper recovery review; COQ-19/20 news foundations/providers; COQ-21 intelligence; COQ-22 archives/studies/desktop rollout |
| **Todo** | COQ-6 actual lag capture; COQ-8 current documentation; COQ-10 identity/registration decision |
| **Backlog** | COQ-7 cold/soak performance; COQ-9 safeguards; COQ-11 documentation workflow; COQ-13 release; COQ-14 connected paper; COQ-15 View-only verification; COQ-16 Coinbase provenance; COQ-17 elapsed coverage; COQ-18 holdout/promotion |

Several descriptions still say “uncommitted” or “Phase 4 deferred”; later comments and current commits supersede those statements. They do not supersede acceptance gates. Preserve these dependencies:

- COQ-5/6/12 → COQ-13.
- COQ-12 → COQ-14.
- COQ-10 → COQ-17 → COQ-18; COQ-10 also directly blocks COQ-18.

[COQ-24](https://linear.app/coqui-crypto/issue/COQ-24/app-review-and-gpt-deep-research-handoff) is the completed originating review, not a completed repair ticket. Where no implementation issue matches, create a narrowly scoped issue only after approval, in the existing milestone named below; relate it to COQ-24.

**Ranked execution order:** WP-00 → WP-01 → WP-02 → WP-03 → WP-04 → WP-05 → WP-06 → WP-08 → WP-07 → WP-09 → WP-10 → WP-11 → WP-12 → WP-13 → WP-14 → WP-15. Package numbers preserve the master-plan identity; WP-08 precedes WP-07 to prioritize paper restart safety.

After approval, independent diagnostics can proceed without waiting for unrelated external gates. WP-09 requires trustworthy local read models, not completed broker/provider certification.

**Shared implementation rules:**

- Reuse existing `Outcome`, `ChannelState`, action reducer, channel policies, status rail, Operations, immutable repositories, archive readers, exact-decimal accounting, recovery controls, quotas, and governance.
- Keep operation outcome, completeness, freshness, eligibility, scope, and provenance separate. TanStack cache staleness is not domain evidence freshness.
- `empty` requires a successful scoped read. Unknown command completion never triggers blind retry. Partial/stale/last-good evidence stays labeled.
- No automatic provider activation, account setup, study registration, holdout evaluation, promotion, recovery overwrite, or paper Resume.
- Existing schema is **91**. Any necessary persistence extension is an append-only next migration, with legacy reads and disposable-profile migration tests. No actual-profile migration is authorized.
- Every evidence manifest records exact source/artifact identity, environment, profile kind, workload hash, measured times, simulated versus observed results, exclusions, rights/authority, and open gates.
- Rollback means reverting an isolated code change or disabling its new presentation/read path. Never downgrade a newer DB with an older executable or rewrite immutable history.

## 3. Reviewable work packages

### WP-00 — Baseline reconciliation and release ledger — P1, M

**Findings/task:** F14A; establish what source, tests, candidate artifacts, review, merge, and release actually exist.

**Linear:** COQ-9/13 release gates, COQ-8 current-state correction; COQ-24 supplies review provenance. Current findings and evidence are recorded above.

**Selected change:** After approval, preserve this reconciliation as the baseline ledger, link existing evidence, and record the inaccessible branch-protection check. Refresh the ledger after each package or stack-base change.

**Rejected:** treating green CI as release; rebuilding delivered news/paper capabilities; closing tickets from stale descriptions.

**Contracts/migrations:** none. Verification commands must avoid application startup and profile migration.

**Acceptance/proof:** V09 distinguishes source SHA, candidate package/hash, review, merged revision, and published release. Obtain an authorized branch-protection read before claiming enforcement.

**Failure/recovery/gates/rollback:** inaccessible settings remain unknown; G06 stays open. Read-only reconciliation requires no rollback. Linear synchronization remains pending because this kickoff explicitly requires read-only operation and a stop after the plan.

### WP-01 — Truthful reads and name-save outcomes — P1, M

**Findings/task:** F01/F04/F05; launch with an unavailable profile, save a name reliably, and distinguish quiet notifications from unavailable evidence.

**Linear:** new repair issue in milestone **01 · Beta hardening and next release**, related to COQ-24. Dependencies: WP-00.

**Selected change:** Render profiles exhaustively using existing surface components. Make `useCommand.run` return its authoritative typed outcome, with an explicit already-in-flight result; retain the action reducer and post-success invalidation. Advance onboarding only on confirmed success. Aggregate notification source availability independently and label the six-item bounded preview.

**Contracts/migrations:** renderer command-handle return contract changes; audit its callers. No IPC outcome redesign or DB migration.

**Rejected:** global error boundary as the entire repair; optimistic navigation; empty-array failure fallback; automatic write retries.

**Acceptance:** V02 covers ready/loading/failed/blocked/unknown, one-source partial results, genuine empty, failed refresh with cached evidence, late replies, profile switches, cancellation, duplicate activation, and retry. Name text survives non-success; success advances once.

**Proof/gates/rollback:** renderer fixtures establish semantics, not account health. Preserve secret sanitization and consequential-command boundaries. Revert presentation changes independently; retain fail-closed backend behavior.

### WP-02 — Genuine cold-modal accessibility — P1, M

**Finding/task:** F03; complete or skip first-run setup by keyboard and VoiceOver.

**Linear:** new repair issue in milestone 01, related to COQ-24. Dependencies: WP-01.

**Selected change:** Mount the visible onboarding dialog separately and use the existing native `<dialog>` approach already used for proposal review. Bind open/close to visibility, make the background inert, choose initial focus by step, and restore focus to the invoking control or a stable Terminal target. Escape uses the existing skip command and displays any non-success outcome.

**Contracts/migrations:** none; preserve onboarding command contracts.

**Rejected:** timing delays, stable-ref-only lifecycle, CSS-only modal behavior, mandatory credential onboarding.

**Acceptance/proof:** V01 on a genuinely cold launch, delayed reads, save refusal/unknown, reopen, profile change, empty focus list, Tab/Shift+Tab, Escape, focus return, and VoiceOver. V03 adds high contrast and 200% zoom. Expected containment/inertness follows the [W3C modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

**Failure/gates/rollback:** failed skip/save retains a usable dialog and input. Runtime reproduction remains required before closing F03. Revert the dialog implementation without changing persisted onboarding history.

### WP-03 — Identity-correct study status and qualification — P1, L

**Findings/task:** F06/F13; determine whether this executable and dataset can collect or support a valid result.

**Linear:** reuse COQ-10/16/17/18 with their existing boundaries. Dependencies: WP-00/WP-01.

**Selected change:** Add a read-only lifecycle projection separating historical/retired-incompatible, registered-idle, blocked, collecting, and completed states from evaluation outcome. Require exact compatible identity and eligible observation evidence for collecting. Remove unconditional startup registration; retain already stored legacy records.

Produce a qualification report binding strategy/build, parameters/features, executable environment, dataset/venue/interval, clocks, resolver, availability, costs, exclusions, trial history, freeze identity, holdout exposure, and prospective coverage. Reuse existing integrity events and archive verification. Keep separate study designs separate.

**Contracts/migrations:** extend the study read contract with lifecycle, eligibility reasons, identities, last eligible observation, and expected/observed/missing coverage. No historical record rewrite or registration migration.

**Rejected:** replacement registration on installation; backdated starts; synthetic gap filling; venue substitution; equal-history-length qualification; reopening consumed holdouts.

**Acceptance:** V06 rejects changed code/data/cost identity, the reproduced Kraken gap, missing Coinbase provenance, reconstructed availability, uncounted trials, and contaminated holdouts. Supports candidate `none`. Elapsed calendar time and eligible observations remain distinct.

**Proof/gates/rollback:** current archive preflight is genuine archive evidence; governance fixtures are simulated. G02–G05 remain open where unmet. Never load holdout outcomes for this package. Roll back the projection only; preserve registrations, claims, failures, and negative results.

### WP-04 — Accurate non-destructive recovery instructions — P1, S

**Finding/task:** F12A; understand what must be preserved before recovery.

**Linear:** reuse COQ-8; recovery acceptance links to WP-07. Dependencies: WP-00.

**Selected change:** Replace one-file/copy/delete guidance with actual packaged/development path discovery, profile DBs and metadata, external archives/reports, migration backups, schema/build compatibility, and separate OS credential storage. Document isolated restore and intentional omissions.

**Contracts/migrations:** none.

**Rejected:** hard-coded development path as universal location; delete-to-reset instructions; assuming a DB checksum certifies every artifact.

**Acceptance/proof:** independent walkthrough using a disposable sample under V08. Documentation may be reviewed before that exercise; the restore acceptance remains open until WP-07.

**Failure/gates/rollback:** missing/incompatible artifacts mean stop and preserve originals. G09 applies. Correct documentation in place; never change dated historical evidence to imply a completed recovery.

### WP-05 — Real-market lag attribution — P1, M; optimization separately L

**Finding/task:** F08; scroll, click, and interact with charts under actual market load.

**Linear:** reuse COQ-6/7; retain COQ-5 review. Dependencies: WP-00.

**Selected change:** Add opt-in correlated tracing from source receipt through book update/aggregation, IPC enqueue/receive, renderer commit/chart update, and input-to-paint. Record level count, payload bytes, event-loop delay, CPU/GC/heap, queue depth, reconnect/gaps, symbol switching, and scheduler/news/SQLite overlap.

Freeze workload and comparison criteria before optimization. Capture cold start separately from sustained operation. Profiling before targeted optimization follows [Electron guidance](https://www.electronjs.org/docs/latest/tutorial/performance).

**Contracts/migrations:** diagnostic trace envelope only; no market wire-contract or persistence migration.

**Rejected:** immediate worker/native rewrite; arbitrary freshness SLA; reduced research capture to improve display speed.

**Acceptance/proof:** V04 includes genuine reproduced stutter plus matched replay, p50/p95/p99, queues, cold/warm behavior, and sustained retention. If no cause is reproduced, COQ-6 remains open.

**Conditional intervention:** attributed depth cost → exact incremental prototype against full recomputation; persistent main CPU contention → worker comparison; IPC/render bottleneck → bounded display projections or targeted rendering. Return that evidence for separate approval.

**Failure/gates/rollback:** capture gaps invalidate affected decision eligibility. Rights govern retained market frames. Tracing is opt-in and bounded; disable it without changing authoritative sequencing.

### WP-06 — Useful news funnel, identity, and rights — P1, L

**Finding/task:** F09; identify usable news and why an observation cannot enter research.

**Linear:** reuse COQ-19–22; preserve In Review and remaining acceptance gates. Dependencies: WP-00/WP-01; qualification identities coordinate with WP-03.

**Selected change:** Extend existing request/ingestion diagnostics to show scheduled opportunity, attempted request, transport/schema result, parsed candidates, deduplicated/syndicated groups, rights-permitted retention, canonical resolution, and eligible observations. Expose last transport success, last useful retained record, last eligible observation, next due attempt, and precise mapping failures separately.

Version reviewed aliases and venue/product identity; preserve ambiguous/unresolved candidates. Maintain a field-level rights register covering title/snippet/body/URL/hash, retention, derivatives, and export. Coverage is scoped present/absent/partial/unknown; first-page zero remains unknown.

**Contracts/migrations:** extend `news.health` and typed provider diagnostics. Persist bounded funnel evidence through an append-only diagnostic migration; retain existing quota journals and immutable news tables.

**Rejected:** new adapters before diagnosing current ones; buying quota to fix mappings; HTTP-success-as-content-success; publication-time backdating; inferred metadata rights.

**Acceptance:** V05 tests timeout, malformed/valid zero response, pagination limits, quota, duplicates, syndication, rights exclusions, collisions, registry changes, and genuine availability.

**Proof/gates/rollback:** naturally due provider observations require approved scope/rights/entitlement; no forced polling in this kickoff. Actual canonical retained evidence is required to close ingestion proof. G02 applies; default spend is **$0**. Disable new diagnostics/collection configuration while preserving journals and evidence; never erase failures.

### WP-08 — Conservative paper restart and recovery — P1, L

**Finding/task:** F11; restart and reconcile without duplicate submission or silent authority restoration.

**Linear:** reuse COQ-12/14/15. Dependencies: WP-00/WP-01; WP-03 supplies identity checks. Connected exercise also requires reviewed integrated implementation.

**Current source qualification:** [runtime initialization](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main/parallel-paper-runtime.ts:25), lines 25–54, records a runtime build and constructs the service. [persisted status](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/storage/src/repositories/parallel-paper.ts:99), lines 99–105, can remain active across reconstruction. Service lines 336–349 use a paused reconciliation-only branch; active state proceeds through broker validation/reconciliation. This is a **source-backed startup-contract concern**, not observed broker failure.

**Selected change:** First add a process-restart acceptance test. Establish startup/ownership-transfer admission as paused for order submission until reconciliation completes and the owner explicitly Resumes. Preserve durable intent and original client order identity, deadline/lease fencing, delayed-fee accounting, and uncertainty blocks. Reuse the existing broker client restricted to [Alpaca paper origin](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/adapters/src/http/alpaca-paper.ts:5).

**Contracts/migrations:** reuse pause/reconciliation events; add an explicit startup reason and read-state explanation. No new broker adapter or credential schema.

**Rejected:** automatic resubmission, fresh client IDs after ambiguity, automatic Resume, account reset, mocks as broker certification.

**Acceptance:** V07 deterministic process-kill/restart at intent, submission, timeout, fill, fee, cancel, lease-loss, and reconciliation boundaries; not-found remains uncertain where appropriate. Restart cannot submit before manual Resume.

**Proof/gates/rollback:** G01/G07/G08 remain open. Real Alpaca paper cases require a separately approved dedicated account and redacted broker/local comparison; Coinbase/Robinhood checks remain separately owner-gated and read-only. Unobserved cases remain open. Rollback cannot remove the startup submission block; keep experiments paused and preserve the journal.

### WP-07 — Isolated restore certification — P1, M

**Finding/task:** F12B; prove that a backup can restore usable evidence independently.

**Linear:** no exact existing restore issue; create one in milestone 01 after approval. Dependencies: WP-04; reuse WP-03 artifact validators.

**Selected change:** Build a disposable restore verifier around existing backup creation/verification. Copy into a separate destination, validate schema/build compatibility, `integrity_check`, foreign keys, exact ledger totals, immutable record hashes, external archive/report references, and restart behavior. Record profile metadata and credential omissions.

Keep the existing `VACUUM INTO` snapshot mechanism; SQLite documents it as producing a consistent snapshot. [SQLite VACUUM documentation](https://www.sqlite.org/lang_vacuum.html).

**Contracts/migrations:** versioned restore-proof manifest; no replacement backup format unless the exercise demonstrates a concrete gap. No actual-profile restore.

**Rejected:** rebuilding backup machinery; newest-backup wins; checksum/integrity-only certification; automatic overwrite.

**Acceptance/proof:** V08 restores a representative disposable sample; deliberate DB, manifest, artifact, foreign-key, and compatibility corruption fail safely. Source and backup remain unchanged.

**Failure/gates/rollback:** G09 closes only for the tested schema/artifact scope. Quarantine an incomplete destination; remove only disposable outputs after verification. Never downgrade or overwrite the original.

### WP-09 — Operational health and laptop decision hierarchy — P2, L

**Findings/task:** F02/N01/N06; answer “why no decision, what needs attention, and what next?”

**Linear:** new UX issue in milestone 01, related to COQ-5/24. Dependencies: WP-01/02/03 and diagnostic read contracts from WP-05/06/08/07; external proof may remain pending.

**Selected change:** Restore a compact readiness strip using existing selectors and Operations drill-downs. Prioritize safety/paper boundary, current stand-down, next safe action, then chart/depth. Health covers feed age/gaps, scheduler/lease, broker uncertainty, reconciliation, risk, research qualification, and backup proof. Each item carries scope, timestamp, and evidence identity.

**Contracts/migrations:** reuse channels; add only missing read projection fields. No health score, scheduler agent, or migration.

**Rejected:** monolithic green readiness; physiological/HRV scores; mandatory credential modal; hiding decision-critical reasons in the laptop drawer.

**Acceptance/proof:** V02/V03 at 1280/1920 widths, 200% zoom, high contrast, keyboard, and disconnected/partial/stale states. The operator finds blocker, source, and safe next action within two interactions.

**Failure/gates/rollback:** pending proof is displayed as pending. No automatic action follows a health result. Revert layout independently while retaining truthful state semantics.

### WP-10 — Authoritative proposal consequences — P2, L

**Finding/task:** F07; understand modeled costs and exposure before internal paper confirmation.

**Linear:** new proposal-preview issue in milestone 01, related to COQ-12. Dependencies: WP-01, WP-03 identity contracts, WP-08 local safety behavior.

**Selected change:** Compute preview in the authoritative service from existing cost/valuation/risk logic. Bind fee/spread/slippage components, before/after exposure/drift, source times, expiry, and cost identity to proposal revision/hash. Recheck relevant identities and gates at submission.

**Contracts/migrations:** add a typed preview read contract keyed by proposal identity. Existing immutable proposals remain unchanged; historical proposals may have unavailable previews. Persist immutable preview evidence only if needed for review provenance, using an append-only migration.

**Rejected:** renderer-only calculator, universal fee assumptions, stale preview approval, broker authority implied by local simulation.

**Acceptance:** exact-decimal fixtures; missing quote/basis/risk inputs; expiry; changed proposal/portfolio/cost identity; revision mismatch; gate refusal; no duplicate confirmation. Computable consequences appear, unavailable values stay explicit.

**Proof/gates/rollback:** estimates remain modeled, not actual broker fills. G01/G08 govern separate external paper behavior. Disable approval when required preview evidence is unavailable; rollback must preserve backend revalidation.

### WP-11 — Immutable news report provenance — P2, M

**Finding/task:** F10; inspect the exact four-horizon result and its exclusions.

**Linear:** reuse COQ-22. Dependencies: WP-03/WP-06 contracts; insufficient reports are valid inputs.

**Selected change:** Replace scalar authority with a validated report reference binding hash, completion time, source revision, datasets, feature/cost identity, and four horizon outcomes/reasons. Reuse content-addressed reports and existing verification. Provide safe open/export controls and explicit association for archive-only runs.

**Contracts/migrations:** new report-reference/read schema. Persist an append-only association to validated reports. Legacy scalar status becomes “unverified report association,” never fabricated provenance.

**Rejected:** scalar `evaluated` as authority; automatically attaching whichever report is newest; interpreting evaluated as profitable/promoted.

**Acceptance:** V06 covers missing/corrupt/wrong-profile reports, changed inputs, legacy status, archive-only runs, mixed horizon results, and preserved insufficient evidence.

**Proof/gates/rollback:** all displayed results resolve to the same verified report. G02 controls export; G03–G05 still govern qualification. Remove associations/presentation from use without deleting reports or rewriting old settings as success.

### WP-12 — Current status and installed-build identity — P2, M

**Finding/task:** F14B, remaining F14A; identify installed source, schema, channel, and recovery compatibility.

**Linear:** reuse COQ-8/9/13. Dependencies: WP-00/WP-04; acceptance rechecked on the eventual release revision.

**Selected change:** Maintain one current-status index with links to dated evidence. Add About/Release displaying actual packaged version, source/build identity, supported schema, channel, and recovery guidance. Represent review/merge/publication only when independently evidenced.

**Contracts/migrations:** immutable packaged build metadata and a read-only About contract; no DB migration.

**Rejected:** rewriting historical handoffs; inferring publication from version; claiming branch enforcement from workflow files.

**Acceptance/proof:** V09 checks development versus packaged identity, absent metadata, schema compatibility, current notes, and release receipts. Preserve existing artifact/checksum evidence and verify new merged artifacts separately.

**Failure/gates/rollback:** unknown metadata displays unknown; failed release checks block publication. G06 remains open. Revert About/index changes; preserve prior release artifacts and historical records.

### WP-13 — Redacted evidence export, phase A — P2, M

**Finding/task:** N02A opportunity, medium product confidence; share a verifiable diagnosis safely.

**Linear:** new issue in milestone **03 · Prospective studies and data integrity**, related to COQ-22/24. Dependencies: WP-03/06/07/11/12.

**Selected change:** Assemble an allowlisted bundle from existing immutable reports, archive manifests, decisions, outcomes, and diagnostic summaries. Include original hashes plus hashes of sanitized derivatives, exact build identity, omitted fields, rights decisions, and open gates. Export through an explicit native destination.

**Contracts/migrations:** versioned bundle manifest and bounded export command; no raw DB export or DB migration.

**Rejected:** dump-all export; unlicensed article content; account/keychain material; automatic cloud upload.

**Acceptance:** secret/account/path redaction fixtures, rights-denied fields, missing artifacts, hash mismatch, cancellation, interrupted export, and bounded-size failure. Redaction cannot silently change an original artifact’s identity.

**Proof/gates/rollback:** G02/G07 protect content and account evidence. Export does not certify an integration. Disable export without changing originals. **N02B deterministic replay remains a separate later approval**, with no order-capable client.

### WP-14 — Governed read-only experiment workspace — P2, L

**Finding/task:** N03 opportunity, medium product confidence; navigate the existing lifecycle and understand eligibility.

**Linear:** align with COQ-10/17/18; use a UI subissue in milestone 03 without replacing their owner/evidence acceptance. Dependencies: WP-03/09/11/12/13.

**Selected change:** Present dataset qualification, frozen identity, trial ledger, development evidence, candidate/none, holdout state, approved prospective enrollment, actual coverage, and evaluation as read-only stages. Link to exact artifacts and explain blockers.

**Contracts/migrations:** bounded read projections over existing governance repositories. No registration, freeze, holdout, promotion, or date-changing command exposed.

**Rejected:** rebuilding governance; automatic tuning/enrollment; progress inferred from installation/calendar duration; opening sealed performance for a dashboard.

**Acceptance:** V06/V03 cover retired identity, no registration, candidate none, consumed holdout, missing slots, incompatible reports, and inaccessible evidence. Stage labels match authoritative records.

**Proof/gates/rollback:** G03–G05 remain visible. UI tests cannot close elapsed evidence. Disable the workspace without altering events, claims, or registrations.

### WP-15 — Deferred opportunity register — P3, S planning only

**Findings/task:** N04/N05/N07/N08 opportunities; preserve future options without expanding this implementation.

**Linear:** COQ-11 matches N07 documentation workflow; leave it Backlog. No current implementation tickets for planner, tax estimates, or generalized alerts.

**Selected output:** short feasibility entries containing demonstrated operator need, reusable capability, cost, rights/security review, and prerequisites.

**Dependencies:** reliability packages and a later explicit owner selection.

**Contracts/migrations/tests:** none now. Any later scope requires a separate decision-complete plan.

**Rejected/deferred:** physiological readiness/HRV; generalized alerts; extra indicators/models/providers; tax/planner/notebook implementation; cloud/mobile; live execution. No speculative dates or benefit claims.

**Failure/gates/rollback:** lack of demonstrated value means remain deferred. No deployment or data mutation to roll back.

## 4. Validation and gates preserved

### V01–V09

| ID | Required validation and exit |
|---|---|
| **V01** | Genuine cold onboarding, delayed reads, save refusal/unknown, reopening, Escape/focus return, keyboard and macOS VoiceOver. No focus leakage or false saved state. |
| **V02** | Read/command outcome matrix, partial+stale/last-good combinations, profile changes, cancellation, retries and late responses. Unknown/failure cannot become success or confirmed empty. |
| **V03** | 1280/1920 widths, 200% zoom/high contrast, keyboard task “why no decision; what next?” Essential explanation remains discoverable. |
| **V04** | Real-host lag, reconnect/gaps/depth peaks, scheduler overlap, cold and sustained sessions, matched replay and exact book oracle. Unreproduced cause remains open. |
| **V05** | Provider funnel, zero/malformed/paginated/quota responses, duplicates, rights and mapping ambiguity. Real useful evidence must actually be observed. |
| **V06** | Dataset/code/cost hashes, missing venue/day, trial accounting, candidate/none, holdout contamination and elapsed eligible slots. Invalid identity blocks use; no registration or promotion in this roadmap execution scope. |
| **V07** | Owner-approved dedicated Alpaca paper observation, stable IDs, unknown lookup, fills/cancels/fees, process restart, leases and manual Resume. Unobserved broker cases stay open. |
| **V08** | Disposable isolated restore, DB/foreign-key/ledger checks, immutable external artifacts, compatibility, deliberate corruption and credential exclusions. Originals remain untouched. |
| **V09** | Exact source verification/build/package, migration compatibility, applicable signing, review/branch enforcement, artifact hashes, merge and publication receipts. Candidate, merged and published remain separate facts. |

### G01–G09

| ID | Gate retained |
|---|---|
| **G01** | Explicit owner authority for dedicated Alpaca paper account, test scope and limits. |
| **G02** | Documented provider/publisher rights for retained fields, derivatives, quotation and export. |
| **G03** | Immutable compatible strategy, venue, dataset, clock and cost qualification. |
| **G04** | Frozen candidate/none, untouched holdout, recorded exposure and contamination. |
| **G05** | Approved prospective start, genuinely elapsed eligible observations and missing windows. |
| **G06** | Human review, dependency-order merge, verified merged artifact and separate publication. |
| **G07** | Owner-approved intended-host read-only key/permission checks; no Coinbase/Robinhood orders. |
| **G08** | Observed broker identity, lookup, fill/cancel/fee/restart reconciliation and manual Resume; exceptions remain open. |
| **G09** | Schema-compatible isolated restore with DB and artifact integrity and credential exclusions. |

Fixture passes, screenshots, transport successes, and CI do not substitute for these operational gates.

## 5. Approval boundary and delivery defaults

The planning reconciliation is complete. **WP-01 and every other code/document/schema change require explicit approval before starting.** Provider/account exercises, restore exercises, research transitions, and release actions require their separate gates even after code approval.

After authorization, deliver each package as an independently reviewable change on an appropriate `codex/` branch, preserving existing work and assignees. Run focused checks plus required repository validation on the exact final revision. Update matching Linear issues with changes, verification, evidence links, exact originating prompt under **Prompt used**, and a comment ending **Completed by: kokin**. Use In Review while review remains; never close owner, release, rights, or elapsed-evidence gates prematurely.

For this read-only kickoff, **no Linear writes or status changes were made**; the corresponding planning update is pending authorization to leave read-only mode.

Defaults remain: **$0 provider spend, no real credentials, no broker orders, no actual-profile migration/restore, no study creation/registration/promotion, no holdout or start-date changes, no release publication, and live execution hard-disabled.**


