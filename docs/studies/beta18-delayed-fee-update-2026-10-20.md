# Delayed fee evidence: beta.18 local installation

## Prompt used

> Fix the app to handle delayed fee reporting properly without weakening the safety checks, then build, install, and verify the update.

## Changes

Recovery now identifies a conservative possible delayed-fee pattern after a full activity audit and an exact comparison. The UI shows **Waiting for fee evidence**, affected fill age, and a review threshold derived from the immutable trade timestamps. At the second UTC midnight after the oldest affected trade day, the state becomes **Fee evidence overdue · review Alpaca**. That threshold is a review reminder, not a provider SLA or permission to trade. Network errors and unexplained quantities remain their own failures.

The former minor fee-shaped exception was tightened: no new estimated-fee position checkpoints are created, at any value. Existing checkpoints remain in history but cannot satisfy the position validator. Actual reported asset fees must explain quantities exactly. Cash-only reports and unmatched partial fees cannot clear recovery. No journal rewrite, synthetic fee booking, tax-lot adjustment, or automatic Resume was added. Order identity, ambiguous-submission recovery, full audits, account checks, deadlines, execution authority/leases, kill switch, and fresh order-price guards remain enforced.

Classification is diagnostic only, using Decimal quantities and the existing frozen taker-fee hypothesis. It does not require fresh market quotes or prior fee publication, so the first trade can show the pending explanation. Unsupported assets, invalid/future timestamps, mixed buy/sell days, and other rates remain unexplained mismatches. Partial publication can reconcile one asset while other assets remain pending; unmatched partial evidence stays blocked until exact accounting is possible.

## Verified source and build

The shared checkout contained concurrent activity-screen changes during this task. A managed worktree isolated the fee/network changes from those unfinished edits; the build does not include them. The selected source files and base are recorded in [beta18-build-snapshot.json](../implementation/evidence/oct20/beta18-build-snapshot.json). The completed worktree was archived with a recoverable Git snapshot after the packaged application was preserved outside it. The primary checkout retains the implementation and concurrent work.

- Version: **0.1.0-beta.18**, macOS arm64, installed at `/Applications/Coqui.app`.
- Base revision: `05be901e50600b8f77512e28a62659bbf4a73e5b`; local modified source, not a merged or public release.
- Built source SHA-256: `69e8a4a67c5001c2d48a81cb807c1d3706176ec780d6b15501b2b69d437d7f0e`.
- Packaged and installed ASAR SHA-256: `fe2646829fa5a08a8533144991b516d08358339706b61f9ab136664dda19bb61`.
- Rollback app: `/Applications/.Coqui-beta17-backup-before-beta18-2026-10-20.app`.
- Consistent private preinstallation profile backup: `apps/desktop/release/install-backups/beta17-profile-before-beta18.db`, mode 0600, ignored by Git.

The isolated source passed `pnpm verify` under explicitly selected **Node 24.15.0**: typecheck, lint, **274 test files / 1,858 tests**, and root build. Desktop compilation and local Electron packaging completed. An initial run selected unsupported Node 22 from the elevated environment; it was stopped and superseded by the complete Node 24 run. The final build refreshed source manifests without registering, restarting, or validating any research study.

## Installed verification

The staged and installed bundles passed deep strict code-signature verification. Both executables passed an isolated packaged smoke: SQLite opened, schema **95**, packaged news worker loaded. The installed archive matches the verified package exactly; selected member hashes are retained.

A disposable-profile fixture loaded the actual installed adapter, validator, renderer, preload, and status contract under the matching Electron runtime. It verified:

- Pending fees and overdue evidence both remain blocked.
- Historical allowances, cash-only fees, and unmatched partial fee reports cannot waive a gap.
- Matching actual-format fee records reconcile exactly, with no double deduction on repeat checks.
- Recovery displays ready to resume while still paused.
- `ENOTFOUND`, `ECONNRESET`, and `CERT_HAS_EXPIRED` retain their safe codes and render useful explanations.
- All six renderer states passed text-clipping checks.

These fee and network cases are controlled fixtures; no synthetic record or network fault was introduced into the user's account. Source service integration tests separately exercised the full ingestion/deduplication flow, partial publication, blocked premature Resume, unchanged submission count during recovery, and manual Resume after exact fees arrived.

REA captured the installed fixture run as `ev_c0221ef0bedea3197bd3700857633d380af61c79484276620cc65e6602565bdf`. This is a process capture of controlled application-level checks, not packet tracing or proof that a real provider published fees.

In the actual installed app, native app control opened Paper Overview and clicked **Retry reconciliation**. The UI changed to **Waiting for fee evidence**, displayed the actual affected fill age and review threshold, and retained the block. Later automatic scheduler audits also recorded the pending state. The profile remained paused, with submission attempts **14 → 14**, no new Resume event, and no new position allowance. Every historical experiment journal event from the preinstallation backup was still present and unchanged. SQLite `quick_check` returned `ok`; foreign-key violations were zero.

The actual account still lacks matching fee evidence. Real provider publication and subsequent end-to-end exact recovery remain unobserved; the installed app is ready to perform that recovery without relaxing its checks. No live order, paper submission, cancellation, or manual Resume was performed in the user's account. Unrelated research source-identity and release acceptance gates remain open.

## Evidence

- [Full source verification](../implementation/evidence/oct20/beta18-verify.log), [desktop build](../implementation/evidence/oct20/beta18-desktop-build.log), [packaging](../implementation/evidence/oct20/beta18-package.log).
- [Preinstallation backup/state](../implementation/evidence/oct20/beta18-preinstall-state.json), [atomic installation](../implementation/evidence/oct20/beta18-installation.json).
- [Packaged identity/smoke](../implementation/evidence/oct20/beta18-packaged-checks.json), [installed identity/smoke](../implementation/evidence/oct20/beta18-installed-checks.json).
- [Installed fixture script](../implementation/evidence/oct20/beta18-installed-checks.mjs), [renderer checks](../implementation/evidence/oct20/beta18-installed-ui/checks.json), [REA capture](../implementation/evidence/oct20/beta18-installed-rea-evidence-v2.json).
- [Actual profile recovery evidence](../implementation/evidence/oct20/beta18-live-recovery.json).

COQ-12 and COQ-13 retain review and release gates. Linear updates contain progress and software verification only; private broker/account details remain local.
