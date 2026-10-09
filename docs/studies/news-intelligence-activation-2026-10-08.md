# News Intelligence — Phase 2 completion and development activation

The combined Phase 1/2 implementation is on `feature/news-intelligence`, based on
`ade88e3991b47fba00512adecf3c409518346a56`. Delivery targets a commit and draft PR
against `p5-shell-and-ui`; human review, CI, merge and release remain pending.
The baseline is 131 commits ahead of `origin/main`, so targeting the existing
integration branch keeps unrelated work out of the news PR. Current delivery
links are recorded in [COQ-20](https://linear.app/coqui-crypto/issue/COQ-20/news-intelligence-phase-2-free-provider-adapters-persistent-quotas-and).

## Implemented host behavior

- Internal strict configuration `{ schemaVersion: 1, gdeltEnabled: boolean }`
  lives in existing `app_settings` under `news_intelligence_host_v1`. Missing
  configuration defaults to disabled; invalid configuration fails closed. It has
  no credentials or renderer channel. No additional migration beyond 88/89 is needed.
- Main uses one existing SQLite file for article storage and quota authority.
  Desktop profile composition pins the authority to the legacy Main filename;
  other profiles do not collect. Headless accepts an explicit
  `--news-quota-database=MAIN_DATABASE` and validates Main uses the same file.
- Initialization is lazy after host activation. Existing wake-ups start independent,
  non-overlapping news work without awaiting HTTP in paper/execution preparation.
  Headless one-shot ticks settle news before disposal. Host ownership is checked
  before dispatch, retry and article persistence; scheduled slots use existing
  renewable/fenced leases. Initial collection uses the current UTC slot only if
  no schedule exists; existing next-slot state is never replaced.
- Suspend, profile disposal, ownership loss and shutdown cancel collection. The
  collector owns a connection to the same database until pending work settles,
  retaining synchronous application disposal. Shutdown prevents article writes
  and quota finalization through closed connections; unfinished reservations stay
  spent. This adds no database file or backend lifecycle.
- Stable per-provider pools replace credential-dependent runtime scopes. Key
  rotation and multiple keys share the provider allowance. Current-day legacy
  counters and maximum cooldowns are conservatively carried forward with persisted
  `app_settings` cursors; late legacy finalization is accounted for without
  double-counting. Immutable original attempt journals are retained.
- Existing poll intervals, budgets, retry rules, normalized metadata contracts and
  point-in-time eligibility remain intact. Live validation sets `maxRetries: 0`
  to enforce one attempt per provider check.

No sentiment, canonical instrument resolution, event clustering, research feature,
archive, frontend or trading behavior was added. Existing RSS feeds and desktop
channels remain intact. No external dependency was added.

## Authorized development database and actual evidence

Selected file:
`/Users/kokinmartinez/Library/Application Support/@coqui/desktop/coqui.db`.

`news:configure --database EXISTING_MAIN_DATABASE --gdelt enabled` used the normal
migration/backup runner. Schema is now **89**. The new pre-migration backup is
`coqui.db.pre-migration-v87-1791509663473.bak`; older backups remain intact.
The setting is `{ "schemaVersion": 1, "gdeltEnabled": true }`. Marketaux/Currents
scheduled collection and persistence remain disabled. Only this selected database
was enabled; new installations remain disabled. The new host code reads the
setting when Main is active on its next application launch/host tick. No separate
background process was left running by validation.

`news:validate --allow-live --database EXISTING_MAIN_DATABASE` recorded:

| Check | Actual outcome |
| --- | --- |
| Main host eligibility | Eligible; no ownership assignment or takeover performed |
| GDELT initial scheduled slot | Degraded: `timeout`; one HTTP attempt |
| GDELT quota accounting | Budget 72; reserved 1, failed 1, succeeded 0 |
| Stored articles/observations | 0; live provenance validation remains unmet |
| Restart scheduling | Next slot preserved: `2026-10-09T02:00:00.000Z` |
| Marketaux transient check | `credentials_unavailable`; request cost 0 |
| Currents transient check | `credentials_unavailable`; request cost 0 |

No clock or existing schedule was advanced or reset to trigger another fetch.
No immediate second GDELT poll was forced. Metered validation did not enroll keys,
create accounts, send requests or retain articles. Both disabled validation/smoke
paths were also checked. No credential value, request URL/header, article text or
arbitrary upstream payload appears in diagnostics or this evidence report.

Attribution: [GDELT Project](https://www.gdeltproject.org/), including its
[DOC API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/).
Metadata availability does not convey publisher article-content rights.
Marketaux/Currents archival permission remains unresolved as recorded in the
[provider report](news-intelligence-providers-2026-10-08.md).

## Verification and changed files

Focused verification passed: eight news/storage/contract/lifecycle test files,
92 tests, followed by 23 passing host/scheduler tests after adding failure
isolation cases. Final `pnpm verify` passed: typecheck, lint, **258 test files / 1,720 tests**,
and build. Golden backtest, secret-leak/boundary, migration and profile suites
passed. No remaining pre-existing failures were observed. `git diff --check`
passed. Build-generated research manifests were inspected and retained.
Default-disabled `news:smoke` and `news:validate` passed. The live GDELT timeout
is an explicitly unmet upstream validation gate, not a synthetic test failure.

New completion files:

```text
apps/desktop/src/main/news-host-runtime.ts
packages/services/src/news/configuration.ts
scripts/news-configure.mjs
scripts/news-validate.mjs
tests/news-host-runtime.test.ts
docs/studies/news-intelligence-activation-2026-10-08.md
```

Extended existing composition, profile controller, desktop scheduler and headless
entry point; contracts/settings validation; quota repository/governor/runtime;
smoke tooling and root scripts; news quota/runtime and desktop scheduler tests;
and the previous reports. Earlier Phase 1/2 file inventories are in the linked
foundation/provider reports. Required build-generated study manifests remain
included; historical registrations/results and elapsed evidence were not rewritten.

## Remaining gates

Implementation and development configuration are complete; live ingestion is
**not verified**. GDELT must produce a successful natural scheduled response with
valid provenance. Metered providers require available owner-enrolled credentials
for transient checks and resolved retention permissions before persistent
collection. First-page polling can miss intervening articles. Another installation
or database cannot share this ledger automatically. Review, exact-revision CI,
merge and release remain open; no paid activation or upgrade occurred. Cost: $0.

Phase 3 requires explicit instruction. Its instruments, sentiment, event clustering
and research features, followed by archives and UI, remain out of this delivery.

## CI follow-up and baseline control

At delivery, GitHub's push verification passed, Linux desktop smoke passed and
all three native dependency checks passed. Other PR jobs were still running.
The macOS smoke job failed its existing assertion:
`decision detail opens with focus and recorded gate reason`.

A targeted control rerun on the unchanged baseline commit
`ade88e3991b47fba00512adecf3c409518346a56` reproduced the **same assertion failure**,
confirming it is pre-existing rather than introduced by news host wiring:
[baseline macOS control log](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/37855493928/job/113631009485).
The control also reported a renderer script exception; this delivery does not
claim that unrelated UI issue is repaired. The
[news PR macOS job](https://github.com/kokin-blip/Coqui-Crypto/actions/runs/37871299354/job/113629778663)
records the matching focus failure.

Local `pnpm smoke` on the news revision passed **all 78 Electron checks**, using
the existing isolated fixture harness; it did not alter the selected development
database. No production UI or smoke assertion was changed to mask CI failure.
Human review and successful CI remain explicit gates. This follow-up edits only
this report; the tested implementation and generated manifests remain unchanged.
