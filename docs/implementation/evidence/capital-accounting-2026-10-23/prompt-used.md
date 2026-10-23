PLEASE IMPLEMENT THIS PLAN:
# Coqui P0/P1: capital-flow accounting and corrected performance

## 1. Scope, decisions and verified findings

The [saved P0–P7 roadmap](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/docs/implementation/small-portfolio-profit-policy-plan-2026-10-23.md) remains the durable source of truth. Its architecture, future requirements, research findings, dependencies and safety gates remain intact. This implementation sequence covers **P0/P1 only**.

Two decisions are settled:

- **Evidence ingestion only:** P1 adds no manual cash-flow entry or correction screen. Existing reconciliation notes cannot establish verified contributions.
- **Exact or unavailable:** show each balance, dollar P&L and return metric only when its required evidence supports it. Missing timing, prices or history produce an explanatory unavailable state. Approximations remain an optional later enhancement, excluded from verified performance and reserve eligibility.

No further product decision is required to start these steps.

### Verified current behavior

Read-only probes against current source reproduced these problems:

| Minimal case | Current result | Required corrected result |
|---|---|---|
| Value remains $500; open cost changes from $500 to $300 | Infers a $200 withdrawal and 40% return | Basis changes create no capital flow or return |
| $500 becomes $1,000 solely through a $500 deposit over one year | Step return 0%; annualized return 100% | Investment P&L and return are zero |
| $1,000 becomes $500 solely through a $500 withdrawal | Step return 0%; drawdown −50% | Flow-adjusted drawdown is zero |
| Two observations are two days apart | Uses the intervening return in daily risk statistics | Preserve the gap; daily risk metrics unavailable |

Additional source findings:

- Lot-based “complete” portfolio snapshots establish pricing coverage for tracked holdings, **not complete account cash or capital-flow history**.
- The desktop paper-performance handler does not supply capital flows to its existing calculation.
- Alpaca performance acquisition is currently nondurable and bounded: activity pagination, order limits and coherence checks can leave financial history incomplete.
- Coinbase stores useful immutable acquisition evidence, but its normalized records omit some portfolio identity, counterparty and transfer-fee information needed for stronger accounting.
- Database migration version is currently **95**. The existing runner already performs pre-migration backups, transactional migrations and newer-schema rejection.
- The checkout contains substantial unrelated modified and untracked work. Implementation must preserve it through focused changes without resetting, stashing or broad formatting.

These are verified source and synthetic-probe findings, not findings about an installed account’s historical returns.

### Durable planning records

The first implementation batch will add a P0/P1 addendum and phase tracker alongside the saved roadmap. Preserve the original roadmap and companion evidence; record their current hashes before edits.

The tracker must retain every phase:

| Phase | Requirements retained |
|---|---|
| P0 | Definitions, scope and source inventory |
| P1 | Capital-flow accounting and corrected performance |
| P2 | Shared budgets and small-portfolio feasibility |
| P3 | Profit-reserve evaluation and previews |
| P4 | Capital-aware simulation |
| P5 | Strategy and policy experiments |
| P6 | Optional, reviewed paper integration |
| P7 | Prospective evaluation and qualification |

After each delivery batch, record completed requirements, remaining requirements, checks, blockers and dependencies. Before starting another phase, reread its full requirements in the saved roadmap. This planning pass marks no implementation phase complete.

## 2. Accounting and performance specification

### Account identity and tracking boundaries

Use one USD capital pool per verified financial account and environment:

- **Coinbase:** verified retail portfolio identity, with its member account UUIDs.
- **Alpaca paper:** verified broker account ID and paper environment.
- **Local paper:** simulation book identity derived from its immutable origin and originating profile.
- **Robinhood:** retain observed balances, but financial performance remains unavailable until adequate capital-flow evidence exists.

Profile IDs govern access; they do not establish broker-account identity. Credential rotation, connection renaming or reconnecting the same account must not create a new economic account.

Do not calculate combined multi-account performance in P1. A transfer between two separate pools is an outflow and inflow respectively; it becomes internal only within a separately proven consolidated scope.

Create an explicit tracking epoch from a verified economic opening valuation. Store opening cash, assets, supported receivables/liabilities, prices, membership and provenance. Opening market value is separate from acquisition cost basis.

Reuse the immutable local paper origin when its evidence supports reconstruction. For connected accounts, use historical opening evidence only when reliable. Otherwise begin forward tracking at the first qualified observation and show **“Tracking since …; earlier performance unavailable.”** Never infer lifetime contributions from current equity.

A new observation or reconnect cannot silently reset an existing loss or erase incomplete history. Any later tracking segment must retain its predecessor and reason.

### Event treatment

| Activity | P1 treatment |
|---|---|
| Deposits | External contributions only when account boundary, amount, currency, status and period membership are supported |
| Withdrawals | Record external outflow, fees and confirmed user receipt separately; never label an unexplained withdrawal “profit paid” |
| Pending transfers | Preserve pending evidence. Do not count both account cash and a receivable, or claim confirmed receipt prematurely |
| Internal transfers | Require matching identities and reconciled legs within the same pool; exclude principal from external flows |
| Manual broker trades | Include verified account activity regardless of initiator; trades are internal only when their funding/settlement legs support that classification |
| Manual tax lots and reconciliation notes | Remain cost-basis or investigation evidence; never generate verified capital flows |
| Fees | Retain actual asset/currency debits and execution/posting links. Deduct account-recorded costs once through equity; fee totals are attribution, not another P&L deduction |
| Income | Support reconciled USD cash interest as separately attributed investment income. Unsupported rewards, staking and adjustments remain explicit |
| Corrections | Append evidence and linked revisions/reversals; retain the original facts and reports |
| Duplicate events | Deduplicate by financial account, source namespace and provider event identity—not sync-run ID |

Preserve gross amount, account debit/credit, fee and net receipt as distinct facts when supplied. If their relationship is unknown, do not invent the missing split.

An unknown historical basis blocks affected realized/unrealized lot P&L. It does **not** automatically block total economic P&L when opening value, external flows and terminal equity are independently known. Likewise, incomplete fee attribution need not hide independently supported economic P&L.

### Provider normalization rules

**Coinbase**

Reuse existing account, fill and transaction acquisitions and immutable sync records. Add a separately versioned capital-evidence envelope; do not change historical schema-2 dataset hashes.

Retain portfolio membership, relevant counterparty identity, transfer-fee fields, provider timestamps and acquisition coverage. Whitelist supported classifications:

- Completed USD `fiat_deposit` and `fiat_withdrawal` are capital-flow candidates.
- Transfers require proven scope boundaries and matching legs.
- Advanced Trade fills and associated transaction representations must be linked rather than counted twice.
- Bare `buy`, `sell`, `send`, `receive` or `tx` records do not independently prove internal funding or an external contribution.

Current official documentation distinguishes these transaction categories and statuses. It does not establish that `created_at` is the financial effective time or that `native_amount` is a trustworthy historical arrival valuation. Those fields cannot supply missing proof. [Coinbase transaction documentation](https://docs.cdp.coinbase.com/coinbase-app/track-apis/transactions)

**Alpaca paper**

Persist the financial evidence already obtained by the existing performance refresh. Keep existing request deadlines, bounds and account checks.

- Confirmed USD CSD/CSW activities are capital-flow candidates.
- JNLC remains ambiguous without evidence establishing its economic purpose.
- Retain FILL execution timestamps, posted fees and supported interest separately.
- Date-only activities retain date precision. Portfolio-history cash-flow buckets cannot become invented intraday events.

Alpaca documents nontrade activity dates as potentially occurrence or settlement dates, and JNLC as a cash journal entry. [Alpaca account activities](https://docs.alpaca.markets/us/docs/account-activities)

**Local paper**

Reuse immutable book origin, ledger entries, fills and valuation evidence. Derive simulated capital flows only from explicit book-funding activity. Do not infer them from balances, costs or trade proceeds.

### Coverage and revision rules

Every acquisition records its requested interval, returned coverage, terminal pagination state, limits, failures, account membership and source hashes.

- Successful pagination alone does not prove lifetime financial completeness.
- A capped, conflicting or missing interval remains a coverage gap.
- Unknown activity that could represent external funding blocks affected capital-flow calculations.
- Provider creation time, observation time and recording time remain distinct.
- An event whose effective interval overlaps a requested period boundary can make that period’s dollar P&L unavailable.

Identical repeated facts are idempotent. A supported pending-to-completed transition creates a revision of one event. Conflicting financial values without an authoritative revision order remain unresolved; receipt order is not a last-writer-wins correction policy.

### Versioned calculations

Introduce calculation version **`capital-flow-performance-v1`**, separate from legacy helpers.

For a supported period:

```text
Economic P&L =
    terminal managed equity
  − opening managed equity
  − external contributions
  + confirmed net external outflows
```

Equity includes cash and assets once, plus only supported receivables and liabilities. Raw balance change remains a separately labeled number.

For time-weighted return:

- Initialize unit NAV from verified opening capital.
- External flows issue or redeem units using supported flow-time valuation and ordering.
- Sales, basis changes and internal transfers do not change units.
- Missing flow-time marks make affected TWR unavailable; use no Dietz approximation, interpolation or assumed midnight timestamp.
- A period with no external flows can have a supported endpoint return despite missing intermediate daily marks.
- Calculate daily drawdown, volatility, Sharpe, Sortino and time-underwater measures only from a complete, correctly timed daily NAV series. Never bridge missing days.
- Annualized TWR uses actual elapsed time and remains unavailable for periods shorter than one year.
- Zero denominators remain unavailable. A genuine zero-NAV loss is distinguishable from complete capital redemption. Subsequent funding starts a linked return segment; do not silently stitch across an invalid denominator.

Report dated money-weighted return separately using opening capital, contributions, confirmed outflows and terminal value. V1 returns an IRR only when a unique solution is certified for the supported cash-flow pattern. Missing dates, no solution, nonconventional patterns with unproven uniqueness, or numerical failure produce explicit unavailable reasons.

Use decimal arithmetic throughout. Preserve source precision; round only according to the versioned output convention. Existing decimal, hashing and validation dependencies are sufficient.

Each metric returns either:

- `available`: value, method/version, period and evidence references; or
- `unavailable`: reason codes, missing evidence and restoration guidance.

Availability is metric-specific. Staleness and observation time are displayed separately. No unavailable value becomes zero.

## 3. Architecture, files and compatibility

### Additive storage

Add migration **v96** at the inspected base, registered after v95. If another delivery occupies that number, append at the actual next version without modifying predecessors.

Use these tables:

| Table | Required contents |
|---|---|
| `capital_scopes_v1` | Immutable scope ID, provider, environment, verified account identity hash, USD reporting currency |
| `capital_scope_bindings_v1` | Profile access, connection association, active/archived state and ingestion checkpoint; operational metadata only |
| `capital_source_batches_v1` | Immutable acquisition identity, sanitized financial payload, coverage, membership, source references and hashes |
| `capital_event_revisions_v1` | Logical event key, revision hash, classification, provider status, effective-time precision, observed/recorded times, asset/cash/fee legs, nullable external-flow value and correction links |
| `capital_tracking_epochs_v1` | Opening valuation reference, start boundary, historical limitations and predecessor relationship |
| `capital_valuation_evidence_v1` | Cash, positions, receivables/liabilities, price provenance, valuation time, completeness and missing components |
| `capital_performance_reports_v1` | Calculation version, exact input manifest/hash, period, metric results, availability reasons and superseded-report link |

Amounts and quantities use canonical decimal text. Canonical JSON and SHA-256 identify immutable payloads. Enforce foreign keys, event/revision uniqueness, exact-retry idempotency and no-update/no-delete triggers on financial facts.

Keep originating profile identity inside immutable provenance. Only access bindings use rewritable profile metadata. This avoids rewriting financial identities during profile duplication.

Migration creates empty structures. Historical normalization runs afterward through an idempotent service against existing evidence; it does not fabricate deposits or rewrite legacy tables.

### Reuse and change inventory

Paths below are relative to the linked absolute directories.

| Area | Planned files and integration |
|---|---|
| [Core portfolio](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/core/src/portfolio) | Add `capital-ledger.ts` and `capital-performance.ts`; export through `index.ts`. Reuse decimal/hash utilities. Preserve numerical behavior of `performance.ts`, `paper-performance.ts`, `broker-cash.ts` and `broker-equity.ts` |
| [Storage repositories](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/storage/src/repositories) | Add `capital-accounting.ts`; extend `profile-impact.ts`. Reuse existing Coinbase, connection, paper-origin, paper-ledger and valuation repositories |
| [Storage migrations](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/storage/src/migrations) | Add `v96.ts`; extend `index.ts` |
| [Profile lifecycle](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/storage/src/profiles) | Extend `duplication.ts` to archive capital bindings and clear ingestion associations/checkpoints. Reuse existing backup and restore mechanisms |
| [Portfolio services](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/services/src/portfolio) | Add `capital-accounting.ts`, `capital-sources.ts` and `capital-performance.ts`: normalization, atomic ingestion and read projection |
| [Account services](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/services/src/accounts) | Hook successful evidence persistence in `coinbase-sync.ts` and `connection-snapshots-v2.ts`; reuse verified identity and connection eligibility checks |
| [Coinbase adapters](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/adapters/src/coinbase) | Extend `account-evidence.ts` and `transaction-evidence.ts` with a separate capital-evidence envelope while preserving old normalized datasets and hashes |
| [HTTP adapters](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/adapters/src/http) | Preserve needed financial fields in `alpaca-paper.ts` and `alpaca-portfolio-history.ts`; expose only GET capabilities to accounting acquisition |
| [Contracts](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/packages/contracts/src) | Add `schemas/capital-performance.ts`; register through `channels.ts` and applicable exports |
| [Desktop main](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/main) | Add `capital-handlers.ts`; wire `composition.ts`/dispatch. Integrate existing acquisition in `alpaca-performance-handlers.ts` and capture in `paper-performance-evidence.ts` |
| [Renderer](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/apps/desktop/src/renderer) | Update `app/Performance.tsx`, `app/TerminalAlgorithm.tsx`, `app/BrokerAccountPerformance.tsx`, relevant evidence labels and `query/refetch.ts`; reuse existing metric explanations and provenance components |

Preserve tracked-holdings snapshots as their existing evidence class. Do not promote them into complete account valuations.

### Public interfaces and data flow

Add two read-only channels:

- **`capital.scopes`**: accessible account/book scopes, epochs, observation times and coverage state.
- **`capital.performance`**: selected scope/epoch and requested period; returns schema version, calculation version, input hash, observations, independently available metrics and evidence limitations.

Existing channels remain compatible. Current performance displays consume the new projection; archived reports retain their original calculation and labels. Do not silently use legacy percentages as a fallback.

Ingestion occurs after existing evidence acquisition/persistence and local paper capture. Normalize, append facts, update the binding checkpoint and save the canonical report atomically. Failed ingestion advances no checkpoint and cannot make a partial batch verified. Existing source evidence remains available for retry.

The new performance channels read local evidence only. They introduce no provider polling schedule, credentials, write endpoint or financial action.

Keep existing benchmark evidence. Where it lacks matching funding assumptions, do not present a corrected excess-return comparison; that remains unavailable pending later simulation work.

### Existing-profile safety

- Use the existing backup-before-migration and rollback behavior; preserve newer-schema rejection.
- Missing historical evidence remains unavailable after upgrade.
- Same-profile restore retains original financial identities and historical reports; fresh observations must establish continuity before claiming current coverage.
- Profile duplication preserves capital facts as archived evidence, clears active connection bindings/checkpoints and grants no account authority.
- A copied local book cannot automatically continue its source book’s active capital scope.
- Include new durable facts in existing deletion-impact categories without changing backup-manifest key contracts or double-counting records.
- Preserve all default-off settings, permission checks, execution proofs, kill switches, pause/Resume behavior and research qualification gates.

## 4. Small delivery batches

| Batch | Work | Completion gate |
|---|---|---|
| **P0-A: baseline and durable specification** | Save the addendum and all-phase tracker; record branch/commit, dirty-file inventory, source hashes, source limits and accepted decisions | Roadmap preservation verified; unrelated work identified; no application behavior changes |
| **P0-B: definitions and source fixtures** | Freeze account boundaries, event classifications, coverage rules, metric availability and hand-calculated regressions | Every supported source case has evidence requirements; unresolved cases have explicit unavailable behavior |
| **P1-A: contracts and storage** | Add types, migration, repositories, immutable facts and access bindings | Migration rollback, retry, conflict, backup, restore and duplication tests pass |
| **P1-B: local paper ingestion** | Normalize explicit origin/ledger/valuation evidence; historical import is deterministic and idempotent | No inferred funding; original records/hashes unchanged; incomplete historical marks remain explicit |
| **P1-C: connected evidence ingestion** | Add Coinbase envelope and durable Alpaca financial acquisition using existing reads | Account identity, coverage, duplicate representation, pending transitions and ambiguous activity tests pass; zero write capabilities |
| **P1-D: corrected calculations** | Implement economic P&L, exact unit NAV, supported risk metrics and certified MWR with input manifests | Independent arithmetic fixtures and event-sequence properties pass; legacy outputs unchanged |
| **P1-E: read projections and displays** | Add channels, switch current accounting displays, explain scope, version, gaps and restoration | No misleading zero/fallback; available balances remain visible; no provider calls from new read handlers |
| **P1-F: compatibility and acceptance** | Run integrated lifecycle, UI and safety regression checks; update tracker with remaining account-specific evidence blockers | P1 capability accepted separately from connected verification, research qualification and release |

Every batch updates the tracker and corresponding Linear issue when writes are permitted. Record exact initiating/follow-up prompts, verification and local-versus-merged status; completion comments end **Completed by: kokin**. Reuse matching issues and preserve existing milestone/dependency gates.

P2–P7 remain pending in full. No strategy, budget, reserve, order, withdrawal, deployment or study-registration work enters these batches.

## 5. Tests, acceptance and outstanding evidence

### Required regression and accounting cases

Add focused suites under the [tests directory](/Users/kokinmartinez/Documents/ChatGPT/Coqui-Crypto/tests), retaining existing legacy expectations:

- The four demonstrated accounting failures above, with independent expected results.
- Deposit and withdrawal neutrality at $50, $100, $250, $500, $1,000, $2,500, $5,000 and $10,000; $100,000 remains a control.
- Sale into retained cash, basis-only correction, manual principal withdrawal and paired internal transfer.
- Explicit $102 account debit consisting of $100 confirmed external delivery and $2 account fee: economic P&L decreases by $2.
- Embedded execution fee plus later fee evidence: cost counted once.
- Non-USD fee or in-kind contribution with missing historical valuation: only dependent metrics unavailable.
- Unknown opening tax basis with supported economic opening/flows: total economic P&L remains available; affected lot P&L unavailable.
- Duplicate acquisitions, overlapping pages, duplicate fill/transaction representations, pending completion and conflicting revisions.
- Late correction creates a new report linked to the old report; the old report reproduces unchanged.
- Date-only flow, missing flow-time mark, boundary ambiguity, missing daily sample and incomplete opening history.
- No-flow period with supported endpoints but missing daily marks: period return can remain available while daily risk metrics are unavailable.
- Wrong account/environment, credential rotation, connection removal, profile switch, restore and duplication.
- Zero capital, complete redemption, genuine total loss and later funding.
- Unique supported IRR, no root and unproven/non-unique-root cases.

Use `fast-check` event sequences for conservation, idempotency and flow neutrality. Back them with hand-calculated fixtures rather than tests that reproduce implementation logic.

### Acceptance criteria

P1 is complete when:

1. Current verified performance derives external flows exclusively from the canonical projection.
2. Deposits, withdrawals, internal transfers and basis changes cannot manufacture investment returns.
3. Every available metric identifies its scope, period, calculation version and supporting inputs.
4. Missing evidence has a typed unavailable state with useful restoration guidance; independently supported metrics remain visible.
5. Financial corrections are append-only, deterministic and auditable.
6. Historical reports, Coinbase dataset hashes, frozen research results, negative findings and consumed holdout identities remain unchanged.
7. Existing profiles migrate safely; copied/restored evidence creates neither fresh coverage nor authority.
8. Integration tests prove no order submission, cancellation, withdrawal, registration or deployment side effects.
9. Focused suites and repository typecheck, lint, tests and build pass. Any existing unrelated failure is reproduced and documented rather than silently attributed to this change.
10. Tracker and issue updates distinguish implementation completion from outstanding owner, connected-evidence, review and release gates.

Actual account history completeness, transfer receipt evidence and provider coverage are **evidence requirements**, not assumed facts. A provider-specific metric may legitimately remain unavailable after the capability is implemented.

This pass changed no application files or saved artifacts. The planning update to [COQ-34](https://linear.app/coqui-crypto/issue/COQ-34/research-profit-distribution-policy-and-quantitative-trading-additions) remains pending because Plan Mode prohibits writes; no synchronization or implementation completion is claimed.

