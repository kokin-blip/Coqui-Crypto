# Exact originating prompts

## Initial request

Improve Coqui-Crypto by implementing the recommendations from the October 19, 2026 review recorded in Linear COQ-24.

Repository:
/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto

Work through implementation and verification, not just planning. Follow AGENTS.md, preserve existing user changes, and update matching Linear issues with the exact originating prompt, changes, verification, evidence links, and remaining acceptance gates.

First reconcile the current checkout, open PRs, CI, and Linear issues. The review baseline was e34e07b; do not assume it remains current. Reuse existing implementations and avoid duplicating capabilities already present.

Prioritize the following work.

1. Repair restored-report relocation — COQ-27

News report associations store absolute paths. INSERT OR IGNORE prevents changing the location for the same report/profile, while the API can return apparent success.

Implement explicit, append-only artifact-location records and truthful command outcomes. Require an operator-selected location and validate report hash, schema, and profile association. Preserve original immutable associations.

Acceptance:
- A restored report resolves from its copied location after the original location is unavailable.
- Resolution survives two separate process restarts.
- Wrong-profile, wrong-hash, corrupted, missing, and incompatible artifacts fail safely.
- No silent ignored relocation, overwritten history, automatic newest-file selection, or order creation.
- Keep actual-profile restore certification separate from disposable fixture results.

2. Prepare a coherent integration candidate

Review the current equivalents of PRs #8–13 and their dependencies. At review time, news recovery PR #12 diverged from workstation/recovery PRs #11/#13.

Prepare an integration branch containing the intended compatible changes. Resolve conflicts deliberately, regenerate provenance from the integrated source, and test schema migrations, backups, news observation versions, report associations, and permission boundaries together.

Inspect current CI and branch safeguards. Fix demonstrated source/workflow defects and prepare reviewable safeguard recommendations where repository-setting changes need owner approval.

Do not merge or publish. Bind validation and package evidence to the exact integration revision.

3. Reconcile research registration and coverage — COQ-10/17/18

The saved remediation proposal required registration before October 15, 2026 and remained marked proposal_not_registered.

Inspect available authorized registration and observation evidence. Determine whether a valid registration existed before its deadline.

If none existed:
- Preserve the original proposal as historical evidence.
- Explain why its original window cannot qualify.
- Prepare a separate future registration proposal for owner approval.

Do not register retrospectively, backfill prospective observations, silently change dates, open sealed holdouts, reuse consumed holdouts, or promote an unvalidated strategy. Report actual coverage and gaps without inferring collection from installed code.

4. Improve the existing readiness experience — COQ-28

Make the main readiness view answer:
- What is blocking progress?
- What evidence supports that state, and how old is it?
- What can the user safely do next?

Let operational blockers influence the primary action after setup is complete. Surface relevant paper-reconciliation uncertainty without requiring users to discover it inside setup details. Translate internal reason codes into useful explanations while retaining inspectable technical evidence.

Reuse existing readiness, Operations, Research, and Recovery surfaces. Avoid competing checklists or invented health scores.

Verify keyboard access, 1280-width layout, 200% zoom, loading/error/partial states, and truthful command outcomes. Prepare a human VoiceOver walkthrough; do not claim spoken-announcement certification from DOM or screenshot checks.

5. Establish useful news-data evidence — COQ-19–22

Extend existing diagnostics where needed to show:
- Last successful ingestion and last eligible feature.
- Observation and analysis lag.
- Missing coverage and gaps.
- Useful unique-story contribution.
- Explicit unknown states where coverage is unproved.

Preserve provider rights, quotas, transport provenance, and default-disabled behavior. A successful HTTP response or inserted-row count must not imply research usefulness.

Verify a naturally scheduled observation → analysis → report chain only within existing authorization. Otherwise complete deterministic fixtures and prepare the smallest concrete operational session needed. Do not add providers or predictive models before this path is demonstrated.

6. Improve test and performance confidence — COQ-5/6/7/9/13

Investigate why the review’s full-suite run emitted no completed-test results before it was stopped. Reproduce and diagnose the intermittent Activity-focus failure; do not weaken assertions or hide failures with retries.

Measure cold startup, representative navigation, input-to-paint, IPC/event-loop delay, and memory retention using reproducible workloads. Measure the actual loading cost of the large Ionic chunk before changing framework architecture.

Make targeted fixes supported by measurements. Preserve financial calculations, historical corrections, event ordering, query cadence, and safety behavior.

7. Extend recovery guidance and disposable learning tools

After the core repairs, extend the existing Recovery experience with an operator-selected isolated verification workflow, explicit included/excluded artifacts, and readable proof results.

Reuse disposable fixtures for a clearly labeled walkthrough of refused commands, uncertain completion, paused execution, and safe recovery. Keep simulated evidence visibly separate from actual operational proof.

Execution boundaries:
- Proceed autonomously with source fixes, reversible local integration, disposable fixtures, and validation.
- Reuse existing authorization; do not ask for it again.
- Prepare concrete, reviewable work before requesting any genuinely missing authorization.
- Do not access credentials, activate paid providers, place/cancel broker orders, restore or migrate actual profiles, change research authority, alter branch protections, merge, or publish without applicable authorization.
- Keep live execution hard-disabled.
- Preserve immutable evidence and existing fail-closed controls.

Validation:
Run typecheck, lint, the full test suite, root and desktop builds, and relevant native/package checks. Add focused regression tests for meaningful defects. Record failures and incomplete checks honestly. Fixtures do not close human, connected-account, elapsed-evidence, or release gates.

Final delivery:
- Summarize what changed and why.
- Link commits, draft PRs, measurements, and verification evidence.
- State which acceptance criteria passed and which remain open.
- List only the specific owner actions still needed.
- Synchronize the matching Linear issues without marking unmet gates Done.

## Execution follow-up

PLEASE IMPLEMENT THIS PLAN:
# Coqui-Crypto October 19 remediation

## Reconciled baseline

Local HEAD remains `e34e07b`. Preserve modified `AGENTS.md` and existing untracked review/output files. PRs #8–13 remain open at the reviewed heads; #12 contains three sibling commits absent from this checkout. Both #12 and #13 have successful individual CI/package receipts, but their combined source remains unvalidated. Rulesets return empty; branch-protection inspection returns 403 and remains unverified.

Baseline verification completed: **267 test files / 1,787 tests passed in 177.92 seconds**. The earlier silent run was not reproduced. Implementation and Linear updates await execution mode.

## Implementation sequence

1. **Prepare the local integration candidate.**
   - Create `codex/oct19-review-integration` from the verified operational-evidence head; integrate #12’s compatible news recovery commits, retaining the existing #8–11 ancestry.
   - Resolve the ingestion-runtime conflict by preserving durable diagnostics alongside transport/error handling. Combine compatibility tests and regenerate provenance from integrated source rather than selecting either branch’s generated hashes.
   - Keep integration local: no push, merge, publication, or repository-setting changes.

2. **Repair report relocation first — COQ-27.**
   - Add the next append-only migration for explicit artifact-location selections tied to an existing report/profile association. Preserve every original association and historical location.
   - Require an operator-selected file and expected report hash. Validate schema, content/manifests, compatibility, and the existing profile association before recording a location.
   - Return typed recorded, already-selected, cancelled, and refused outcomes through existing command infrastructure. An ignored insert must never appear successful.
   - Resolve using the explicitly selected location for the associated report. Revalidate on reads; never scan directories, choose the newest file, or silently fall back from an invalid selection.
   - Extend Recovery with native file/destination selection, isolation checks, included/excluded artifact inventory, and readable proof results. Use only disposable profiles during implementation.

3. **Reconcile registration evidence — COQ-10/17/18.**
   - Inspect available authorized registration and observation records through read-only access, without initializing runtimes or migrating actual databases. Inspect identities and coverage metadata without loading sealed performance bodies.
   - Report evidence inspected, unavailable evidence, registration timing, identity matches, and observed/expected coverage separately. Missing evidence remains unknown.
   - If no valid pre-deadline registration exists, preserve the original proposal unchanged and explain why later registration cannot qualify its October 15 window.
   - Prepare a separate unregistered successor proposal for owner approval. Preserve the original experimental design and trial history; leave future dates and profile binding explicitly pending owner selection. Do not adopt new qualification criteria automatically.

4. **Improve readiness and news evidence — COQ-28 and COQ-19–22.**
   - Reuse current readiness channels and surfaces. After setup completes, prioritize safety/reconciliation blockers, unavailable operational evidence, feed problems, then research qualification; each primary action navigates to existing evidence or recovery.
   - Show paper uncertainty outside collapsed setup details. Present plain explanations, source timestamps, evidence age, and inspectable reason codes. Unknown channels must not imply readiness.
   - Extend `news.health` with distinct successful-ingestion and eligible-feature timestamps, observation/analysis lag, observed gaps, unique-cluster contribution, and explicit unknown coverage.
   - Replace the current inserted-row interpretation of “useful” with evidence derived from eligible analysis and story clustering. Preserve quotas, rights, transport provenance, and disabled defaults.
   - Verify a natural operational chain only where existing authorization covers every step; otherwise deliver deterministic fixtures and a concrete minimal session proposal.

5. **Diagnose reliability and measure performance.**
   - Record full-suite discovery/import/test timings and compare default versus verbose reporting without changing assertions or introducing retries.
   - Reproduce Activity focus under delayed reads, polling updates, and route transitions; retain failure traces and add a deterministic regression for any demonstrated defect.
   - Extend existing isolated performance harnesses: five fresh-process launches, twelve navigation cycles, representative input-to-paint and IPC measurements, event-loop delay, and a 30-minute retention soak.
   - Measure Ionic chunk loading, parsing, execution, and first-interaction cost before proposing architectural changes. Make only measurement-supported fixes.
   - Add clearly labelled disposable Recovery walkthrough states for refusal, uncertain completion, paused execution, and safe recovery.

## Verification and acceptance

- Relocation: original path unavailable, copied report resolves after **two separate process restarts**; immutable history retained; wrong profile/hash, corruption, missing files, incompatible schema, and duplicate selection handled truthfully; zero orders created.
- Integration: supported migration paths and pre-migration backups, observation v1/v2 reads, report associations, export permissions, profile isolation, and fail-closed controls tested together.
- UI: keyboard navigation/focus, 1280-width layout, 200% zoom, and loading/error/partial/unknown states. Extend the existing human VoiceOver walkthrough; automated checks do not certify spoken announcements.
- Run typecheck, lint, full suite, root and desktop builds, Electron smoke/performance, native keyring loading without credential access, native DuckDB, and local matching-host package checks.
- Bind receipts to the exact tested source revision, source/workload hashes, environment, artifact checksums, and simulated/operational classification. Record unavailable platform checks and failures explicitly.

## Delivery and remaining gates

Commit reviewable local changes and evidence; prepare a PR description without publishing it. Recheck source identity after provenance generation and rebuild whenever source changes.

Update matching Linear issues with the **complete exact originating prompt** under **Prompt used**, changes, verification, evidence links, and remaining gates; end completion comments with **Completed by: kokin**. Preserve assignees, dependencies, and historical evidence. Use In Review where review remains; keep unmet operational and release gates open.

Owner actions are limited to concrete outstanding gates: human review/VoiceOver, inaccessible safeguard settings and approval, successor research registration, and any specifically unauthorized operational or actual-profile verification session. Live execution remains hard-disabled.
