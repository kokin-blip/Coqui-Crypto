# Operational evidence kickoff — October 10, 2026

Continuation authorized by kokin: “Begin working on these.” The selected context
is VoiceOver, real-market/provider/broker proof, representative restore
certification and owner/release gates. This authorizes preparation and disposable
exercises. The prior limits on credentials, orders, actual-profile restoration,
provider activation/spend, research transitions and publication still apply.

## Current reconciliation

- Baseline source: `64e8fc6c9d407d5a963330fcc28f4347eba9e6e2`.
- PR #11 is open/draft, with no submitted human reviews. Exact-head source,
  native, desktop and both packaged CI checks passed; its initial Activity
  assertion inconsistency remains review evidence.
- Repository is public; default branch is `main`. Rulesets returned `[]`.
  Both `main` and `feature/news-intelligence-phase4` protection endpoints returned
  HTTP 404 “Branch not protected”. This replaces the earlier permission-403
  uncertainty for those two branches only. Other branches are not certified.
- Latest listed publication remains `experimental-v0.1.0-beta.15`.
  No merge, protection change, review approval or release action was performed.

## V08/G09 — disposable restore and process reconstruction

`apps/desktop/scripts/restore-restart-evidence.mjs` generates its own temporary
Main profile. It has no input for an actual profile or existing backup. It uses
the production runtime/dispatcher, existing backup store and read-only restore
verifier. Network returns 503; scheduler is disabled and secrets are memory-only.

The generated sample includes profile/person/nickname metadata, exact balanced
ledger entries, immutable negative evidence and a synthetic four-horizon report.
It validates snapshot/schema/integrity/foreign keys/ledger/event hashes, supplied
metadata/artifact hashes and a corrupted backup manifest. The original runtime
directory is quarantined; two additional processes reconstruct the restored DB.
The source and backup hashes must remain unchanged and reconstruction must not
create orders. Temporary data is removed after the exercise.

**Observed blocker:** the copied report validates independently, but the stored
absolute path becomes unavailable. `news_report_associations_v1` has primary key
`(report_hash, profile_id)`; `associateNewsReport` uses `INSERT OR IGNORE`. Calling
it with the copied location for the same report/profile does not add a location
or repair the reference. The runtime truthfully keeps it unavailable across
restarts. The exercise preserves that original record and does not apply a fix.

The receipt in `evidence/restore-restart/checks.json` is generated/simulated
evidence, not certification of an operator's backup. G09 remains open. A repair
needs a separately reviewable append-only artifact-location contract, explicit
operator destination and hash/schema validation; do not update immutable history,
guess the newest report or claim success when insertion was ignored. Actual
backup certification additionally needs an owner-selected, redacted inventory of
profiles/DBs/metadata/archives/reports and a separate isolated-restoration scope.
Never paste credentials or account identifiers into this inventory.

## V01/V03 — human VoiceOver walkthrough

Ready launcher:

```sh
pnpm --filter @coqui/desktop build
pnpm --filter @coqui/desktop exec electron scripts/voiceover-session.mjs
```

This opens only a generated disposable profile. It blocks external renderer
traffic/links, uses memory secrets, disables scheduler, and denies all write
channels except person/setup actions. It neither enables VoiceOver nor records
an automatic VoiceOver pass. Close the window to clean up; abandoned sessions
expire after 30 minutes. `--smoke-check` checks the launcher only.

Record the exact build/source manifest, macOS/VoiceOver version, viewport, zoom,
contrast setting, operator and observed announcements/focus for each row:

| Task | Exit evidence |
|---|---|
| Cold launch with delayed reads | Dialog/title/name field announced; background inaccessible |
| Tab/Shift+Tab and VoiceOver navigation | All controls named and contained; reading order matches task |
| Validation fixture → Name save: refused | Entered text/step retained; refusal announced without success |
| Name save: unknown; then save | Uncertainty announced; blind save retry unavailable |
| Refuse next Escape skip; press Escape | Failure announced; useful dialog retained |
| Escape again | Confirmed skip closes dialog and returns focus to Terminal |
| Reopen setup | New dialog announced; name step receives focus |
| Zoom 200%; contrast on; 1280/1920 widths | Essential text/actions reachable without lost focus |
| Terminal → Operations/Recovery | Explain “why no decision” and safe next step in two interactions |

Each row is **not yet observed**. The assistant cannot certify announcements
from DOM focus or screenshot fixtures. A human VoiceOver session is needed.
Do not change macOS VoiceOver/contrast settings on the owner's behalf.

## V04/G02 — proposed first public-market session

Concrete approval scope: this Mac, one **10-minute personal research session**,
generated disposable profile, Coinbase public BTC-USD/ETH-USD data only,
production read/trace paths, no account keys, no orders, no paid endpoint, no
scheduler/news ingestion, and no changes to authoritative capture architecture.
Use cold/warm interaction blocks and record symbol switches/reconnects, main
receipt/book/IPC timings, renderer marks/input-to-paint, level counts, CPU/heap
and event-loop delay. Record trace observer overhead and missing/dropped samples.
Results must carry exact build/source/workload identities and real versus
simulated classification. Do not claim source-to-paint correlation without a
matched identity, or treat host/provider clock differences as network latency.

Until G02 scope is approved, do not start the feed or retain raw frames. First
capture artifacts stay local; do not upload provider-derived frames/charts or
statistics to this public repository. Matched replay/soak remain subsequent
scopes; an unreproduced lag cause leaves COQ-6 open. No worker/native rewrite is
proposed from fixtures.

[Coinbase market-data terms](https://www.coinbase.com/legal/market_data) returned
an Australian regional page during this review (dated August 7, 2026). It
restricts external redistribution of market data and derived works. Applicability
to this owner's jurisdiction/use and local diagnostic retention remains an owner
rights decision; this review does not grant permission or certify legal sufficiency.

## V05/G02 — provider rights preflight

Reviewed official public pages on October 10. These are bounded source notes,
not publisher licenses, account-entitlement evidence or active export grants.

| Provider | Current source observation | Next required evidence |
|---|---|---|
| Currents | [Terms](https://currentsapi.services/terms), dated December 27, 2025, distinguish a service-use license from third-party content rights; permanent copying/database creation, derivatives and public statistics require applicable permission. | Publisher/contract permission for each retained field/derivative, deletion obligations and attribution; no ingestion activation now |
| Marketaux | [Site terms](https://www.marketaux.com/tos) describe limited personal/noncommercial site access and separately address third-party content; [API docs](https://www.marketaux.com/documentation) establish interfaces, not a publisher retention license. | Actual API entitlement/agreement and field-specific publisher rights; no key or purchase requested |
| GDELT | [Dataset terms](https://gdeltproject.org/about.html#termsofuse) permit use/redistribution of GDELT datasets with attribution. | Confirm which supplied fields fall under those datasets versus publisher article content; approve retention/derivatives/export separately |

Default for unproved fields remains denied. Existing quota/funnel/mapping code is
reused; no forced requests, account changes, deletion of immutable history or new
permissions were made. A successful HTTP response or retained synthetic record
does not close V05. COQ-19–22 retain their operational acceptance gates.

## V07/G01/G07/G08 — connected-paper scope to select

First proposed account phase is **read-only inventory**, not order exercise:
intended Mac, dedicated existing Alpaca paper account, existing key installed by
the owner outside chat, paper origin only, GET account/orders/positions/client-ID
lookup, experiments paused and no Resume. No POST/DELETE, cancellation, account
reset, live endpoint, credential export or broker-statistics upload. Record only
approved redacted observations and preserve original uncertainty/timestamps.

Before that phase: owner confirms the account is dedicated paper, key access and
redacted evidence scope; the integrated implementation must have human review.
Only after inventory is reviewed, define separate order/notional/symbol/time
limits for any submission/cancel/restart experiment. No such order scope is
approved here. Coinbase/Robinhood checks remain separate and read-only.

[Alpaca paper documentation](https://docs.alpaca.markets/us/docs/paper-trading)
states this environment is simulated and omits several live-execution effects.
Even genuine observed paper fills cannot certify live execution or unobserved
fee/partial-fill/timeout cases. Live execution remains hard-disabled.

## G06 — owner/release actions still pending

Prepare review of the existing stack in dependency order, including the first
Activity assertion failure, local fullscreen limitation and report-location gap.
No agent review is substituted for human approval. Owner decides branch policy:
one human approval, required exact source/native/desktop checks, no direct pushes
and no bypass except an explicitly authorized emergency path. Packaged CI receipts
must bind the merged release revision; PR-only packaging is currently skipped.
Require matching-host artifacts/checksums, migration/restore compatibility and
applicable signing before a separate publication decision. Nothing in this kickoff
changes settings, marks PRs ready, merges branches, signs or publishes a release.

## Next owner inputs

1. Availability for the disposable VoiceOver walkthrough.
2. Approval of the narrowly scoped 10-minute public-market session and local-only
   diagnostic retention after confirming applicable rights; no provider/account scope included.
3. Dedicated Alpaca paper availability for a later reviewed, read-only inventory;
   no credentials in chat and no order authorization assumed.
4. An owner-selected recovery inventory and separate restoration approval;
   report relocation must be repaired/reviewed before full G09 certification.

All V01–V09/G01–G09 identities and original F01–F14 classifications remain.
COQ-26/27 track accessibility/recovery; COQ-6/7 market evidence; COQ-19–22 news;
COQ-12/14/15 paper; COQ-9/13 safeguards/release. No evidence gate is closed here.
