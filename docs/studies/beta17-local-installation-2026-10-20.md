# Beta.17 local installation — October 20, 2026

Built and installed the fee-recovery/network-diagnostic changes as **0.1.0-beta.17**
in `/Applications/Coqui.app`. The app is open on Paper Trading → Overview with
the recovery explanation visible. This is a local candidate, not a published
release; source changes remain uncommitted on base `05be901`.

## Artifact and rollback

- Source hash: `c098f325a0209ba4c8a7010a40ce9b6a0c22d6deaf300e94d39663d8de30d299`.
- Installed ASAR SHA-256: `b6a3d2b2ca641e49b880ce23f982825223a798d09114667501aae06889b06d9c`.
- Built macOS arm64 bundle: `apps/desktop/release/local-beta17/mac-arm64/Coqui.app`.
- Previous app preserved at `/Applications/.Coqui-beta16-backup-2026-10-20.app`.
- Consistent pre-install profile backup (private, ignored by Git):
  `apps/desktop/release/install-backups/beta16-profile-before-beta17.db`.
- Staging signature verification and ASAR hash comparison passed before the
  app replacement. Seven installed archive members were independently checked
  against their embedded integrity hashes after extraction.

The build used the project's existing Electron 43.4.1 runtime. An initial
sandboxed packaging attempt could not download a runtime or read pnpm's local
dependency database. The successful package used the existing unpacked runtime
and normal macOS signing tools outside the sandbox. No dependency upgrade or
security override was applied. pnpm's automatic dependency installation was
disabled for these commands; dependencies were already installed and tested.

## Verification in the installed build

1. `/Applications/Coqui.app` was launched through native app control. The UI
   reported its renderer URL under that exact installed ASAR path.
2. The installed executable's isolated packaged smoke passed: SQLite opened,
   schema **95**, packaged news worker loaded. The live profile migrated from
   schema 94 to 95 on normal startup, after its backup was completed.
3. **Retry reconciliation** was clicked in the actual app. It completed without
   enabling trading. The live UI displayed “Position gap exceeds recovery
   limits,” the new fee-shaped valuation (about **$82** at current ask prices),
   both ceilings ($25 and approximately $52.64 at 0.05% of equity), unconfirmed
   fee attribution, and “trading remains paused.” The activity timeline labels
   the event a reconciliation mismatch and records the over-limit explanation.
4. The profile remained **paused**. Submission attempts stayed **14 → 14**;
   zero new attempts occurred during verification. SQLite `quick_check` returned
   `ok`, with zero foreign-key violations. No Resume, broker order, cancellation,
   synthetic fee insertion, or safety-limit change was performed.
5. Executable modules extracted from the installed ASAR passed synthetic fee
   checks: excessive gaps stay blocked, and exact asset-fee evidence can repair
   an active pass without an exception. The original incident replay also passed
   using those installed modules and the read-only profile backup.
6. Installed adapter/observation/projection/contract modules passed synthetic
   `ENOTFOUND`, `ECONNRESET`, and `CERT_HAS_EXPIRED` checks, including secret
   redaction and two bounded GET attempts. No real network failure was induced.
7. Those three messages were rendered through the installed renderer and preload
   in an isolated Electron fixture with installed services, a disposable profile,
   memory-only credentials, and mocked providers. Expected codes and plain-language
   explanations were present; clipping checks passed. The harness needed a fresh
   document per case to avoid retaining the prior case's query state.

The isolated renderer fixture uses the project's matching Electron runtime to
load `/Applications/Coqui.app/Contents/Resources/app.asar` assets. This is separate
from the actual installed-app/live-profile check above. Its synthetic failures
are not evidence that those network faults occurred on the real connection.

The existing quantity gap is still unresolved in actual broker evidence. The
installed app correctly keeps it blocked; installation does not imply fee
attribution or permission to bypass reconciliation.

## Evidence

- [Installation identity](../implementation/evidence/oct20/beta17-installation.json)
- [Build log](../implementation/evidence/oct20/beta17-build.log)
- [Package log](../implementation/evidence/oct20/beta17-package.log)
- [Installed smoke](../implementation/evidence/oct20/installed-smoke.log)
- [Installed member integrity](../implementation/evidence/oct20/installed-member-integrity.json)
- [Installed module checks](../implementation/evidence/oct20/installed-module-checks.json)
- [Installed incident replay](../implementation/evidence/oct20/installed-incident-replay.json)
- [Live recovery state](../implementation/evidence/oct20/installed-live-recovery.json)
- [Installed-renderer fixture checks](../implementation/evidence/oct20/installed-ui/checks.json)
- [Prior full source verification](fee-recovery-network-fix-2026-10-20.md): 1,854
  tests, typecheck/lint/build, smoke, and additional generated-manifest/golden checks.

No public release, remote CI certification, merge, study registration, human
VoiceOver certification, or complete connected-account lifecycle is claimed.
COQ-12 and COQ-13 retain their unmet review/release/operational gates.


Screenshot provenance update during beta.18 verification: a fixture output-path
collision briefly replaced the beta.17 UI evidence directory. The beta.18
artifacts now have their own versioned directory. The three beta.17 network
screenshots and checks were regenerated from the preserved beta.17 rollback
ASAR in a disposable profile, not from the current beta.18 installation. The
original BETA17 checksum manifest remains historical; regenerated UI checksums
are in `BETA17-UI-RECHECK-SHA256SUMS.txt`, with execution output in
`beta17-rollback-ui-recheck.log`. No actual profile or provider was accessed.

## Prompt used

> This is the newest build of the app, do some debugging and review the code to find out what is cauisng these issues. take control of my currently open Coqui Crypto app to review all the data

> Fix the issues you found, improve the fee reconciliation without weakening the safety checks, and add better error messages so we can diagnose the network failures.

> Build and install the updated app so I can use the fixes, then verify the fee reconciliation and new error messages in the installed build.
