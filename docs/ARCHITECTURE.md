# ARCHITECTURE

Package layout, boundaries, technology choices, data flow.
Invariants live in `CLAUDE.md` and are not repeated here.

---

> **`docs/adr/0001-stack.md` is Accepted.** The owner selected the
> TypeScript/Electron/SQLite application with an evidence-only Python research
> toolchain. The decision is reviewed after Phase 3 against measured results.

## 1. Decisions and their reasons

Each is a decision, not a default. Reversing one needs an ADR.

| Decision | Reason |
|---|---|
| **Modular monolith, one process** | Single user, no scaling pressure, no team boundary, no independent deploy need. Microservices would add network hops and partial-failure modes for nothing. Modularity comes from enforced package boundaries |
| **TypeScript primary, Python sidecar, benchmark-gated native exception** | TS remains authoritative for the application and domain runtime. Python earns its place because pandas/numpy/scipy have no TS equivalent for the statistical work, and the predecessor already integrates it. A pure local Rust batch kernel is permitted only through the measured exception in §10.1; Rust services and Go remain rejected |
| **`core` is a package with lint-enforced purity** | In the predecessor this was a convention that held across ~63,000 lines because one person maintained it. Conventions decay. Encode it |
| **Electron for v1, transport-abstracted** | Correct for a local-first app needing OS keychain, embedded DB, and background scheduling. The renderer talks to `CoquiClient`, so a web or Tauri shell later is additive |
| **One injected `Clock` shared by backtest, paper, and any future live path** | Borrowed from NautilusTrader. Shared timing semantics mean backtest and paper cannot silently diverge, and live becomes a third implementation rather than a third codebase |
| **SQLite for state, Parquet for history, DuckDB for research. No daemons** | No PostgreSQL, TimescaleDB, or Redis. Each is a process to install, run, back up and secure, in exchange for multi-client and high-ingest capabilities this app never uses |

## 2. Repository layout

```
Coqui-Crypto/
├── CLAUDE.md                    # invariants — always loaded
├── package.json                 # workspace root, scripts only
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js             # boundary rules (§3)
├── .github/workflows/
│   ├── ci.yml                   # push: typecheck → lint → test → build
│   ├── audit.yml                # weekly: pnpm audit + Dependabot
│   └── release.yml              # tag: package mac + win
│
├── packages/
│   ├── core/                    # PURE. No I/O, no Electron, no React, no Node I/O.
│   │   └── src/
│   │       ├── types/           # the data model — treat doc comments as spec
│   │       ├── time/            # Clock interface + UTC interval math      [NEW]
│   │       ├── market/          # MarketBar, alignment, DecisionMarketDataset
│   │       ├── indicators/      # SMA, RSI, realized vol, regime
│   │       ├── strategies/      # momentum, vol-target, trendvol, tilt, rotation
│   │       ├── backtest/        # THE single engine — all tracks
│   │       ├── significance/    # PSR, DSR, expected-max-Sharpe
│   │       ├── validation/      # walk-forward, purged CV, stationary bootstrap
│   │       ├── trials/          # TrialRegistry — trial-count provenance   [NEW]
│   │       ├── costs/           # fee/spread/slippage/impact
│   │       ├── risk/            # risk controls, guardrails, profitability gate
│   │       ├── portfolio/       # cost basis, holdings, allocation, tax
│   │       ├── paper/           # order state machine
│   │       └── evidence/        # gate checklist, snapshots
│   │
│   ├── adapters/                # ALL I/O. Implements interfaces defined by core.
│   │   └── src/
│   │       ├── http/            # client + per-domain rate limiter
│   │       ├── coinbase/        # public REST, CDP JWT auth, accounts, fills, probe
│   │       ├── coingecko/       # fallback prices, market caps, canonical identity
│   │       ├── defillama/ feargreed/ onchain/
│   │       ├── bulk/            # CSV archive importer, deep history        [NEW]
│   │       └── secrets/         # SecretStore: keychain impl + memory impl
│   │
│   ├── storage/
│   │   └── src/
│   │       ├── sqlite/          # connection, per-wallet contexts, VACUUM INTO backup
│   │       ├── migrations/      # ported at current numbering — never renumber
│   │       ├── repositories/    # one per domain, max 400 lines each
│   │       └── archive/         # Parquet writer + DuckDB reader            [NEW]
│   │
│   ├── services/                # application layer — replaces the old main process
│   │   └── src/{market-data,portfolio,research,paper,risk,alerts,
│   │             accounts,advisor,scheduler,ingest}/
│   │
│   ├── contracts/               # the shell↔UI API surface
│   │   └── src/
│   │       ├── channels.ts      # channel names
│   │       ├── schemas/         # Zod, validated in BOTH directions
│   │       └── client.ts        # CoquiClient — transport-agnostic
│   │
│   ├── observability/           # structured logger (redacting), metrics    [NEW]
│   └── ui-kit/                  # tokens, primitives, chart wrappers
│
├── apps/desktop/
│   └── src/
│       ├── main/                # composition root + IPC registration ONLY, <500 lines
│       ├── preload/             # contextBridge, Zod-validated
│       └── renderer/
│           ├── query/           # TanStack Query hooks + IPC transport
│           ├── features/        # one folder per screen
│           └── components/      # presentational, <300 lines each
│
├── research/python/coqui_research/   # sweeps, DSP audits, HAR vol, overfit audits
├── docs/                        # ARCHITECTURE · MIGRATION · PLAN · adr/ · studies/ · audit/
├── fixtures/                    # golden-backtest-v2.json, market-bars/
└── scripts/                     # verify, backfill-history, snapshot-universe
```

### Folder responsibilities

| Path | Owns | Must not |
|---|---|---|
| `packages/core` | All pure computation. The knowledge of the system | Touch network, disk, clock, Electron, React, Node I/O |
| `packages/adapters` | External I/O, rate limiting, retries, auth, normalization | Contain business logic or make decisions |
| `packages/storage` | Persistence, schema, migrations, repositories, archive | Contain strategy or risk logic |
| `packages/services` | Orchestration: compose core + adapters + storage into use cases. Own transactions and scheduling | Know about IPC, Electron, or React |
| `packages/contracts` | Wire format: channels, schemas, client interface | Contain implementation |
| `packages/observability` | Logging and metrics, secret redaction by construction | — |
| `packages/ui-kit` | Design tokens, primitives, chart wrappers | Fetch data or know about services |
| `apps/desktop` | Electron shell: composition root, window/security config, preload, React app | Contain business logic |
| `research/python` | Statistical work with no TS equivalent | Be required for the app to run. Absent Python ⇒ research degrades, app works |
| `docs/studies/` | Pre-registered studies **including negative results** | — |
| `fixtures/` | Golden regression data pinning numerical behaviour | — |

## 3. Boundary rules

Implement as `no-restricted-imports` in `eslint.config.js`. All must fail CI.

| # | Rule |
|---|---|
| 1 | `core` may not import `electron`, `react`, `node:fs`, `node:net`, `node:http`, or any workspace package |
| 2 | `core` may not import `services`, `adapters`, `storage`, or `apps/*` |
| 3 | `services` may not import `electron` or `react` |
| 4 | `adapters` may not import `services` |
| 5 | `apps/desktop/renderer` may not import `services`, `storage`, or `adapters` |
| 6 | Only `packages/adapters/src/http` may call global `fetch` |
| 7 | No service may import more than two other services |
| 8 | `core/strategies` may not import from the research sandbox (keeps `adaptive-learning` quarantined) |
| 9 | No `setInterval` in `renderer/features` or `renderer/components` |

Rule 1 is the load-bearing one — it is what makes every future shell cheap.

## 4. Data flow: ingestion → decision dataset

```
scheduler tick (UTC-aligned)
  → market-data service
  → adapters/http (per-domain GCRA limiter, honours Retry-After)
  → Coinbase REST
  → HttpResult<T>  (never throws; degrades to null)
  → core/market: normalize to MarketBar
        · UTC startTime/endTime + interval
        · source provenance
        · isComplete (per-source completion delay)
        · quality tag (reported vs synthesised OHLC)
  → alignMarketBars(policy: intersection | reference-calendar | reject-on-gap)
  → DecisionMarketDataset + AlignmentReport + datasetHash
  → SQLite (operational)  +  Parquet (immutable archive)
```

Use `reject-on-gap` for research runs. `AlignmentReport` surfaces gaps,
duplicates, and incomplete bars per asset — do not discard it.

The P4 scheduler is deliberately host-driven: the desktop composition root will own one wake-up
mechanism and call a scheduler tick. The service itself selects a bounded deterministic due queue,
acquires durable owner-bound wallet leases, and runs at most two tasks concurrently. Cadence is an
immutable UTC-aligned policy, timestamps come from the injected `Clock`, expired running leases are
finalized idempotently, and shutdown leaves canceled work due for retry. Task contexts contain no
credentials, and scheduler metrics use outcome-level labels rather than wallet identifiers.
Its bounded automation-status read model is also side-effect free: it does not acquire or finalize
leases, omits owner identities, and converts legacy diagnostic strings into a stable unverified
reason code before they cross the service boundary.

Risk-service reports follow the same rule. The first `REALITY_CHECK` service accepts an explicit
source-evidence hash, validates all facts before reading its injected clock, and returns only stable
notice codes plus a content-bound assessment hash. It is advisory and always reports live execution
as unavailable; it cannot select a strategy, mutate evidence, or relax an execution permission.
The companion evidence tracker reads only append-only registered evidence and accepts numeric gate
facts from a strict versioned envelope after snapshot and current trial-registry hash verification.
Incomplete history, missing evidence, integrity failure, unsupported shape, and unmet gates remain
distinct stable states. A fully met checklist means eligible for human review, never permission to
trade.
Long-term risk assessment likewise requires a caller-supplied parameter set and completed,
strictly ordered Coinbase venue observations. Dataset, series, and parameter hashes remain visible,
while narrative rationale is reduced to stable codes. Reference prices, implicit defaults, future
bars, order intents, and execution permission are outside that service.

Alerts persist immutable evidence separately from presentation acknowledgement. Policy is typed and
replaced only after complete validation; Coinbase price targets retain exact decimal thresholds and
use removal tombstones. Alert facts contain stable codes and provenance hashes rather than native
notification prose. The service has no timer or Electron authority: the future host wake mechanism
and desktop notification adapter remain separate consumers.

Advisor connection state is likewise split by authority. The service may test presence and mutate a
profile-scoped Gemini entry through `SecretStore`, but it never receives a key back in a result or
persists one in SQLite. Storage contains only an allowlisted Coqui model-policy identifier and its
update time. Status is advisory-only and explicitly has no execution authority. Provider calls,
conversation content, TTS, social context, IPC, and renderer behavior remain outside this boundary.

Accounts profile metadata lives in one global, predecessor-compatible manifest rather than inside a
wallet's own database. The manifest store validates the whole registry and replaces it atomically;
the service publishes a new profile only after its isolated database is provisioned and migrated.
Profile views omit database filenames, provider fingerprints, and credentials. Display metadata and
ordering are independent from the later context-switch and destructive-delete workflows, so a
routine rename or reorder can never close a database, copy a key, or remove evidence.
Switching uses a prepared-context protocol. Preparation opens and migrates the target while the old
context remains authoritative; the accounts service publishes the durable selection only after that
succeeds, then requests one atomic context commit. A safe refusal rolls durable state back. An
ambiguous thrown commit is a recovery state, not permission to guess, retry blindly, or expose two
contexts. The service serializes its profile operations for the duration of this handoff.
Profile deletion starts with a separate read-only consequence preview. Storage returns bounded
counts rather than rows, and the secret adapter returns credential categories rather than values.
The preview fails closed on incomplete inspection and requires a recoverable backup for any durable
evidence. It has no deletion capability and shares the context-switch gate so it cannot describe a
mixed active state.
Recoverable profile backup is a separate serialized operation for an inactive, non-last profile.
Storage uses SQLite `VACUUM INTO` to capture one consistent database, records the source-manifest
revision, bounded evidence counts, schema version, and SHA-256 checksums in a versioned manifest,
then publishes the directory through an atomic sibling rename. Verification reparses the strict
manifest, rehashes the database, and runs SQLite integrity and schema checks. OS credential values
are never copied; the artifact records only stable credential-category presence and
`credentialsIncluded: false`. Backup creation grants no restore or deletion authority.
Deletion is a separately confirmed, journaled saga because the manifest, SQLite files, and OS
credential manager cannot share one transaction. The service accepts only an exact
`delete_profile_permanently` confirmation bound to the profile and backup UUID. It re-verifies the
backup and requires its manifest revision, evidence counts, and credential categories to match a
fresh inspection. Storage durably writes a deletion journal before the revision-checked manifest
removal; that manifest replacement is the deletion commit point. Database/WAL cleanup and removal
of only the target profile's Coinbase and Gemini credentials happen afterward. Any interruption is
returned as a successful deletion with explicit pending cleanup, and startup recovery re-verifies
the retained backup before idempotently resuming. A corrupt journal fails closed and never triggers
best-effort guessing or cross-profile cleanup.
Profile duplication is a separate serialized snapshot operation. Storage uses SQLite `VACUUM INTO`,
discovers every table with an explicit `profile_id` column, rejects a source snapshot containing any
foreign profile identity, and rewrites all scoped rows to the new UUID in one transaction. The clone
retains completed local facts and configuration, but removes scheduler lease authority, unfinished
Coinbase staging jobs, and legacy connection/sync markers. The service has no secret-store
dependency and never copies provider fingerprints. It publishes the inactive manifest record only
after schema, foreign-key, integrity, and SHA-256 verification; failed publication removes the clone
only after proving that no current manifest record references it.
Cross-profile comparison captures bounded facts from isolated databases with at most four concurrent
readers, closes those readers, and releases the profile-operation gate before one shared canonical
price request. Results preserve manifest order and exact decimal strings. Priced subtotals are
separate from nullable complete tracked and paper equity; missing prices can never turn a subtotal
into a complete claim. Each profile carries source/quality counts and canonical unpriced instruments.
A missing, corrupt, or oversized database is an explicit unavailable row rather than a fabricated
zero portfolio, and one failed profile does not erase valid peers. The reader returns no filenames,
credentials, provider fingerprints, raw rows, or raw errors.
The profile dashboard composes that valuation view with a second bounded, read-only capture of
sanitized operational facts. At most four isolated databases are open concurrently. The dashboard
uses an injected clock for freshness and schedule health, exposes only stable risk/safety codes and
grouped unresolved-incident counts, and treats malformed stored status as unavailable evidence.
Coinbase configuration is only a non-secret manifest hint; the dashboard never reads credential
values. It returns no lease owner, incident detail, safety reason, database filename, provider
fingerprint, or raw diagnostic. Aggregate tracked and paper subtotals remain exact, while a complete
aggregate is null whenever any included profile or instrument is incomplete.
Explicit all-profile refresh is a separate command boundary rather than a dashboard side effect.
The accounts service snapshots manifest order under the shared profile-operation gate, captures one
injected request time, and fans out through an injected authenticated-acquisition executor with at
most four profiles in flight. That executor receives the isolated profile/database identity and an
optional caller cancellation signal; the accounts layer never receives credential values, HTTP
objects, or provider diagnostics. New work stops after cancellation, in-flight work may report its
actual terminal outcome, and every profile retains its ordered refreshed, skipped, failed, or
cancelled result. Only allowlisted reason codes and bounded evidence counts cross the boundary.
The service itself writes no profile, portfolio, scheduler, or manifest state and does not invoke the
dashboard; P5 can invalidate and query the dashboard independently after command completion.
Coinbase connection is a separate profile-scoped service transaction. Credential bytes are
canonicalized as ECDSA P-256/ES256, then a GET-only authenticated adapter proves account readability
and requires `can_view=true` with `can_trade=false`, `can_transfer=false`, and
`can_receive=false`. The last flag is intentional: Coinbase now documents Receive as a separate API
key permission, so it is not accepted as view-only. A verified portfolio UUID and key name are stored
only as SHA-256 duplicate-detection identities in the global manifest; the key and private key remain
in the scoped OS secret store. The service rejects another profile using either identity.
Credential publication precedes a revision-checked manifest replacement and is rolled back on
conflict; disconnect uses the inverse operation and restores the prior secret on publication failure.
If rollback itself fails, status derives an explicit attention/recovery state from secret/manifest
identity mismatch rather than guessing. Results expose only stable codes and capability booleans and
grant no execution, transfer, or receive authority. See Coinbase's official
[App API authentication](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication),
[authorization](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/authorization),
and [key-permissions response](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/data-api/get-api-key-permissions)
documentation.

Coinbase venue OHLCV is the only price path used for backtests and simulated
fills. CoinGecko, CoinMarketCap, and CoinPaprika are reference-feature sources
(market cap, supply, rank, and cross-venue context); their aggregate prices are
never spliced into the Coinbase execution series. Build the operational dataset
with:

```text
pnpm dataset:coinbase -- --products=BTC-USD,ETH-USD --days=365 --min-days=300
```

For a citable study, first export immutable N7 Parquet archives, then prepare
the exact multi-asset decision dataset:

```text
verified Coinbase Parquets
  -> archive content/schema/provenance verification
  -> exact instrument and UTC-window filter
  -> reject mixed providers, non-reported OHLC, duplicates, and every gap
  -> DecisionMarketDataset hash
  -> immutable preparation manifest
```

Run `pnpm research:prepare-dataset -- --help` for the complete command. Its
manifest hash and decision-dataset hash are frozen into the pre-registration;
the preparation command itself never reads provider credentials.

`pnpm archive:coinbase` supplies the preceding acquisition boundary for public
Coinbase history: exact raw response text -> page/content manifest -> exact
decimal rows -> verified per-product N7 archives -> longest shared continuous
coverage -> prepared decision manifest. The raw provider artifact remains local;
its hashes and coverage enter the citable provenance chain.

Capture the full venue membership daily with `pnpm universe:snapshot`. A
snapshot becomes effective on the next UTC day. Research requires exact daily
coverage and fails on missing snapshots; the latest catalog is never backfilled
into older dates. The dataset and universe timeline receive a combined decision
context hash before any cross-sectional research.

### 4.1 Operational logging boundary

Application services emit stable structured events through
`packages/observability`; they do not write ad hoc diagnostic strings. A logger
child carries `component` and `correlationId` across one workflow. Event context
is recursively converted to bounded JSON-safe data before reaching its sink.
Credential keys and registered values, authorization material, URLs, headers,
bodies, query data, payloads, JWTs, PEM material, and error stacks cannot cross
that boundary. Sink, clock, accessor, and serialization failures are contained
so telemetry cannot alter application control flow.

Market-data workflows log lifecycle metadata only: canonical asset IDs, counts,
status/reason codes, interval bounds, and content hashes. They never pass raw
provider responses, market rows, HTTP request objects, or caught provider errors
to the logger. Metrics use an even narrower low-cardinality label vocabulary:
no instrument, correlation, account, URL, payload, or exception labels. They are
persisted locally through migration 34 with bounded retention; sink failure can
never change workflow control flow.

## 5. Data flow: research → evidence

```
DecisionMarketDataset (hashed, immutable)
  → immutable pre-registration          ← freezes grid, splits, costs, adoption
  → point-in-time universe filter        ← removes survivorship bias
  → backtestStrategies
        · signals see bars strictly before the execution bar
        · fills at next bar's open
        · costs charged to the equity curve, not reported beside it
        · all tracks race identical bars from identical initial state
  → nested chronological selection
        · inner development validation chooses parameters
        · embargoed outer folds measure the complete selection procedure
        · final holdout remains unopened until one candidate is fixed
  → CSCV/PBO over development candidates ← symmetric IS/OOS rank consistency
  → final-holdout paired confidence bands ← after-cost excess vs hold + passive
  → computeSignificance (PSR + DSR)  ←── TrialRegistry supplies the true trial count
  → Monte Carlo (stationary bootstrap p-values)
  → evidence snapshot (persisted, immutable)
  → gate checklist
  → LIVE remains absent
```

**TrialRegistry is the most important new component.** It is a persisted,
versioned record of every parameter combination ever searched for a strategy
family, linked to the defaults that search produced. Without it the deflated
Sharpe deflates over the handful of tracks in the current run rather than the
full historical search, and the significance bar sits far too low.

```ts
interface TrialRecord {
  family: string;                          // 'momentum' | 'voltarget' | 'trendvol'
  evidenceStatus: 'verified' | 'legacy-unresolved';
  parameterSpace: Record<string, unknown[]>;
  trialCount: number;
  searchedAt: string;
  datasetHash: string | null;
  costProfileHash: string | null;
  codeRevision: string;
  producedDefaults: Record<string, unknown>;
  studyRef: string;                        // link into docs/studies/
}
```

The registry also carries `complete` versus `known-lower-bound`. Unresolved
legacy searches still count toward the audit, but a lower-bound registry cannot
enter DSR or produce a citable evidence snapshot. `verified` records require
both immutable dataset and cost-profile hashes. Migration 35 enforces append-only
trial records and immutable evidence snapshots at the SQLite layer.

Migration 36 adds the earlier boundary in that flow: a canonical, append-only
pre-registration freezes the hypothesis, full candidate grid, dataset/cost/code
hashes, chronological development and untouched holdout windows, nested-fold
and embargo settings, and adoption gates. Evidence references the plan hash and
is rejected if its dataset, costs, or code differ. The plan can be recorded
while legacy trial completeness remains a lower bound; citable evidence still
cannot be produced until that separate audit is complete.

## 6. Data flow: paper execution

```
strategy targets
  → planAutoRebalance (drift → intents)
  → applyAutoTradeGuardrails    (size, position, at-risk, turnover, count caps)
  → applyProfitabilityGate      (expected edge ≥ 2× estimated cost + tax)
  → resolveRiskControlState     (normal / caution / defense / hard_stop
                                 → exposure ×1 / ×0.5 / ×0.25 / ×0)
  → canExecute(mode, killed)    → paper only, never live
  → paper order state machine   (submitted → acknowledged → filled)
  → durable orders + fills
  → append-only execution journal
  → forward-paper evidence counters (observed days, decisions, fills)
  → reconciliation harness
```

**Reconciliation harness** is the second new component: it continuously compares
what the paper engine actually filled against what the backtest assumed, and
reports the divergence. It is the only mechanism that can detect a dishonest
backtest without spending money.

Three properties the order layer must have from the start, because retrofitting
them after a live path exists is far harder:

- **One state machine for paper and any future live mode.** Two implementations
  drift, and the drift surfaces as money.
- **Double-entry position and cash ledger.** Every order-state mutation and
  ledger posting inside a single transaction.
- **Ambiguous submissions transition to `unknown`.** Recovery queries the venue
  before deciding to resubmit. Blind retry is how duplicate orders happen.

Every order path traverses all four gates. There is no bypass. If webhook
ingestion is ever built, alerts enter at the *top* of this chain.

## 7. Communication

| Boundary | Mechanism | Why |
|---|---|---|
| Renderer ↔ Main | Electron IPC via `contextBridge`, behind `CoquiClient` | Only sanctioned path; abstraction keeps other shells open |
| Service ↔ Service | Direct typed calls, in-process | Same process; serialisation would be pure overhead |
| Service ↔ Core | Direct calls | Core is pure |
| Service ↔ Adapter | Dependency injection of core-defined interfaces | Tests inject fakes |
| Service ↔ Python | Supervised child process with a schema-versioned contract | The predecessor proves file-based JSON research; Phase 3 hardens process supervision and transport |
| Scheduler ↔ Services | In-process events with injected `Clock` | Shared timing semantics |
| Long research jobs | `worker_threads` + durable job records in SQLite | Responsive UI without a job server |

No message broker. No Redis queue. No internal HTTP.

## 8. Storage

**SQLite** — operational source of truth: tax lots, disposals, allocation
targets, settings, alerts, paper orders/fills/positions, execution journal,
evidence snapshots, research jobs, wallet manifest, risk state, incidents.

Port migrations at their current numbering. An existing predecessor database must
open in Coqui without conversion. Keep `VACUUM INTO` backup before every forward
migration.

ADR-0003 selects Node's built-in `node:sqlite` under a Node 24-based Electron
runtime. It removes a native dependency and the Electron/Node ABI rebuild
surface while preserving ordinary SQLite files. Packaged Windows and macOS
smoke tests remain a Phase 5 distribution gate.

**Parquet** — immutable bar archive, partitioned
`venue/product/product-type/interval/year`, content-hashed. Exact provider
decimals remain UTF-8 strings so serialization cannot round them through binary
floating point. Written once, never mutated. The semantic dataset hash binds
ordered rows, schema, source manifests, code revision, and dependency versions;
the manifest separately pins each Parquet file's bytes.

**DuckDB** — pinned official Node API used to write Parquet and as a read-only
analytical engine over verified files. It is research-only and never in the
operational path. Every query verifies the manifest, file hashes, schema, row
count, and semantic dataset hash before returning rows.

## 9. Frontend

```
components (presentational)
  → query hooks (TanStack Query — cache, dedupe, coordinated refetch)
  → CoquiClient (transport interface)
  → IPC transport  [HTTP transport later, same interface]
  → preload contextBridge (Zod-validated)
  → services
```

Rules beyond those in `CLAUDE.md` §4:

- Refetch intervals are declared per-query and centrally managed.
- Loading and error states live in the query layer, not in components.
- **Every displayed figure carries its provenance** — dataset hash, registered
  trial count, deflated significance, cost-inclusive flag, sample days. This is a
  functional requirement, not decoration.
- `docs/UI-UX.md` is the Phase 5 design and performance contract. Motion is
  purposeful and tokenized, uses compositor-friendly properties, and has a
  complete reduced/no-motion path.
- Financial values never animate through false intermediate numbers. A refresh
  preserves layout and focus; charts receive incremental updates.
- Phase 5 measures interaction latency, frame behavior, startup, CPU, and heap in
  a production build. Visual polish cannot waive the performance budgets.

Stack: React 19 · TypeScript 6 · Vite 8 · Tailwind 4 · TanStack Query ·
lightweight-charts · Zod.

## 10. Security boundaries

```
Zone 1  Renderer (untrusted)
          contextIsolation: true · nodeIntegration: false · sandbox: true
          CSP: default-src 'self'; script-src 'self'; connect-src 'none';
               object-src 'none'; form-action 'none'
          will-navigate blocked · window.open denied · all permissions denied
   ↓ typed IPC only
Zone 2  Preload — explicit allowlisted methods, Zod-validated both directions
   ↓
Zone 3  Main — services, DB, HTTP. Secrets never cross back to Zone 1
   ↓ keytar
Zone 4  OS Keychain — Coinbase key (VIEW-ONLY, enforced), Gemini key
Zone 5  Network — rate-limited HTTPS from Zone 3 only
```

**The predecessor already implements all of Zone 1 correctly. Port it verbatim
rather than reinventing it, then add the presence tests it never had** — each
test failing if its control is removed.

`connect-src 'none'` means the renderer cannot make a network request at all.
Preserve that.

### 10.1 Benchmark-gated native-kernel exception

TypeScript remains authoritative. Direct reuse from the owner's local Nautilus
rebuild is permitted only for a pure batch kernel after profiling proves a Coqui
bottleneck. The first candidate is repeated registered backtest/replay work;
reconciliation campaign replay may be evaluated in P6. Portfolio reads, allocation
validation, lifecycle, messaging, and scheduling remain TypeScript. No online
Nautilus source may be consulted or copied.

The benchmark compares the complete boundary, including input serialization, native
invocation, and output decoding, against the same TypeScript workload. Adoption
requires exact golden-fixture, decimal, event-order, and failure-outcome parity;
determinism across repeated runs; at least 3x kernel and 2x end-to-end speed; and
either one second saved on a representative registered research batch or removal of
a documented product latency-budget violation.

A passing implementation is isolated behind a narrow N-API batch interface with no
disk, network, clock, secrets, UI, or execution authority. Packaged Windows x64 and
macOS arm64 builds must load it and pass parity checks. If the gate fails, reuse the
algorithm and tests as a TypeScript port and add no native dependency. Benchmark
evidence and machine/runtime details are committed with any future exception.

**Measured decision, 2026-08-10:** optimized TypeScript remains authoritative. The quarantined
Windows spike achieved exact repeated-output parity, but Rust/N-API was only 1.43x faster and saved
47 ms, while the persistent Python/NumPy worker was 3.37x slower. Rust is technically viable only
for a later profiled pure batch that saves seconds or removes a documented latency violation;
Python remains appropriate for exploratory, genuinely vectorizable research rather than an
operational runtime. Neither prototype may enter production from this result. See
`docs/studies/language-runtime-spike-2026-08-10.md`.

## 11. Deployment

`electron-builder` → macOS DMG (arm64 + x64), Windows NSIS. CI builds on tag.

No server, no containers, no cloud database, no hosted API. Docker is optional
and only for reproducing the Python research environment.

Code signing (Apple Developer, Windows certificate) is the only recommended paid
item anywhere in this plan, and it is deferred. Until then keep the ad-hoc
signing workaround and ship an honest install guide.

## 12. Deliberate omissions

Stated so they read as decisions rather than oversights: microservices · message
broker · Redis · PostgreSQL/TimescaleDB · Rust or Go services outside the
benchmark-gated pure-kernel exception · user accounts ·
multi-exchange execution · live order submission · GraphQL or REST API ·
container orchestration · WebSocket market data in v1.

Each would feel like progress and would tax every subsequent change.
