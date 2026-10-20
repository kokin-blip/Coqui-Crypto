# Installed-app debugging review — October 20, 2026

This investigation describes the pre-fix build. The subsequently authorized
[local remediation and verification](fee-recovery-network-fix-2026-10-20.md)
implements the fee-audit and diagnostic fixes without changing recovery limits.

## Scope and identity

Reviewed the user-visible Coqui paper activity screen, the active Main Wallet
profile through read-only SQLite connections, recovery/HTTP/projection source,
and selected installed package members. This is an investigation, with no
production behavior changes, app restart, account commands, or new broker orders.

- Local review HEAD: `05be901` on `codex/operations-crew-journal`; initially clean.
- `/Applications/Coqui.app` reports `0.1.0-beta.16`, built from clean revision
  `4c0caf6efbaee27c8c22ad184419af8e96114daa`.
- Packaged source hash: `da161324d68a65c1d140ef0a05e493172cb805bcec9f7a675726eac8ccb5ad65`.
- Installed compiled recovery, activity projection, and Alpaca HTTP modules are
  byte-identical to the corresponding local compiled files.
- Profile registry selects `main` / `coqui.db`; one parallel paper experiment.
- Around 10:30 AM America/Phoenix, the journal contained approximately 57,900
  events, including 14 submit attempts, 46 fill activities, 40 fee activities,
  and 1,638 reconciliation failures. Counts continue changing while open.

Native control captured the open activity/evidence-inspector screen matching the
attachment. Its accessibility tree exposed only containers; subsequent click and
scroll attempts returned `noWindowsAvailable`, so a complete interactive tour
was not possible. Multiple local copies share the bundle ID; the running process's
exact executable path was not established. Package metadata above identifies the
inspected `/Applications` copy, rather than proving process-path identity.
Broad REA package graph analysis did not finish within this investigation and
was abandoned; no findings depend on it. Package identity/module comparisons
were read directly from the ASAR header and members.

## Main cause: fee-shaped position differences exceed the recovery policy

At **5:01 AM Phoenix (12:01 UTC)**, six fill activities recorded three paper
buys. The next reconciliation paused the experiment for
`broker_positions_mismatch`. Subsequent successful position reads consistently
reported these differences:

| Asset | New gross buy quantity | Unaccounted quantity reduction | Gross buy × 0.0025 |
| --- | ---: | ---: | ---: |
| BTCUSD | 0.191623118 | 0.000479058 | 0.000479057795 |
| ETHUSD | 4.718290815 | 0.011795728 | 0.0117957270375 |
| LTCUSD | 88.929966704 | 0.222324917 | 0.2223249167600 |

Each reduction fits the existing recovery classifier's fee rate and rounding
band. The persisted ledger does not yet contain corresponding asset-denominated
fees. Latest available fee metadata was created October 10; its October 12
billing date is a separate field. **Delayed fee publication is a strong inference,
not confirmed fee attribution.** No hypothetical fee was inserted into the DB.

Using the last recorded account-mark prices, the combined gap is **about $80.06**.
The exception classifier in
`packages/services/src/paper/parallel-paper-minor-recovery.ts:63` rejects anything
above **either $25 or 0.05% of equity**. This gap exceeds both limits. The replay
uses historical mark prices, not current executable quotes; actual recovery
values the gap with fresh ask prices. Recorded successful quote/position reads
and the persistent mismatch support the same policy-block explanation.

The paused branch retries reconciliation every scheduler pass while preserving
the original pause (`parallel-paper-service.ts:372`). Thus repeated rows do not
mean repeated submissions. Matching hypothetical fee evidence reconciles the
quantities exactly in an isolated in-memory replay. That proves the accounting
relationship, not that those hypothetical fees have been published by Alpaca.

The policy is deliberately conservative. Raising its limits or overriding the
ledger is not an appropriate debugging shortcut. Recovery needs actual fee
evidence, or an explicitly designed and reviewed paper-only resolution policy.
Manual Resume remains a separate step after recovery checks pass.

## Actionable code-review findings

1. **P2 — activity title misidentifies a successful read as a failed read.**
   `packages/services/src/paper/parallel-paper-activity.ts:112` derives its title
   from the operation and appends “failed” for every non-timeout reconciliation
   error. Here, positions returned HTTP 200 and were successfully parsed; the
   ledger comparison failed. Display “Position reconciliation mismatch,” retain
   the exact differences, and reserve “read failed” for transport/provider reads.

2. **P2 — the recovery-limit rejection loses its specific explanation.**
   `parallel-paper-minor-recovery.ts:63` throws the original mismatch after
   identifying a fee-shaped gap over the limits. No structured field records
   the valued discrepancy, the two ceilings, or the rejected policy gate.
   `ParallelPaperRecovery.tsx` can therefore show only generic differences and
   retry guidance. Preserve the blocked result but expose an allowlisted
   classification/value/limit diagnostic so the operator understands why another
   successful read cannot resolve it yet.

3. **P2 — transport diagnostics discard the cause of immediate network failures.**
   `packages/adapters/src/http/alpaca-paper.ts:136` maps arbitrary fetch errors to
   `unavailable`, discarding their transport code. The inspected day's snapshot
   contained 73 unavailable account attempts (mean 3.5 ms) and 68 unavailable
   orders attempts (mean 3.2 ms), without HTTP statuses. Both endpoints also had
   many successful reads. The current timeline rounds milliseconds to `0.0s`
   and says “network or timeout,” which does not establish an actual timeout.
   Preserve a strictly allowlisted transport category/code and show milliseconds
   for short failures; never persist raw exception text, headers, or credentials.
   Existing data cannot distinguish DNS, TLS, proxy, socket, or other fetch
   failures, so the underlying intermittent network cause remains unresolved.

These are review findings and proposed follow-ups; production code was not
modified. No broker outage or invalid credentials are established by the data.

## Other profile data reviewed

- SQLite `quick_check`: **ok**; `foreign_key_check`: **0 violations**. These
  validate structural consistency, not correctness of all financial records.
- Broker journal: successful HTTP 200 account/orders/activities/positions/quote
  observations interleave with transport failures. Recent position snapshots
  are stable. The mismatch is distinct from network reachability.
- News: GDELT has repeated HTTP **429** responses; the news scheduler's last
  recorded error is `rate_limited`. The snapshot contained 29 HTTP-429 request
  failures and only two successful requests. This is separate from Alpaca.
- Research: latest recorded hourly-execution, breakout, range-rotation, and
  market-selector failures report `registered_study_source_changed`. The
  provenance checks in `study-collection.ts`/`registered-study.ts` deliberately
  reject changed registered source identities. Study registration, dates, and
  historical evidence were not changed. Current qualification remains unmet.
- The inspector's failed seven-day campaign/acknowledgment state is historical.
  A legacy `campaign_exercise` safety-stop row exists, but
  `resolveKillSwitch()` explicitly excludes that kind from the operational kill
  switch. It is not evidence that this row caused today's Alpaca pause.
- The screenshot's `retired_incompatible` prospective study and “No eligible
  strategy” are separate research/qualification states. A registered row alone
  does not establish a currently eligible strategy.
- No production profile copy, credential retrieval, study registration,
  safety-stop acknowledgment, cancellation, or Resume was performed.

This was a bounded operational review, not a row-by-row audit of all archives,
a full UI walkthrough, a current-provider fee certification, or release approval.

## Verification and reproducibility

**74 tests passed across seven suites:** Alpaca boundary, minor recovery,
recovery reporting, deadlines, paper execution, execution reliability, and UI
contracts. These tests used the local source; they do not certify live broker
health. The three installed modules relevant to these findings matched local
compiled output as described above.

The additional read-only incident replay is
`docs/implementation/evidence/oct20/replay-paper-fee-gap.mjs`:

```sh
node docs/implementation/evidence/oct20/replay-paper-fee-gap.mjs '/absolute/path/to/coqui.db'
```

It uses mocked account/position/quote responses derived from persisted evidence,
performs no network requests, and verifies: at historical mark prices the
fee-shaped gap stays blocked and no exception resolution is created; reducing
only the mocked prices allows the same classification checks to pass; synthetic
matching fees reconcile only in memory; and the current activity title
incorrectly says “read failed.” Its
October 20 replay passed with an approximate $80.06 gap and zero DB writes.
Workspace compiled modules must exist (`pnpm build` refreshes them).

No fixes were committed, merged, packaged, or released by this review. COQ-12
remains In Review, with connected-account acceptance gates still open.

## Prompt used

> This is the newest build of the app, do some debugging and review the code to find out what is cauisng these issues. take control of my currently open Coqui Crypto app to review all the data
