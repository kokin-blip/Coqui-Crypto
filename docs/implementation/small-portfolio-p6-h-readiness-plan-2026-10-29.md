# P6-H: ownership readiness and remaining connected implementation

October 29, 2026. Local continuation after pushed P7-A–G and the thirteen G regression cases, commit [24afead](https://github.com/kokin-blip/Coqui-Crypto/commit/24afeadc8bfeaa5023bc871b45b79ec789f6b2ee). This is a source-backed design and read-only diagnostic delivery, **not an implemented account coordinator, connected reserve factory or actual connected verification**.

The unchanged [P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md), full [P6 plan](small-portfolio-p6-implementation-plan-2026-10-24.md), [P7 plan](small-portfolio-p7-implementation-plan-2026-10-24.md) and [phase tracker](small-portfolio-phase-tracker-2026-10-23.md) retain their complete requirements. P0–P4, P5-A–G, P6-A–F/G implementation and P7-A–G are preserved. P5-H, actual P6-G acceptance, P6-H and actual P7-H–J remain pending.

## Verified source facts and diagnostic implementation

| Evidence | Finding | Consequence |
|---|---|---|
| `packages/storage/src/migrations/v66.ts`, `repositories/execution-authority.ts` | Execution lease primary key is `profile_id` in the supplied profile database. | A valid lease proves exclusion within that database/profile, not across economic accounts or machines. |
| `migrations/v70.ts`, `repositories/host-authority.ts` | Host assignments and takeover reconciliation are also profile-scoped. A takeover invalidates that profile's lease. | Reuse these local checks; they cannot substitute for an account-wide fencing protocol. |
| `packages/core/src/portfolio/capital-ledger.ts`, `repositories/capital-accounting.ts` | Canonical account scope uses provider, environment, verified account identity hash and USD. Profile is access/provenance metadata. | Reuse this stable economic identity. Reconnection, a new profile or a new tracking epoch must not acquire a second independent cash pool. |
| `packages/core/src/execution/account-budget.ts`, `packages/services/src/portfolio/capital-budget-sources.ts` | Unproven connected authority is refused. | Preserve the refusal. Do not relabel a connected source `isolated_book`. |
| `packages/services/src/portfolio/paper-profit-reserve.ts` | Connected operational construction is unavailable. | No factory is injected by this delivery. |
| New disposable test using actual scope persistence, host and lease repositories | Two independent profile databases can save the same synthetic account scope and hold simultaneously valid local leases. | This is a demonstrated limitation of the existing boundary, not evidence of an installed account conflict. |

`scripts/inspect-small-portfolio-evidence.mjs` now emits **`small-portfolio-evidence-inventory-v2`**. It adds only local host/lease metadata, hashes host/owner identifiers, distinguishes absent tables/rows, released/expired/unexpired leases and rows recorded after the requested observation time. These mutable rows do not reconstruct historical ownership. Both `exclusiveAccountOwnershipVerified` and `authorityGranted` remain false. The account-wide proof is explicitly `not_verified_by_this_inventory`; P6-H blockers remain present even with an unexpired lease.

The existing explicit, read-only consistent-copy CLI contract remains: no installed-path default, migration, provider call, credentials, account balances, price/final-body read or write authority. V1 reports and their hashes remain immutable; a V2 run is a separate observation and cannot refresh earlier evidence. Tests cover predecessor schema95, no mutation of the supplied copy, secret/final-body exclusion, two-profile exclusion failure and temporal limitations. No actual account copy was reopened for this delivery.

## Proposed ownership boundary requiring review

**A per-profile database or an independent local lock on each host is insufficient.** All admitted Coqui writers must share one authority for the verified Alpaca paper account and its claims, with enforcement at the actual dispatch boundary. Adding an application-level token is insufficient if a previously authorized writer can still send an unchecked request.

Before implementing connected authority, explicitly review the deployment/credential topology. The proposed constraint is a single account authority and broker dispatch boundary used by every admitted writer. It can be implemented on the owner-designated host with other hosts denied direct dispatch, or through a separately reviewed shared coordinator/gateway. Neither topology is selected or deployed here. A cross-host service would be an explicit dependency/design change, not a silent addition to the listener-free headless app. A single-host design requires evidence that other hosts/profiles cannot retain an uncontrolled writer. Do not describe a local SQLite database as a distributed lock.

The intended host and permitted writer roster remain unprovided. The sole owner-identified paper account (ending YT3T) is not thereby proven dedicated, mapped to the installed account UUID, financially reconciled or available for reuse. Preserve comparison campaigns; do not reset, stop, re-enroll or take over their account merely to satisfy this design.

No current provider claim is made about broker-enforced fencing, credential scope, fees, cash/hold settlement or cancellation behavior. Once the topology and account are selected, verify those exact capabilities against current official documentation and account evidence before fixing the adapter contract. Unsupported exclusion leaves connected reserves unavailable. This diagnostic step requires no new venue assumption or broad research.

## Concrete architecture and facts for the next reviewed slice

The following names are proposed implementation targets; no such runtime or tables are created by this delivery.

1. Add `AccountCapitalAuthorityPort` in core execution, with a literal `alpaca`/`paper` scope, verified canonical financial account ID, enrolled writer identity and capabilities, monotone fencing generation, lease ID/expiry, source/claims head and reconciliation reference. Profile/host leases, profile operation gate, current kill/pause/manual Resume and exact qualification remain independently necessary. Renderer arguments cannot create a permit.
2. Add `account-capital-authority.ts` in storage and `account-capital-runtime.ts` in services only after choosing the shared storage/dispatch boundary. A separate coordinator store needs its own schema/backup/recovery contract; an additive profile migration alone cannot provide shared authority. Use the actual next schema version rather than reserving or modifying v100. Keep default profile startup and existing migrations disconnected from enrollment.
3. Persist immutable enrollment/reconciliation evidence, append-only authority transitions, command identity/request hash/results, exact dispatch intents/receipts and account-wide claim revisions. Maintain only CAS heads/lease metadata as mutable state. Canonical decimal text, canonical JSON/hash, financial FKs and append-only triggers follow P1/P2. One existing P2 claim represents each obligation: a central projection must reference/prove its origin, not duplicate it as another funded balance.
4. Use `capitalScopeId('alpaca','paper', verifiedAccountIdentityHash)` as the account key. Keep scope, origin/epoch, profile, connection and host distinct. Preserve reserve stream H, assessed backing, fee revisions and unresolved obligations across reconnect, policy change, restart and profile changes. No opening equity is inferred to be a contribution.
5. Add an authority assembler that proves current account/environment mapping, approved membership/writer roster, complete common-cut cash/equity/flows/manual activity/fills/fees/open orders/holds, and a shared claims cut. Unknown debits, late fees, stale marks, ambiguous settlement or competing writers refuse affected mutations and keep dependent metrics unavailable. A source row, old backup or successful GET cannot establish ownership.
6. Bind the resulting port at every applicable existing order, pending order, cancellation, reconciliation/settlement, routing, scheduler and reserve/release mutation site. Inventory/review the exact COQ-12 source before reuse. Broker submissions remain within the existing reviewed OMS/execution path; reserve code obtains no direct adapter, transfer or live capability. The factory remains absent until all required consumers and financial sources are proved.
7. Main supplies commands bound to the exact account/epoch/head/authority generation, current evidence and explicit review. Preserve P6-G's separate sale objective/review and post-settlement assessment. Current read-only reserve views may expose typed blockers but never translate an inventory result into authority. Copy/import/restore/save/upgrade defaults remain disarmed; no new polling schedule or enrollment command is added incidentally.

## Claim, dispatch and takeover protocol

1. Enrollment requires explicit owner-approved account/host/writer scope, reviewed topology, exact source revision, current financial cut and resolved prior authority/claims. It records a disabled binding. No startup takeover or expiration-triggered activation.
2. An explicit reviewed operation acquires the shared account authority, then rechecks the local host/profile execution permit, expected heads, budget, gates and scope. In one coordinator transaction, CAS the generation/head and append the idempotent command and conservative P2 obligation. Conflicting commands against the same cash cut cannot both consume it.
3. External dispatch is not part of a SQLite transaction. Persist the existing deterministic OMS intent before sending. The single reviewed dispatch boundary revalidates authority immediately before admission and serializes relevant account actions; no caller can bypass it with a stale fence. A response lost after dispatch leaves an unknown intent/claim, not permission to retry or release.
4. Reconcile actual fills, fees, cash and holds using deterministic lookup and source identity. Partial/cancel/expiry does not fabricate proceeds or realized profit. Release only obligations independently proved gone; unknown settlement/fees retains the relevant claim/blocker. A sale never pre-funds its later reserve.
5. Lease expiry stops new admission but does not prove an in-flight request failed. Before takeover, fence the old dispatch path, establish the old writer cannot submit, and reconcile all admitted/in-flight/unknown operations and financial claims. If that cannot be established, remain blocked. Never assume a Coqui token cancels an already-sent external request.
6. Advance authority generation monotonically only after supported reconciliation, preserving commands, claims, reserve backing/H and old evidence. New owner authorization and manual Resume are separate recorded actions. An incident resolving, a heartbeat returning or an imported backup does not perform either action.
7. Detected manual/external/unrecognized activity invalidates the affected financial/ownership cut and pauses new consumption until reconciled. Account segregation and an approved writer roster are enrollment prerequisites; absence of detected foreign events is not proof that no uncontrolled credential exists. Do not promise protection against activity outside the admitted boundary.

## Small implementation steps and acceptance

| Step | Work | Completion gate |
|---|---|---|
| H-readiness, delivered locally | V2 metadata inventory, actual repository counterexample and this protocol specification | Read-only/predecessor/temporal/exclusion tests; old artifacts and unrelated work preserved. No operational acceptance. |
| H1, pending review/input | Intended host/dedicated-account mapping and permitted roster; choose topology; targeted official capabilities/rights/source review | Owner authorization plus COQ-12/14 dependencies recorded. Unsupported topology remains unavailable. |
| H2, pending H1 | Strict shared-authority contract and disabled durable enrollment/claims/command storage | Two profiles cannot allocate the same shared cash; cross-process same-cut races; append-only/idempotency/CAS; no profile-copy authority; no installed migration/activation. |
| H3, pending H2 | Shared dispatch enforcement and all-consumer injection | Both host/profile and account fences required; stale/paused/expired/kill/credential-loss paths refuse; no alternate broker writer; actual source review. |
| H4, pending H2/H3 | Account financial common cut, source corrections, restore/takeover and unknown recovery | One fee deduction; deposit/sale neutrality; order/reserve race; foreign activity/gaps refuse; old backup cannot erase newer claims or H; no blind retry/automatic Resume. |
| H5, pending H1–H4 | Disabled Main/read UX integration and exact source-isolated native/lifecycle acceptance | Accurate blockers; no legacy campaign enrollment, transfer/live/registration side effects; current accounting and frozen behavior unchanged. |
| H6, pending actual permissions | Owner-authorized intended-host dedicated paper observations under COQ-14 | Real account/host/rules/costs/partial/unknown/fee/restore evidence meets saved requirements. Synthetic fixtures cannot close this step or grant qualification. |

At H2/H3 add independent conservation/race/fault fixtures: two profile DBs under one account authority; two competing hosts, network partition, expired writer delayed dispatch and unknown acknowledgement; coordinator failure before/after claim/intent/receipt; two reserves versus one order; restored stale profile/coordinator; rotated credentials/reconnected same account; conflicting manual activity/late fee; partial/cancel with unresolved legs; read-only observer attempting mutation. Add lifecycle/backup and real IPC/native tests when those application changes exist. Exact source manifests must include the coordinator and every dispatch consumer. Passing local tests does not certify the deployment topology.

## Remaining full-project gates

P5-H still needs adequate permitted unprotected history, complete original global trial/consumption custody, rights/membership/native costs and frozen objectives/resources. The previous 78-contiguous-date inventory cannot meet the saved 120-day warmup. Operational algorithm journal records are exposed development/operations evidence, not independent winning-trade proof or prospective observations.

P6-G retains cash-only F review, sale objective, exact strategy qualification and actual native/cost/financial/operational acceptance. P6-H retains its unimplemented shared protocol/factory and real account/host/source/rights observations described above.

P7-H retains owner plus independent reviewer, complete or separately reviewed development design, rights/protocol/global registry, power/resources and genuinely future approved windows. P7-I requires actual elapsed valid observations/actions/coverage. P7-J requires timely candidate-or-none freeze, untouched final claimed once and independent exact-configuration acceptance. No synthetic clock, existing algorithm experience or pushed implementation satisfies them. Negative findings, consumed intervals, legacy reports and all prior reviews/release gates remain preserved.

## Prompt used

Commit and push P7-A–G and the 13 regression tests, then continue the remaining unblocked P0–P7 work. Preserve unrelated work, keep unmet evidence gates pending, and update the phase tracker.
