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
| **TypeScript primary, Python sidecar, no third language** | TS already holds the working engine. Python earns its place because pandas/numpy/scipy have no TS equivalent for the statistical work, and the predecessor already integrates it. **Rust and Go are rejected**: their advantage is latency and throughput, and this system trades daily bars |
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
  → adapters/http (per-domain token bucket, honours Retry-After)
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

## 11. Deployment

`electron-builder` → macOS DMG (arm64 + x64), Windows NSIS. CI builds on tag.

No server, no containers, no cloud database, no hosted API. Docker is optional
and only for reproducing the Python research environment.

Code signing (Apple Developer, Windows certificate) is the only recommended paid
item anywhere in this plan, and it is deferred. Until then keep the ad-hoc
signing workaround and ship an honest install guide.

## 12. Deliberate omissions

Stated so they read as decisions rather than oversights: microservices · message
broker · Redis · PostgreSQL/TimescaleDB · Rust or Go services · user accounts ·
multi-exchange execution · live order submission · GraphQL or REST API ·
container orchestration · WebSocket market data in v1.

Each would feel like progress and would tax every subsequent change.
