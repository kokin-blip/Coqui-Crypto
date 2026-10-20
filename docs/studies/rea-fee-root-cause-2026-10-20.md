# REA investigation: fee gap on installed beta.17

Prompt used: **use REA TO FIND THE ROOT CAUSE OF THIS ISSUE.**

## Finding

The immediate cause of the current position mismatch is a difference between gross recorded buy fills and net broker holdings while the corresponding fee activity records are absent. The missing quantities match 0.25% of the six October 20 buy fills within sub-nanocoin rounding. This strongly supports an in-kind crypto fee deduction awaiting activity publication. It is not a missing-record ingestion defect in the responses examined.

Alpaca documents that buy fees are charged in the received asset and that fee activities are posted at end of day, so same-day queries may return no fees: [Crypto Spot Trading Fees](https://docs.alpaca.markets/us/docs/crypto-fees), retrieved October 20, 2026. The provider's internal settlement processing and future publication time remain unknown; no estimated fee was booked as a fact.

The app's strict final position check compares gross fills minus published asset fees against broker quantities. It therefore encounters a temporary difference before fee publication. Its paused minor-resolution path recognizes the shape but rejects this roughly $82 difference because it exceeds both its $25 absolute limit and the approximately $52.64 equity-relative limit. This explains why retries retain the pause. The dollar value changes with market quotes; the quantity differences were stable. Relaxing those limits is not justified by this investigation.

## Direct broker observation

At 2026-10-20T18:11:09.613Z, six read-only GET requests used the installed ASAR's adapter and the existing paper credentials held only in the diagnostic main process. The account identity matched the experiment. No application runtime, scheduler, order mutation, or profile database write was started by the probe.

| Check | Result |
| --- | --- |
| Installed version | 0.1.0-beta.17 |
| Combined FILL/CFEE/FEE query since experiment opening | 86 records: 46 fills, 40 fees |
| Fee-only query | Same 40 fees |
| Fee-only query without any `after` filter | Same 40 fees |
| All activity types since opening | 87: 46 FILL, 40 CFEE, one JNLC |
| Returned fills or fees missing from Coqui journal | Zero |
| Changed financial fields on already booked fee IDs | Zero |
| Current-day fee records returned | Zero |
| Latest returned fee creation timestamp | 2026-10-10T08:01:00.505431Z |
| Paper state / total submission attempts | Paused / 14 |

All these queries completed below their page size of 100, so pagination did not truncate these results. Removing the type and date filters did not reveal missing fee records. This conclusion applies to the observed responses, not every possible historical provider response.

| Asset | October 20 gross buys | 0.25% diagnostic fee quantity | Actual broker shortfall |
| --- | --- | --- | --- |
| BTC | 0.191623118 | 0.000479057795 | 0.000479058 |
| ETH | 4.718290815 | 0.0117957270375 | 0.011795728 |
| LTC | 88.929966704 | 0.22232491676 | 0.222324917 |

The installed position validator reproduced all three current differences using a read-only journal snapshot and fresh broker positions. A separate controlled replay against the preinstallation backup and extracted installed modules passed: the gap stayed blocked above both limits; hypothetical matching fee records in memory reconciled exactly. The replay's historical mark value was $80.06; the actual installed UI's later quote value was approximately $81.92. These are different valuation times, not different missing quantities.

## REA evidence and coverage

Evidence is retained locally in [rea-fee-root-cause-evidence.json](../implementation/evidence/oct20/rea-fee-root-cause-evidence.json). The reusable, secret-safe live probe is [rea-broker-fee-probe.mjs](../implementation/evidence/oct20/rea-broker-fee-probe.mjs); its output is [rea-broker-fee-probe.json](../implementation/evidence/oct20/rea-broker-fee-probe.json).

- Static application analysis parent: `ev_b444e7a982ae9b97a269ffc792b38eceeb781d6b0b0e53aa20ec2f84aa85a05e`; summary: `ev_463f591d6eb9803cc25c00dc65fa3bdb4efa8b8f44a7935b6ede2889763c9a1c`.
- Directed installed recovery-module trace: `ev_b342e7691f224e481f0bfbf413441305c4ae59007125a553a49061dc9112e5e2`.
- Successful final direct broker probe: `ev_ffa0fbd9a16bfea2962ecec7b8960239be8262438437848986c98581de3fc00c`.
- Successful controlled installed-module replay: `ev_1d11ed22806d271280988c26d90ea6aa6fb21cf7c9c16d710e65ee6167ef820e`.

REA examined a hash-manifested slice of four extracted installed modules: HTTP client, activity ingestion, exact position validation, and minor recovery. It parsed all four with no parse failures; slice inventory coverage was complete. This is not whole-app execution coverage. Static semantic relationships retain unknowns and do not establish runtime behavior. The live probe ran the actual installed adapter and validator under the matching development Electron runtime; it did not attach to the running app process. Probe responses are application-level observations; REA process capture itself does not observe network packets. Separate provider GET snapshots are not atomic. Initial probe revisions corrected a missing diagnostic database driver and omitted event IDs; their partial output is superseded by the successful final evidence above.

Installed ASAR SHA-256: `b6a3d2b2ca641e49b880ce23f982825223a798d09114667501aae06889b06d9c`. Slice member identities are in [rea-fee-slice-manifest.json](../implementation/evidence/oct20/rea-fee-slice-manifest.json). The full app hash and installed member verification were established during installation; relevant slice members match that extracted installed tree.

## Separate network failures and remaining limits

Historical network failures in the old journal completed in a few milliseconds with no HTTP status and nearly all of the 10-second budget remaining. They were early request failures, not proof that a ten-second timeout elapsed. Their underlying DNS/socket/TLS cause was discarded by the old error boundary and cannot be reconstructed from those rows. The new installed diagnostics preserve safe error codes when available. This investigation's broker reads succeeded, so no historical network root cause is claimed.

The remaining functional limitation is that large, otherwise fee-shaped same-day differences wait for authoritative fee evidence. A future workflow can describe this as pending fee evidence and show its age while retaining exact accounting, conservative limits, and manual Resume. This investigation did not implement another exception, rewrite the journal, or resume trading. Provider fee publication has not yet been observed, so end-to-end resolution remains unverified. All earlier release/review gates remain open; this is local investigation evidence, not a merged commit or release approval.
