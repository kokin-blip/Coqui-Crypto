# beta.24 Mac-only release delivery

October 29, 2026, America/Phoenix. The owner authorized committing the recovery fixes and **all current application changes**, then distributing a new macOS-only release. Application integration is committed/pushed as `12f1769`; the cold-start correction and capture-only P7 verifier are committed/pushed as `c6c42de`. Neither beta.22 nor beta.23 is published. Their immutable tags, failures and successful checks remain historical evidence.

Beta.22's clean-checkout tests exposed eager compiled-artifact hashing in disabled reserve startup. Beta.23 corrected that timing without weakening authority. Its full cold-checkout validation passes **359 suites / 2,491 tests**, typecheck and lint, and its locally workspace-built signed package passes startup/migrations/worker checks. A subsequent provenance regression demonstrated another release-path defect: unchanged but stale generated manifests incorrectly appeared clean, and desktop-only packaging did not run the workspace generator. A successful local workspace-first build does not prove a separate fresh-checkout packaging job's embedded identity. Beta.23 therefore remains unpublished rather than substituting locally built files into its pipeline output.

Beta.24 makes desktop builds run the existing workspace generation/build first, detects stale generated content even when Git reports no changes, and checks embedded revision/version consistency inside the packaged smoke. The latter is restricted to `--packaged-smoke`; normal startup, financial eligibility and settings behavior are unchanged. A third real-Git regression demonstrates the stale-clean failure before the fix and acceptance afterward. The packaging gate refuses incompatible identity rather than inventing a fallback.

Version `0.1.0-beta.24`, intended tag `experimental-v0.1.0-beta.24`, **macOS Apple Silicon arm64 only**: DMG, ZIP and SHA-256 manifest. The exact-tag release workflow explicitly selects only that Mac target. Signing remains ad-hoc, without Developer ID notarization. [Release notes](../RELEASE-NOTES-beta.24.md). [Current evidence](evidence/beta24-release/); [prior candidate evidence](evidence/beta23-release/). Final commit, CI, native/package and downloaded-asset proofs and publication status are recorded only from their actual results.

Native P7's beta.23 capture attempt timed out after narrow-layout assertions; it is retained as an incomplete capture, not a pass. Previous beta.22 eleven-check P7/native captures remain historical evidence for unchanged product UI. New matching-source checks and any host limitations are recorded separately. Initial beta.24 pnpm validation refused a module purge without CI/TTY; frozen dependencies were then installed in the disposable workspace before repeating the checks. No user workspace or actual profile was purged.

Full P0–P7 scope remains intact. P5-H actual development research, actual P6-G admission, H1–H6 account/host/credential/financial/dispatch/connected requirements and actual P7-H–J remain pending. No installation, actual profile migration, host/credential change, order/cancel/withdrawal, Resume, study registration/collection/final evaluation or qualification occurs in this task. Unrelated deleted review ZIP, local review files and historical account/session evidence remain preserved outside the distribution selection. No live trading is enabled.

Pre-tag beta.24 disposable cold-checkout checks pass **359 suites / 2,492 tests** (before all first-party build output), root/renderer typecheck and lint. The frozen production audit reports zero known vulnerabilities. The 3,420-file baseline preservation check finds no missing files and confirms the original roadmap unchanged; intentional source/dependency/build/verifier/current-manifest/tracker changes are enumerated in the receipt. Historical generated manifests were archived before release regeneration; frozen research reports and consumed identities are not edited.

## Publication and acceptance record

**Published:** [experimental-v0.1.0-beta.24](https://github.com/kokin-blip/Coqui-Crypto/releases/tag/experimental-v0.1.0-beta.24), October 29, 2026 at 18:11:20 America/Phoenix (`2026-10-30T01:11:20Z`). Experimental prerelease, not marked latest. Source/tag is [b33ddcf6680f5973591f4c4d288117e8be0b6d36](https://github.com/kokin-blip/Coqui-Crypto/commit/b33ddcf6680f5973591f4c4d288117e8be0b6d36), following the integrated application/recovery commit `12f1769` and cold-start fix `c6c42de`. Branch and peeled remote tag identities were verified. All 55 selected file bytes match the source commit (41 paths changed relative to its parent). There are no omitted application changes from the authorized integration.

- Exact-tag [Release workflow](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/40982962028) passes full verification, Mac arm64 package, packaged smoke, asset upload and draft download checks. Exact-tag [CI](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/40982962091) passes full verification, Electron smoke/performance and native keyring/DuckDB on its three test hosts. Only the Mac installer target was distributed.
- Local matching-source native safety/focus/fullscreen and performance pass: useful shell 178.0 ms, interaction p75 9.0 ms; the injected sensitivity control breaches 200 ms at 250.5 ms. Prospective checks **11**, sale checks **18** and Activity checks **37** pass. P7/sale captures use software rendering and remain UI checks, not performance or actual account proof. Contrast/zoom and sale consequence images were visually inspected. Prior hardware capture failures remain retained.
- The first sale capture failed without logging unavailable reasons. Investigation found its two clock reads could date a synthetic mark after capture time; a controlled future-mark probe demonstrates correct refusal with `sale_profit_evidence_unavailable` / `paper_current_marks_unavailable`. The verifier now uses one shared timestamp and logs the full response. All 18 original assertions pass without weakening them. This **post-tag verifier-only correction** and final receipts do not change the built product or move the tag. The original failure, diagnostic pass, expected negative probe and coherent-fixture pass remain separate.
- Downloaded ZIP and read-only mounted DMG both verify **77 compiled runtime members**, including all 66 renderer JS/CSS assets, preload, renderer entry and critical Main/core/services/storage modules against the locally tested compilation. Source hash `79833b1ed228af6dc6ac20557dc4063e2a4dc09fea9b56453f4bd3570f80955a`, Main revision and compiled research revision agree with the tag; source is clean. Both contain patched Zod 4.6.6, verified ad-hoc signatures, denied arbitrary transport and no camera/microphone capability. Both run disposable packaged startup with schema100, worker load and provenance checks passing. The DMG was unmounted afterward.
- Three assets only: `Coqui-0.1.0-beta.24-mac-arm64.dmg`, ZIP and `SHA256SUMS.txt`. Anonymous public downloads return HTTP200 and match both GitHub's recorded digests and the manifest. [Public receipt](evidence/beta24-release/public-download-verification.json), [ZIP proof](evidence/beta24-release/downloaded-zip-proof.json), [DMG proof](evidence/beta24-release/downloaded-dmg-proof.json), [manifest](evidence/beta24-release/SHA256SUMS.txt).

DMG SHA-256: `773cd4571e21bfca5d5bd1e5a3eaeaa81a059358c38cad02d826c432cca4ed38`.

ZIP SHA-256: `5826b5e605c43aafd631469decbc06eb03da552e45718459b7130d55095c0d6e`.

Publication is complete; merge, human review/VoiceOver, actual-market latency, representative actual-profile restore and all remaining account/research/qualification requirements are separate and remain pending. No application installation or financial/research action was performed. Ad-hoc signing is not Developer ID notarization. Source and evidence are released at the stated scope, not certification of P0–P7's unmet gates.

## Prompt used

Ok release a new release with all these new updates. mac build only.

Annotation follow-up:

> commit those

Scope clarification:

> No comit those and add all the new changes in the new release.
