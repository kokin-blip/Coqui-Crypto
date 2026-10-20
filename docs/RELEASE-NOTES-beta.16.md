# Coqui Crypto 0.1.0-beta.16 — experimental macOS release

This release provides **macOS Apple Silicon (arm64) only**: a DMG, ZIP and SHA-256 manifest. It contains no Windows or Intel Mac installer. Signing remains ad-hoc, without Developer ID notarization; see the installation guide for the macOS first-launch procedure.

## Changes since beta.15

- Research-only News Intelligence preserves immutable observation, transport, analysis and archive provenance. News does not influence strategy targets or live orders. New installations keep collection and analysis disabled; paid providers and unproved retention/export permissions remain disabled.
- News diagnostics distinguish retained ingestion from eligible prospective features, publication/persistence lag and relevant unique-story contribution. Missing coverage stays explicitly unknown; HTTP success and inserted rows do not establish useful research evidence.
- Readiness prioritizes safety, paper reconciliation, unavailable operational evidence, feed state and research qualification. It shows paper uncertainty, evidence timestamps/age and safe inspection links through existing surfaces.
- Recovery supports explicit copied-report selection with expected hash/schema/profile checks and append-only location history. Invalid selections stay unavailable without scanning for a newer file or silently falling back. Cloned profiles cannot inherit report-location or export authority.
- Isolated, operator-selected DB-copy verification reports its exact scope and exclusions. The disposable walkthrough is visibly simulated and cannot certify an actual profile restore.
- Activity detail focus survives delayed route callbacks and polling updates. Unknown command completion stays distinct from confirmed success, with blind retries fenced.
- Standard test reporting restores passing-file progress under agent environments. Startup/performance fixtures isolate browser/session data and retain exact source/workload identities.

## Data and recovery

Operational schema is **94**. Ordered migrations preserve immutable history and use the existing pre-migration backup mechanism. Schema 92 adds durable news diagnostics and report associations; schema 93 adds export permissions; schema 94 adds explicit report locations. Preserve SQLite backups, profile/person/nickname metadata and referenced report/archive files. Credentials are excluded from DB backups. A DB-only proof is not a complete profile certification.

Downgrading a migrated database is unsupported. Use a verified pre-migration backup and its compatible older executable when restoring an older version. See [installation and recovery](INSTALL.md) and the [October 19 delivery record](implementation/oct19-delivery.md).

## Verification and limits

The integrated application source was locally verified with 271 test files / 1,815 tests, typecheck/lint, root/desktop builds, native module checks without credential calls, Electron smoke/performance, macOS packaged smoke, keyboard/layout/state checks, a copied-report proof across two new processes and a deterministic news chain. A 30-minute synthetic workload passed existing gates; median launch-to-chart across five fresh processes was 993 ms. Renderer forced-GC heap grew 3.98 MiB including retained instrumentation; no leak-free or actual-market performance certification is claimed. Exact source identities, earlier failed attempts and measurement limitations are retained in the [measurement report](implementation/oct19-measurements.md).

Release CI re-verifies the tag and packages/smokes the macOS artifact before creating a draft. Downloaded asset hashes must match before publication. Historical local fixture receipts do not substitute for tag-build identity or downloadable-asset verification.

Human VoiceOver/high-contrast review, representative actual-profile/installed recovery, actual-market lag, connected-account proof, effective branch safeguards and research qualification/elapsed coverage remain separate open gates. Windows release validation is deferred for this macOS-only release. No strategy is promoted. The historical remediation window remains unregistered in inspected evidence; the separate future proposal requires owner-selected dates/profile and approval.

Live execution remains hard-disabled. No provider activation, credential access, broker order, actual-profile migration/restore or research transition is performed by publishing these files.
