# beta.24 Mac-only release delivery

October 29, 2026, America/Phoenix. The owner authorized committing the recovery fixes and **all current application changes**, then distributing a new macOS-only release. Application integration is committed/pushed as `12f1769`; the cold-start correction and capture-only P7 verifier are committed/pushed as `c6c42de`. Neither beta.22 nor beta.23 is published. Their immutable tags, failures and successful checks remain historical evidence.

Beta.22's clean-checkout tests exposed eager compiled-artifact hashing in disabled reserve startup. Beta.23 corrected that timing without weakening authority. Its full cold-checkout validation passes **359 suites / 2,491 tests**, typecheck and lint, and its locally workspace-built signed package passes startup/migrations/worker checks. A subsequent provenance regression demonstrated another release-path defect: unchanged but stale generated manifests incorrectly appeared clean, and desktop-only packaging did not run the workspace generator. A successful local workspace-first build does not prove a separate fresh-checkout packaging job's embedded identity. Beta.23 therefore remains unpublished rather than substituting locally built files into its pipeline output.

Beta.24 makes desktop builds run the existing workspace generation/build first, detects stale generated content even when Git reports no changes, and checks embedded revision/version consistency inside the packaged smoke. The latter is restricted to `--packaged-smoke`; normal startup, financial eligibility and settings behavior are unchanged. A third real-Git regression demonstrates the stale-clean failure before the fix and acceptance afterward. The packaging gate refuses incompatible identity rather than inventing a fallback.

Version `0.1.0-beta.24`, intended tag `experimental-v0.1.0-beta.24`, **macOS Apple Silicon arm64 only**: DMG, ZIP and SHA-256 manifest. The exact-tag release workflow explicitly selects only that Mac target. Signing remains ad-hoc, without Developer ID notarization. [Release notes](../RELEASE-NOTES-beta.24.md). [Current evidence](evidence/beta24-release/); [prior candidate evidence](evidence/beta23-release/). Final commit, CI, native/package and downloaded-asset proofs and publication status are recorded only from their actual results.

Native P7's beta.23 capture attempt timed out after narrow-layout assertions; it is retained as an incomplete capture, not a pass. Previous beta.22 eleven-check P7/native captures remain historical evidence for unchanged product UI. New matching-source checks and any host limitations are recorded separately. Initial beta.24 pnpm validation refused a module purge without CI/TTY; frozen dependencies were then installed in the disposable workspace before repeating the checks. No user workspace or actual profile was purged.

Full P0–P7 scope remains intact. P5-H actual development research, actual P6-G admission, H1–H6 account/host/credential/financial/dispatch/connected requirements and actual P7-H–J remain pending. No installation, actual profile migration, host/credential change, order/cancel/withdrawal, Resume, study registration/collection/final evaluation or qualification occurs in this task. Unrelated deleted review ZIP, local review files and historical account/session evidence remain preserved outside the distribution selection. No live trading is enabled.

## Prompt used

Pre-tag beta.24 disposable cold-checkout checks pass **359 suites / 2,492 tests** (before all first-party build output), root/renderer typecheck and lint. The frozen production audit reports zero known vulnerabilities. The 3,420-file baseline preservation check finds no missing files and confirms the original roadmap unchanged; intentional source/dependency/build/verifier/current-manifest/tracker changes are enumerated in the receipt. Historical generated manifests were archived before release regeneration; frozen research reports and consumed identities are not edited.

Ok release a new release with all these new updates. mac build only.

Annotation follow-up:

> commit those

Scope clarification:

> No comit those and add all the new changes in the new release.
