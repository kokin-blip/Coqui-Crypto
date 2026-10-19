# October 19 remediation delivery

Local integration branch: `codex/oct19-review-integration`. Validated application source: `b14da3de77df16821d6042d4c446620bc2af1de5`. Build source hash: `da161324d68a65c1d140ef0a05e493172cb805bcec9f7a675726eac8ccb5ad65`. Source, test and evidence commits are local only; no PR was published, no PR/main branch merged and no release created. The local integration merge is intentional.

## Changes and integration

- Integrated sibling news recovery #12 (`6cde2c6`) with the #8–11/#13 ancestry. Resolved ingestion runtime conflicts by retaining immutable diagnostics alongside transport and safe error diagnostics. Regenerated source provenance after integration.
- Schema 94 adds append-only report-location selections referencing existing report/profile associations. Original associations remain immutable. Profile clones exclude selected locations before their source associations and export permissions; the source file and all three immutable histories remain unchanged, and the clone must independently associate/select its report. Operators select a file and supply the expected report content hash; missing association, hash/schema mismatch, corruption and unavailable artifacts refuse safely. Unexpected database-write errors report uncertain completion and keep blind retries fenced. Duplicate valid selections report already-selected; implicit relocation through the old API now refuses rather than silently ignoring a write. Resolution revalidates the selected location without automatic fallback or newest-file scanning.
- Recovery offers native selection and isolated copy verification with exact DB/ledger/event checks and explicit exclusions. This UI proof is DB-only. It does not claim credentials, metadata, archives, reports, broker operation or process restart certification. A separate visibly simulated walkthrough explains refusal, uncertain completion, pause and recovery without creating commands or evidence.
- Existing readiness prioritizes safety/reconciliation, unavailable operational evidence, feed state and research qualification after setup. Paper uncertainty is visible outside setup details; supporting timestamps/ages, plain explanations and technical evidence remain inspectable through existing destinations.
- News health separates retained ingestion from prospective features and relevant syndicated-story contribution. It reports receipt-to-persistence and analysis-publication lag, contributing/exclusive groups, observed failures/pending attempts and unknown missing-slot/first-page coverage. Inserted rows cannot imply useful research coverage. No provider, model or default activation was added.
- Reproduced the Activity focus race by delaying route focus after detail focus. Cancelled/guarded route callbacks preserve already accepted focus; the detail heading focuses when it actually mounts. Close returns to a surviving opener or fallback heading. A separate 65-second check observes the normal 60-second Activity feed poll, verifies a later snapshot arrived, and preserves focus on the Close control before returning to the opener.
- Diagnosed silent full-suite output: Vitest 4.1.8 auto-selects the minimal `agent` reporter under Codex, suppressing successful files. Explicit standard reporting restores progress without changing assertions, worker limits or retries.
- Diagnosed a performance-harness confound: shared Electron browser storage made the first `sessionStorage` read take approximately four seconds. A controlled isolated-browser trace reduced chart wait from roughly 4.4 seconds to 394 ms. The harness now isolates browser/session data as well as its generated application database. This is a benchmark repair; it does not certify actual Main responsiveness.

Local implementation commits: `8525f0f` (integration), `94fe46e` (repairs/projections/fixtures), `d6fdefb` (cold-process timing), `c0fc5ac` (regenerated provenance), `437eeec` (exact schema/channel expectations), `0f7d48b` (visible Recovery inputs and reporter), `d79f059` (browser-storage isolation), `0202177` (uncertain database-write classification), `bca9a0e` (clone permission boundary and regenerated provenance), `b14da3d` (channel test lint limit).

## Evidence and acceptance

| Work | Result and scope | Evidence |
| --- | --- | --- |
| Explicit relocation | Pass: original location unavailable, copied location selected, two new process reconstructions, original/negative history retained, zero orders | `evidence/oct19/restore-restart/checks.json`; report-association and Recovery-command regressions |
| Negative artifacts | Pass: wrong profile/hash, corrupt/missing/incompatible artifact, duplicate selection, historical read and no fallback; immutability triggers retained | `tests/news-report-association.test.ts`, `tests/recovery-commands.test.ts` |
| Integration compatibility | Pass: schema upgrades/backups, observation v1/v2 storage/archive paths, profile cloning/isolation, report association, export permissions and fail-closed execution | Full suite and focused regressions |
| Readiness / Recovery | Pass: keyboard focus, 1280 width, 200% zoom, visible inputs, operational primary action and loading/error/partial states | `evidence/oct19/ui/checks.json` and screenshots |
| Activity focus | Baseline failure reproduced; fixed behavior passes the same delayed-route check and stock smoke | `precommit/ui/baseline-focus.json`, final UI checks and `ui-poll/checks.json` |
| Human VoiceOver / contrast | Not certified. Walkthrough prepared; screenshots/DOM do not establish speech | `oct19-owner-sessions.md` |
| Actual-profile restore / installed representative archives | Not run; owner inventory/authorization and representative certification remain open | Owner session scope; fixture proof explicitly excludes actual profile certification |
| News fixture chain | Pass: due synthetic slot → analysis → verified GDELT-only archive → four honest insufficient-evidence reports → explicit association, zero orders | `evidence/oct19/news-chain.json` |
| Actual news chain | Unmet: five retained observations, two successful requests, twenty failures, one reserved attempt; zero analysis/features in inspected Main | `evidence/oct19/read-only-inventory.json` |
| Research registration | No remediation registration found in inspected Main; original proposal unchanged; separate unregistered future proposal prepared | Read-only inventory; `docs/studies/execution-remediation-future-proposal-v2.json` |
| Safeguards / remote CI | Existing #12/#13 CI/package jobs successful; combined local candidate has no remote CI. Rulesets empty; protection read 403 means unverified | `evidence/oct19/remote-reconciliation.json` |
| Exact-source performance | Pass: five fresh processes and completed 30-minute synthetic feed; memory growth and instrumentation limits reported | `evidence/oct19/performance/summary.json`; `oct19-measurements.md` |
| Local macOS candidate | Built and packaged smoke passed; exact source identity and SHA-256 recorded. Windows/actual installation/release remain open | `evidence/oct19/package.json`, packaged smoke log |

Final UI, package, full-suite, restart, news-chain and performance receipts bind to `b14da3d` and its build source hash. Earlier UI and source receipts remain in the evidence history. `source-0202177/` contains the completed earlier 30-minute run; it is supplementary evidence, not a substitute for final-source validation.

## Verification and measurements

Final command receipts and measurement summary are recorded in `evidence/oct19/verification.json` and `oct19-measurements.md`. Earlier failed integrated tests and preliminary harness runs are retained and labelled; a passing retry is not used as diagnosis. The initial full-suite failures were exact schema/table/channel expectations changed by the new migration/commands; those assertions were updated, and new commands joined the existing secret-leak sweep. No assertions were relaxed.

The five fresh-process runs use generated data, 2,000 bars, twelve navigation cycles, forty IPC samples and 120 input-to-paint samples. Browser/session data is disposable; OS file caches are not forcibly flushed. CPU/heap and event-loop instrumentation changes the workload, and a short isolated Ionic trace overlaps the opening minute and the final exact-HEAD suite overlaps approximately minutes 5–8 of the final soak. These receipts establish this workload on this Mac, not lower-powered hardware or actual-market responsiveness.

The final-source 30-minute isolated-browser workload completed with exit 0, matching clean build/workload identities and all existing gates passing. It retained 32 memory samples at 31 unique minute positions. Renderer forced-GC heap grew 3.98 MiB including measurement arrays; no application-only leak attribution or leak-free certification is claimed. See the measurement table and raw receipt. Superseded runs remain historical evidence.

## Research reconciliation and remaining owner actions

Main remains at schema 91; it was opened only through read-only SQLite metadata queries. No runtime was initialized against it, no credentials accessed, and no migration/restore, request, order or research transition performed. No sealed holdout or performance body was read.

Three hourly registrations are separate from remediation. At the recorded development cutoff, each has zero observations against 321 elapsed hourly slots; the latest has five failure records. Their registered behavior identities do not match the integrated source. A missing remediation registration establishes no authorized remediation clock: valid prospective slots are zero and expected slots are not applicable. External/uninspected stores remain unverified.

The October 15 remediation window cannot qualify from the inspected evidence; no retrospective registration is allowed. The successor keeps the original design and trial history, with dates/profile/experiment/approval unset. A 365-day/30-rebalance rule is not silently adopted.

Specific remaining owner decisions are documented in `oct19-owner-sessions.md`: human review/VoiceOver, an actual recovery inventory and isolated-certification scope, approval for actual Main migration plus local GDELT rights/scheduled analysis needed for one bounded natural news chain, future research registration, effective safeguard settings, Windows matching-host checks and any release approval. Connected-account/order authority is neither requested nor inferred. Existing acceptance gates stay open.

Exact originating and scope-changing prompts are preserved in `oct19-originating-prompts.md` and included under **Prompt used** in Linear updates. Existing assignees, dependencies, milestone history and the completed review-delivery status of COQ-24 are preserved.
