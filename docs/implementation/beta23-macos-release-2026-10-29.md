# beta.23 Mac-only release delivery

October 29, 2026, America/Phoenix. Beta.22 was an **unpublished candidate**, not a distributed release. Its exact-tag Linux verification found ten failures in five suites: disabled reserve initialization eagerly tried to hash absent compiled `dist` artifacts before the build step. Earlier local checks built first and did not reproduce that clean-checkout condition. Its tag and failure evidence remain unchanged; beta.23 supersedes the candidate rather than moving the old tag.

The correction resolves compiled-artifact identity lazily, caches only a successful proof and still refuses actual reserve authority when that proof is missing. It provides no fallback identity, weaker eligibility or new permission. Three dedicated regressions verify empty/disabled startup, refusal on missing artifact and no authority from an artifact identity alone. The previously failing composition/secret-leak tests are rerun with all first-party compiled output removed, followed by the entire suite before building.

Version `0.1.0-beta.23`, intended tag `experimental-v0.1.0-beta.23`, Mac Apple Silicon arm64 DMG/ZIP/checksums only. [Release notes](../RELEASE-NOTES-beta.23.md). The tag's release workflow explicitly selects only Mac installers. The source includes all application updates from beta.22 plus the corrected startup and capture-only verifier. Signing remains ad-hoc; no Developer ID notarization is claimed.

Evidence is recorded in [beta23-release](evidence/beta23-release/), with beta.22 source/tests/failures retained in [beta22-release](evidence/beta22-release/). No beta.22 artifact is substituted for beta.23. Source commit, native/package checks, CI and publication/downloaded hashes will be recorded from their actual results. The release remains unpublished until those applicable gates pass.

The original P0–P7 roadmap, phase requirements, negative research, frozen/consumed evidence and prior reports remain intact. P5-H, actual P6-G acceptance, full account/host/credential/financial/dispatch verification and actual P7-H–J stay pending. Publication does not install the app, migrate an actual profile, change credentials or hosts, Resume trading, place/cancel an order, withdraw funds, register/collect/evaluate a study or grant qualification. Historical session/account evidence and the unrelated deleted review ZIP remain outside distribution and preserved locally.

## Prompt used

Ok release a new release with all these new updates. mac build only.

Annotation follow-up:

> commit those

Scope clarification:

> No comit those and add all the new changes in the new release.
