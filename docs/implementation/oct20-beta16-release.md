# beta.16 macOS release — October 20, 2026

Published experimental prerelease: [Coqui 0.1.0-beta.16 — macOS Apple Silicon](https://github.com/kokin-blip/Coqui-Crypto/releases/tag/experimental-v0.1.0-beta.16). Publication time: `2026-10-20T08:31:16Z` (UTC). This release contains only macOS Apple Silicon arm64 installers; Windows is intentionally deferred for this version.

## Source and verification

- Release tag: `experimental-v0.1.0-beta.16`, targeting [4c0caf6efbaee27c8c22ad184419af8e96114daa](https://github.com/kokin-blip/Coqui-Crypto/commit/4c0caf6efbaee27c8c22ad184419af8e96114daa). All remediation, AGENTS.md and previously untracked review/PDF/ZIP evidence was committed and pushed on `codex/oct19-review-integration`. No main-branch or stacked-PR merge was performed.
- [Branch CI](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/39390829463), [tag CI](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/39392051769), and [macOS-only release workflow](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/39392051731) passed. The branch suite passed 271 files / 1,815 tests; tag verification repeated the full suite before packaging. The release workflow has one installer build: macOS arm64.
- Application source hash: `da161324d68a65c1d140ef0a05e493172cb805bcec9f7a675726eac8ccb5ad65`. Application/test files match the earlier fully verified `b14da3d` implementation; the release commit adds workflow, documentation and review artifacts. Historical October 19 performance receipts keep their original identity and are not relabelled as a new soak.
- Downloaded ZIP and DMG SHA-256 match the manifest and GitHub asset digests. The ZIP executable's embedded revision/hash match the exact release source and report a clean build. Both ZIP and read-only-mounted DMG ad-hoc signatures verify; disposable packaged smoke opens schema 94 and loads the news worker from each. The DMG mount was detached afterward. No actual profile was opened, migrated, restored or installed.
- Anonymous public download checks returned HTTP 200 for all three assets. CI also verified hashes after uploading the draft before owner-authorized publication.

## Downloads

- [Coqui-0.1.0-beta.16-mac-arm64.dmg](https://github.com/kokin-blip/Coqui-Crypto/releases/download/experimental-v0.1.0-beta.16/Coqui-0.1.0-beta.16-mac-arm64.dmg) — 185562322 bytes; `sha256:d65b94cc27e6f8aa2c669e682e3afe78c96221edd6fced566acf1a936f7bd7b6`.
- [Coqui-0.1.0-beta.16-mac-arm64.zip](https://github.com/kokin-blip/Coqui-Crypto/releases/download/experimental-v0.1.0-beta.16/Coqui-0.1.0-beta.16-mac-arm64.zip) — 177976988 bytes; `sha256:0f07832d073ffdf31e3754510326cb7f5a41ee88abdfa2ea229410f46059e0bd`.
- [SHA256SUMS.txt](https://github.com/kokin-blip/Coqui-Crypto/releases/download/experimental-v0.1.0-beta.16/SHA256SUMS.txt) — 200 bytes; `sha256:da26cf4be00d1d8d181df308e709af2230a165ecb6c8a836396b6180cb08a67f`.

## Scope and remaining gates

Signing is ad-hoc; no Developer ID notarization or stable-release certification is claimed. Human VoiceOver/high-contrast review, actual-profile/installed representative restore, real-market lag and connected-account proof, natural useful news observations, research authority/elapsed coverage, effective branch safeguards and main/stacked review remain open. Windows installer validation is outside this macOS-only release. No provider activation, broker order, credential access, research registration/holdout/promotion or branch-setting change occurred.

Existing issue assignees/dependencies and historical evidence remain intact. Publication changes distribution status; it does not close those operational/human gates. See [the original implementation delivery](oct19-delivery.md), [measurements](oct19-measurements.md) and [owner sessions](oct19-owner-sessions.md).

Evidence: `evidence/beta16-release/` contains CI metadata/logs, published release metadata, public-download checks, downloaded package proof, artifact checksums and original-review preservation hashes. A later receipt-only commit may follow the release tag without moving it.

## Prompt used

```text
Okay, commit and push everything. then make a new release. for this release i only want the mac build.
```

Original implementation prompts remain preserved in [the October 19 record](oct19-originating-prompts.md); this follow-up explicitly authorizes commit/push/publication and narrows this release to macOS.
