# P2 implementation plan: shared budgets and small-portfolio feasibility

Status: implementation-ready design, **no P2 application code written**. The [full P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains the durable source of truth; this addendum expands P2 without replacing any phase. Original roadmap SHA-256: `fda3c0b76897bbb4497cf0e13a7a70d5b9d0e75c441fea4a1044c500ae5cdd25`; companion evidence: `ff2b0270f0de0af52b87cd7e3f6eb168e34956b3857ab085c4290d2bfff287a4`. P0/P1 accounting, calculation version and original reports remain intact. See the [phase tracker](small-portfolio-phase-tracker-2026-10-23.md).

P0/P1 was committed and pushed as [0c3d36c](https://github.com/kokin-blip/Coqui-Crypto/commit/0c3d36c10d2ea0b69a010c828ba903acca2f0c5c). Its [isolated verification](evidence/capital-accounting-2026-10-23/commit-isolation/summary.json) excludes unrelated dirty work. [COQ-36](https://linear.app/coqui-crypto/issue/COQ-36/implement-p2-shared-budgets-and-small-portfolio-feasibility) tracks pending P2 implementation, with P1 review/dependency retained. [P2 inspection evidence](small-portfolio-p2-inspection-evidence-2026-10-23.json) records actual source hashes and synthetic probe rows.

P2 delivers native-rule evidence, one revision-bound budget and a pure feasibility service. Its mode after completion is **read-only feasibility**. No profit assessment, funded profit/tax reserve, new order, cancellation, withdrawal, strategy change, campaign migration, deployment or study registration is authorized by this planning pass. P3–P7 remain pending in full. Integration with real budget consumers is required; a helper-only delivery cannot close P2.

## 1. Verified source findings

Inspected both the current dirty checkout and the isolated P0/P1 commit candidate; their unrelated execution-recovery/hourly-study differences must remain separate. These findings concern source, not an installed account.

| Existing component | Verified behavior | Reuse / change |
|---|---|---|
| `core/risk/portfolio-sizing.ts` | Tiers change at $100/$1,000/$10,000; entry caps are 3%/5%/8%/5%, with $25/$25/$25/$50 discretionary floors. Tier crossings change several limits together. | Preserve frozen/default policies. New feasibility consumes an explicit versioned policy snapshot; it must never increase risk or switch tiers to force execution. |
| `adapters/coinbase/product-rules.ts` | Exchange `/products` producer maps `base_increment` to `baseMinSize`, uses `quote_increment` as price tick and assumes `viewOnly=false`; optional enrichment falls back to that base. | Preserve historical snapshots. Add a separately versioned Advanced Trade rule path with field-level provenance; an increment is not evidence of a missing minimum or account permission. |
| `core/paper/index.ts` | `ProductRuleSnapshot` is Coinbase-specific; `normalizePaperOrder` floors base/quote increments and checks minima, but accepts one capacity argument and market orders only. | Reuse decimal floor/validation ideas and regression fixtures. New provider-aware normalization must distinguish buy cash from sell ownership and retain exact amount/quantity legs. |
| `adapters/http/alpaca-paper.ts`, `alpaca-universe.ts` | Native minima/increments exist; account interface lacks a typed non-marginable buying-power field. Universe parsing accepts numbers or strings. | Add exact read-side fields/envelope. Numeric transport values cannot silently acquire lost decimal precision; unsupported precision is explicit. |
| `services/paper/oms-book.ts` | `availableForPaperIntentUsd` reads the book's USD balance for buys and marked owned quantity for sells; no shared hold/claim projection. | Replace independent capacity arithmetic in the new version with a budget reference. Preserve book identity and pending settlement semantics. |
| `services/paper/oms.ts` | Immediate execution and pending execution settlement call that helper separately. Pending settlement runs inside an existing transaction; the immediate fill is priced before its persistence transaction. | Both paths must bind and revalidate the same budget revision at the authoritative transaction boundary. No future-bar or sale proceeds can fund an earlier buy. |
| `services/paper/proposal-preview.ts`, `execution-service.ts` | Preview hashes proposal/revision, holdings, policy and modeled costs, but does not own account cash/claims. | Extend via a new preview version binding budget, rules and fee evidence; reuse expiry, gates and review boundaries. Preserve old report interpretation. |
| `core/execution/planning.ts`, `services/paper/routing.ts` | Routing accepts independent `availableCashUsd` candidate values. The venue-neutral routing service has test callers; no production construction was found. | Reuse plan/assumption IDs, but do not claim production budget integration from this helper. New candidates must be assembled from one canonical account budget. |
| `core/execution/remediation-planner.ts` | Subtracts caller `reservedCash`; combines native minimum with hard-coded $25; fee model and strategy arms are frozen research behavior. | Preserve original arms/functions. A new planner version receives the shared budget and separates native/discretionary constraints; shadow use is a new identified variant. |
| `services/paper/execution-remediation-shadow.ts` | Passes `reservedCash: '0'`; independently simulated matched books. | Frozen collector stays unchanged. A new isolated adapter uses each virtual book's own budget; it must not inherit broker cash or silently change registered behavior. |
| `services/paper/parallel-paper-daily.ts`, `parallel-paper-intraday.ts`, `parallel-paper-utils.ts` | Connected paper paths size from `account.cash`, round native quantities and use $25 floors independently. | Inventory them as mandatory integration/ownership constraints. P2 must not hot-swap an active experiment or alter pending-fee proof. |
| `storage/repositories/execution-authority.ts` | Leases/fencing are profile-scoped. P1 scopes have verified financial account/environment identity but bindings are access metadata. | Reuse scope identity, leases and authoritative Main. Profile-level locks cannot certify exclusive broker cash ownership across databases/hosts. |
| `core/portfolio/contribution.ts` | Allocation arithmetic and batching copy use a discretionary cost threshold, not native-rule/cash feasibility. | Preserve original scenarios; add a separate feasibility result to new views. No claim that batching reduces a purely proportional fee. |

Actual source hashes and a small deterministic sizing probe are recorded in the companion P2 inspection evidence. No new strategy was backtested.

## 2. Targeted documentation resolution

Only execution questions blocking this phase were rechecked on October 23, 2026:

- Coinbase Advanced Trade's [public product schema](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product) exposes separate base/quote minima, increments and price tick. Its `view_only` description requires tradability status for spot. A false/default flag is insufficient account permission. Keep endpoint/product type/account entitlement separate; never treat Exchange observations as complete Advanced Trade rules.
- Coinbase's [account schema](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/accounts/get-account) exposes available balance, hold and portfolio identity. The adapter must preserve their units and prove how holds are reflected before deduplicating them.
- Alpaca's [crypto order documentation](https://docs.alpaca.markets/us/docs/crypto-trading) supports fractional quantity/notional forms and publishes asset-specific minima/increments. Its examples are not current rules. P2 v1 supports the existing quantity market-order form; other forms are explicitly unsupported until their full constraints are normalized.
- Alpaca's [buying-power explanation](https://alpaca.markets/support/can-i-margin-or-short-with-cryptocurrency) identifies `non_marginable_buying_power` and pending fills. Use the observed field, bounded by supported cash; never substitute general margin buying power or invent a settlement delay.
- Alpaca's [fee documentation](https://docs.alpaca.markets/us/docs/crypto-fees) places the fee in the received asset/currency and warns that posting may occur later. Cash debit, net asset delivery and fee contingency are separate modeled legs. Existing execution-safe fee evidence is not complete financial reconciliation.

Documentation resolves the field semantics, not the completeness of any account response, current fee tier, hold matching, or account-wide writer ownership. Missing evidence produces an explicit unavailable result or a separately labeled scenario. No new general literature review is needed.

## 3. Shared identities, inputs and assurance

Use P1 `CapitalScope` as the economic account/environment boundary. For local and exploratory simulation, use the immutable originating book/campaign identity, not a profile nickname. Duplicate books are independent virtual scopes; copied connected facts remain archived until independently reverified. Do not modify P1 hashes, epochs or performance calculation version.

Introduce these versioned pure input types in `packages/core/src/execution/`:

| Type / proposed file | Required contents |
|---|---|
| `NativeExecutionRulesV1` / `native-rules.ts` | Provider, environment, venue asset/product ID and symbol, base/quote currency, supported order form/side/TIF, tradability assurance, native quantity/quote minima/maxima and increments, price tick, precision, source/observed time/expiry/hash. Each optional field is **known value**, **authoritatively not applicable**, or **unknown**; null must not mean unbounded. |
| `AccountBudgetInputV1` / `account-budget.ts` | Scope/book identity; cash/equity/positions and valuation references; provider eligible-spending ceiling; open-order/unknown-submission coverage; hold semantics and matching; committed claims; fee/operational buffers; source revisions, time/coherence and authority/conflict status. |
| `CashClaimV1` | Stable financial scope plus origin namespace/order/intent ID, claim/revision ID, USD or asset quantity, purpose, state, provider reflection evidence and lineage. Types distinguish order commitment, fee contingency, operational buffer, and future reserve/tax claims. P2 creates no funded profit/tax claims. |
| `BudgetReportV1` | Input hash/revision, cash and eligible ceilings, per-claim deductions in each ceiling, free cash, unencumbered sell quantities, deficits/incidents, assurance, missing evidence and expiry. |
| `CapitalFeasibilityInputV1` / `capital-feasibility.ts` | One budget revision; current holdings, proposed net target changes and intent reasons; native-rule refs; quote bounds; fee/cost currency and posting assumptions; explicit strategy/account risk constraints, turnover window and discretionary floor policy. |
| `CapitalFeasibilityReportV1` | Feasible, infeasible or unavailable for the declared request; desired/rounded quantities; executable subset; blocked reasons; post-cost cash/holdings/weights; one-way turnover; residual/dust and shortfall; input/version hashes and expiry. Feasible does not mean authorized. |

Execution venue identity is separate from the canonical research asset key. Existing parallel Alpaca research uses canonical asset mappings; preserve those identities while binding new native rules to the actual Alpaca asset/symbol. No silent Coinbase/Alpaca rule substitution or rehashing historical instruments.

A local simulation explicitly declares its modeled execution venue and the environment in which rules were observed. Its P1 provider `local_paper` is not misrepresented as a connected Coinbase/Alpaca account. Applying observed market rules to a simulated book is a labeled model binding, never proof of provider buying power or order authority.

Availability is component-specific. A supported current budget need not have P1 lifetime P&L; a missing lifetime flow history does not automatically hide observed current cash. Conversely, available economic P&L is insufficient proof of spendable cash or reservation authority. Read-only feasibility can show an explicit scenario when account fees/ownership are unresolved, but that scenario cannot become an execution or P3 reserve-eligibility input.

Freeze v1 freshness limits in its evidence policy: account/position/open-order capture and native-rule verification no older than 30 seconds; quotes no older than 60 seconds with at most 5 seconds permitted provider clock skew. These follow the existing bounded preflight conventions and are not new polling intervals. Expiry is the earliest relevant source expiry and at most 60 seconds after preview issue. Future timestamps outside allowed quote skew, incomplete acquisition windows or intervening revisions invalidate the result. Static/historical rules and hypothetical fees remain scenario evidence. Fee terms retain their provider/as-of validity; no arbitrary timestamp can turn missing account terms into verified fees. If existing capture cadence cannot satisfy freshness, show stale/unavailable and direct the user to the existing refresh path.

## 4. Budget arithmetic and concurrency

For each independent supported ceiling `j`, calculate:

```text
capacity_j = observed ceiling_j
           − obligations not already reflected in that ceiling
free_cash = max(0, min(capacity_cash, capacity_venue_eligibility))
```

For local paper, the venue ceiling is explicitly not applicable; use the supported book cash ceiling. Report any negative pre-clamp capacity as a deficit, not a successful zero budget. Preserve active NAV = managed equity − funded profit/tax reserves once; order holds constrain cash but remain part of active invested/trading equity. Pending payments are subsets or supported receivables, never additional equity.

Deduplicate each economic obligation by scope and stable origin identity. An order already reflected in provider available balance/buying power is not subtracted again there; it may still need subtraction from a total-cash ceiling. Never compute `min(cash,buyingPower) − all holds` indiscriminately. Unknown aggregate hold/order matching yields unavailable exact spendable cash. Show observed balances and the reason separately. Foreign/manual broker orders count even if Coqui did not initiate them. Unknown submit/cancel outcomes retain their commitment until reconciliation; timeout is not a release.

Hand fixture: total cash $100, venue eligible cash $80 already reflecting order O=$20, local unreflected approved intent L=$10 and hypothetical funded claim R=$15. Cash path is $100−$20−$10−$15=$55; venue path is $80−$10−$15=$55. Subtracting O twice would incorrectly show $35. A subsequent unmatched $60 external debit creates a $5 shortfall: block new allocations, retain claims and raise an accounting incident. This is a synthetic future-claim fixture, not an enabled reserve.

Build the budget from immutable source/claim revisions, not a mutable second balance ledger. Import/reference existing OMS journals and provider holds; mirror observations only through linked identities. An observed order commitment cannot also become an independently spendable claim. A fee posting replaces the corresponding contingency through explicit reconciliation, rather than charging both. Fee estimates remain assumptions.

Bind every current/queued new-version consumer to the same base budget revision. Sequential intentions apply a deterministic tentative consumption overlay, not independent copies of the full cash amount. At the existing authoritative local transaction boundary, compare-and-swap the budget/claim revision, revalidate ownership/fence and journal the existing intent commitment atomically. Broker calls remain outside transactions and behind the existing OMS; no new submitter is introduced. Preview reads create no commitment.

Two simultaneous proposals for $70 against $100 must not both acquire capacity. One succeeds only at an authorized existing local intent boundary; the other expires/replans against the next revision. P2 tests inject failures before/after that transaction and reconcile restart state. Actual connected claims remain blocked if another profile/host/database can spend the same account. A local database lock or fresh P1 binding is insufficient cross-host proof.

## 5. Joint feasibility algorithm

1. Validate identity, membership, evidence bounds, rule applicability, quote freshness, fee model, budget revision and intent purpose. Unknown required data returns unavailable. A known violated hard rule returns infeasible; keep those states distinct.
2. Net desired exposures by asset before sizing, retaining strategy attribution. Use the declared order of intentions; risk reductions precede discretionary additions. Do not credit unfilled sale proceeds to buys. Hypothetical staged sale/buy paths are labeled conditional and require reassessment after settlement.
3. Calculate active-NAV targets and preserve existing account-level caps. Apply the stricter applicable position, total exposure, turnover, order-count, order-size and cash constraints. Include off-target holdings and already-held concentration; a new reserve denominator cannot loosen a hard limit.
4. Compute cash debit and asset delivery with native units and cost currency. Use executable bid/ask or a declared conservative bound; do not add the spread a second time to a price that already includes it. Fees in received crypto reduce delivery, not automatically USD cash twice. Unsupported price/fee currencies make dependent feasibility unavailable.
5. Bound the requested change by cash/ownership and every risk constraint; floor to the quantity increment. Recheck actual notional, fee effects, maxima and concentration after rounding. Never round quantity upward merely to meet a minimum. Limit prices/notional orders remain unsupported in v1 unless a separate form-specific rule path is implemented and tested.
6. Check **native minima**, the separately named **discretionary economic floor**, and the declared **risk-reduction treatment** independently. A versioned isolated risk-exit policy may bypass the discretionary floor/cost screen, never native legality, ownership, freshness, authority, kill switch or applicable hard stops. Existing frozen policies retain their historical behavior.
7. Validate the complete selected subset and post-cost portfolio jointly. Return cash residual, exact rejected changes, concentration/turnover residuals and genuine dust. If one proposal conflicts, deterministically defer it; do not increase weight, leverage, per-trade risk or trade count. A no-trade outcome caused by constraints is not strategy success.

The v1 service is a deterministic feasibility validator/rounding planner for a declared target and ordering, not an optimal allocation solver. A feasible result includes a concrete witness. Rejected requested targets do not prove every alternative allocation impossible. Necessary capital bounds such as `minimum / allowed weight` are labeled lower bounds, never a certified operating floor. For P3, re-evaluate the **actual retained portfolio** after a hypothetical reserve. If a required strategy operating-floor certificate cannot be established for the declared template, return unavailable and defer that reserve; do not substitute a tier threshold or a global minimum account claim. A universal optimizer is outside this phase, not a silently promised capability.

## 6. Exact files and integration ownership

| Area | Planned change |
|---|---|
| Core | Add `execution/native-rules.ts`, `execution/account-budget.ts`, `execution/capital-feasibility.ts`; export through existing execution index. Keep legacy sizing, planner and normalizer numerics intact; new adapters/versioned entry points consume the common result. |
| Adapters | Add Coinbase `capital-native-rules.ts` using bounded Advanced Trade GET evidence, without changing old Exchange snapshots; extend Alpaca read models for non-marginable buying power, asset precision and order/hold evidence. Reuse existing deadlines, GET capability restrictions, account checks and sanitized acquisition envelopes. |
| Storage | Add next free migration (97 at this inspected base), `repositories/capital-budget.ts` and exports. Extend impact/copy/restore handling without changing backup manifest categories. |
| Services | Add `portfolio/capital-budget.ts`, `portfolio/capital-feasibility.ts`, and source/consumer adapters under `paper/`; reuse P1 scope access, immutable acquisitions and revision hashes. |
| Main / IPC | Add `main/capital-feasibility-handlers.ts`; register `capital.budget` and `capital.feasibility` as strict local read channels. Neither channel performs provider reads, creates claims or invokes an order API. Source refresh remains in the existing authorized acquisition boundary; no new polling schedule. |
| Renderer | Add `app/CapitalFeasibility.tsx` beside allocation/capital evidence; expose rule/cash/constraint explanations and explicitly labeled local scenarios. Reuse `ChannelNotice`, `MetricInfo`, provenance and theme/keyboard patterns. No profit-share controls until P3. |
| Tests | Add native-rules, budget, feasibility, consumer-integration and UI suites; extend existing OMS/routing/preview/lifecycle tests with version-bound behavior, retaining frozen legacy expectations. |

Proposed additive tables, finalized before migration implementation:

- `capital_native_rule_evidence_v1`: immutable raw sanitized field subset, endpoint/product/venue identity, normalized version, applicability, acquisition timestamps and hashes.
- `capital_budget_source_evidence_v1`: immutable cash/eligibility/position/order coverage, source references and hold-reflection evidence. It references P1 facts; it never updates them.
- `capital_cash_claim_revisions_v1`: append-only typed observations/commitments with scope/origin uniqueness, revision lineage, amount/asset, state and source proof. Only existing internal simulation intent boundaries may write new operational claims in P2; no funded profit/tax claim command. Provider obligations are evidence, not new instructions.
- `capital_budget_reports_v1` and `capital_feasibility_reports_v1`: immutable version/input manifests, period/as-of, output, missing evidence, expiry and predecessor links.
- A small operational per-scope revision/checkpoint row supports transactional CAS. It grants no cash authority. Snapshot retry is idempotent; source/claim conflict remains unresolved rather than last-writer-wins.

Use canonical decimal text, JSON/SHA-256, FKs and immutable triggers as in P1. Migration creates empty structures; historical fill/cash changes do not fabricate claim ownership. Source capture + normalization + checkpoint is atomic; failed capture advances no completeness. Archived profile copies cannot create current claims; same-profile restore retains as-of evidence and blocks current connected action pending fresh reconciliation. Keep owner fencing and authority metadata separate from immutable financial facts.

Contracts are added in `packages/contracts/src/schemas/capital-feasibility.ts` and registered/exported through the existing channel registry. `capital.budget` accepts an accessible scope/book reference, not client-supplied balances or holds. `capital.feasibility` accepts a scope, expected budget revision and stored proposal reference or explicitly hypothetical scenario. Main resolves actual sources, approved constraints, ownership and current evidence. Renderer-supplied facts cannot obtain verified status or relax a hard risk policy. Scenario results are labeled throughout and cannot be used as an observed budget/claim input. Invalid, inaccessible or mismatched references fail closed.

## 7. Consumer adoption and compatibility gate

| Consumer | Required new-version integration / proof |
|---|---|
| Current capital/feasibility views and contribution explanation | Obtain one budget report and bind displayed quantities/deferrals to its revision; scenario assumptions cannot masquerade as observed funds. |
| `PaperExecutionService` preview + preflight | Bind preview hash to budget/rules/costs/expiry; stale budget is rejected before the existing submit boundary. |
| `PaperOmsService` immediate and pending paths | Consume the same scoped budget/owned quantities; compare revision inside actual existing transaction and retain pending commitments until settled/expired through their real lifecycle. |
| Venue-neutral route planning/placement | Assemble candidates from the canonical report and include its revision in assumption hashes; shared cash cannot be copied into multiple routes. Test the actual service, not just `routeExecutionPlan`. |
| New isolated remediation/simulation version | Consume independent virtual-book budgets and return exact residuals. Original registered arms, collector and $100k book remain frozen until P4 creates a new identified replay. |
| Connected daily/intraday paper paths | Inventory/report their legacy cash semantics and ownership conflicts in P2. Prepare/test the common adapter with injected GET evidence and a submit trap. Installing it into an active connected campaign requires the later reviewed P6 path and existing operational gates. |

This is an explicit compatibility boundary: **all consumers allowed to use the new budget/claim capability must consume the same revision**. An active legacy writer on the same connected account makes that account's new shared-reservation assurance unavailable; it is not silently exempted while a preview claims protection. Frozen legacy paths retain their identities and cannot access new reserves. No new feature/version auto-activates on upgrade, restore or restart.

P2 is not complete merely because its pure service passes. The integration batch must demonstrate the actual existing local OMS/preview/routing transaction boundaries in disposable isolated books, and prove connected legacy writers keep new reservation use blocked. If that cannot be delivered safely without changing an active/frozen writer, record the phase as partial and propose the dependency/scope decision explicitly; do not mark integration complete or move it silently into P6.

## 8. Reviewable implementation batches

| Batch | Deliverable | Completion gate |
|---|---|---|
| P2-A | Freeze source fixture inventory, units/hold semantics, typed reason codes and exact contracts; record P0/P1 commit and dirty-tree baseline | Every required input is known/not applicable/unknown; fixture hand arithmetic independently reviewed; original roadmap and P1 hashes preserved |
| P2-B | Additive storage + native rule/budget evidence normalizers and acquisition hooks | Wrong product/account/environment, stale/capped source, missing decimals/flags, retry/conflict, migration backup/rollback/copy/restore cases pass; no write-capability expansion |
| P2-C | Pure shared budget with reflection matching, claim lineage, deficit reporting and revisions | No double deductions; foreign orders/unknown submissions retained; fee revisions and atomic concurrent local claims conserve cash |
| P2-D | Pure joint feasibility and new-version normalization adapters | Capital grid/boundaries, post-cost constraints, risk exits/dust and unavailable states pass; no risk expansion or global-minimum claim |
| P2-E | Consumer integration at actual existing local transaction boundaries and read-only connected adapters | Real integration fixtures prove shared revisions, stale rejection, pending commitments and submit traps; active/frozen campaigns unchanged; unresolved ownership blocks connected assurance |
| P2-F | Read channels, compact evidence UX and compatibility acceptance | Read handlers make no provider/write calls; lifecycle/security/UI checks plus required typecheck/lint/tests/build/native gates pass; update all-phase tracker and Linear without closing owner/release gates |

Implement one batch at a time after rereading its requirements and relevant saved roadmap sections. Record completed/remaining work, checks, blockers and dependencies after each delivery. P2 remains planning only until separately authorized implementation begins.

## 9. Required independent tests and acceptance

Use $50, $100, $250, $500, $1,000, $2,500, $5,000, $10,000, with $100,000 as a control. Add values just below/at/above actual helper tier boundaries ($100/$1,000/$10,000), every derived native minimum and one quantity increment on either side. Fix the policy within a scenario; an automatic tier switch is not a successful solution.

Minimum fixture set:

1. $100 capital, 5% intended entry and $25 discretionary floor: $5 desired, no valid entry at that floor. $500 gives $25 before costs; costs/native increments may still reject it. A 4% sleeve on $500 is $20 before splitting. These are necessary-bound examples, not guaranteed minimum balances.
2. $100 total/$80 eligible cash with O/L/R claims above: $55 free, not $35; a $60 debit exposes a $5 deficit. Duplicate/provider-linked order representation changes nothing.
3. Cash $100 but observed crypto eligibility $0: observed cash remains visible, new buy capacity is zero. Missing eligibility is unavailable, never assumed equal to cash.
4. Two $70 proposals against $100; stale queued proposal, crash/retry, fee revision and external debit. Exercise real transaction/CAS boundaries and prove no overspend or silent claim release.
5. Owned 0.123 base units, 0.01 increment and 0.10 native minimum: sell 0.12 leaves 0.003 dust; do not claim a fully liquidated position. A remaining subminimum position returns an explicit unexecutable risk residual.
6. A legal $10 risk reduction can bypass a newly declared discretionary $25 floor in the isolated version; it cannot bypass native minimum, quantity ownership, kill switch or freshness. A frozen legacy study retains its old decision.
7. A hypothetical reserve raises an existing position's active-NAV weight; the account cap still applies. Proposed cash retention cannot force excess concentration or relax turnover. An already-breached cap is visible even if every new buy is blocked.
8. Received-asset buy fee, received-USD sell fee, fixed external expense, embedded spread/slippage and later posted fee evidence: debit/delivery and attribution each count once. Costs are model assumptions until posted; missing fee currency pricing affects dependent output only.
9. Missing min vs absent-by-authority max, numeric precision loss, halted/view-only product, unsupported order form, wrong venue/symbol, stale rule/quote/fee, capped open-order list, unmatched aggregate holds and unknown external activity fail explicitly.
10. Connection rotation/removal, duplicate account bindings, two hosts/databases, same-profile restore and copied virtual book: old evidence supplies no fresh ownership/funds. New read IPC is access-checked and non-mutating.

Fast-check supplements hand fixtures with cash/quantity conservation, idempotency, deterministic ordering and no-risk-increasing rounding. Shrunk counterexamples are saved. Consumer integration tests must fail if the actual service reverts to its old independent cash helper. Negative assertions cover submit/cancel/transfer/registration ports, both during reads and source refresh failure.

Acceptance requires all batches, all actual new-version consumers sharing revisions, no false minimum/floor certification, exact conservation and truthful availability. Run focused suites, repository typecheck/lint/tests/build and appropriate production desktop smoke/UI checks after implementation. These establish mechanics, not after-cost alpha, connected exclusivity or research qualification. P0/P1 reports, schema-2 Coinbase hashes, current defaults, frozen manifests/results, negative findings, consumed holdouts, manual Resume, kill switches and permission gates must remain intact.

## 10. Decisions and evidence still open

No additional product preference is needed to begin P2-A. Defaults remain unchanged; v1 supports existing quantity market-order form, one USD scope and read-only results. There is no universal minimum starting balance and no automatically raised risk tier.

Actual account fee terms, current native responses, aggregate hold matching, source timing and exclusive broker ownership are evidence requirements. Missing items produce the states specified above. Cross-database/host account ownership cannot be certified from this checkout; connected claims stay blocked pending the later operational review. An implementation finding that conflicts with safe consumer adoption must be surfaced before that batch, not resolved by weakening the gate.

**Prompt used**

Push and commit that then Lets move on to P2. Reread its full requirements in the saved roadmap, inspect the current code, and prepare a concrete implementation plan before writing code. Preserve P0/P1 and the complete P0–P7 scope.
