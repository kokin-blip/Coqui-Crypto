# PLAN

Phase order, work items, exit criteria.

Work items reference `MIGRATION.md` IDs (`§1`, `R1`, `N2`, …) rather than
restating them — go there for what-moves-where. Architecture questions go to
`ARCHITECTURE.md`. Neither is repeated here.

**The repo is functional and shippable at the end of every phase.**

Effort figures assume one part-time developer with assistance.

---

## 1. Where we are

> **Update this section as phases complete. It is the first thing to read.**

```
Current phase:  P5 — Shell and new UI; transport spine done, ui-kit next
Last completed: P5a — Electron shell boots and round-trips a channel (2026-08-21)
Verified:       115 test files / 742 tests, pnpm verify green; smoke gate 13/13
Next gate:      owner approval of scoreboard/portfolio/paper-review wireframes
P3 blocker:     CLEARED 2026-08-21 — registry is 215, conservative-upper-bound
```

**The application runs.** `pnpm smoke` boots a real Electron main process,
opens a migrated profile database through `node:sqlite`, and round-trips
`research.runs` from the renderer through the sandboxed preload. Before this the
repository was ~25,000 lines of backend that had never executed outside
`vitest`. ADR-0003's runtime assumption is confirmed
(`docs/studies/electron-node-sqlite-2026-08-20.md`); Electron 43.x is the floor.

Ten of the 23 outstanding `Adapt` rows are closed — the market-data display
facade and research read models — putting 63 of 76 rows under tested service
boundaries. The other thirteen are re-phased to the phase that owns their
screen; see `docs/p4-completion-audit.md` §"Re-phasing decision (2026-08-20)".

Still greenfield in P5: `packages/ui-kit` is a placeholder, there is no React,
Vite, Tailwind or query layer yet, and the renderer is a bare HTML shell that
holds the CSP. No screens exist.

P3's trial-count blocker is cleared. Recovering the predecessor's Obsidian vault
moved the registry from 178 `known-lower-bound` to **215
`conservative-upper-bound`**, so deflated Sharpe is computable for the first
time — see `docs/studies/predecessor-vault-recovery-2026-08-21.md`. The recovery
also found that the 2026-08-04 audit read only one branch and had missed three
pre-registered studies committed to `kokinstocks`.

This does not validate the defaults. The 2026-08-10 replacement run was negative
on its own frozen criteria and nothing here revives it, so strategy parameters
still render as legacy/unvalidated wherever they appear. The scoreboard must also
state the bound's direction — "deflated against an upper bound of 215 trials" —
never a bare number.

P3 executed its registered replacement study and recorded a negative result; it
remains blocked on the missing predecessor private-vault trial count, so
**strategy defaults stay labelled legacy/unvalidated everywhere they are
displayed** and no run is presented as proof of edge.

The P4 remainder is 23 `Adapt` handler rows. Ten are closed during P5 because the
first screens need them; thirteen are **re-phased to the phase that owns their
screen** — see `docs/p4-completion-audit.md` §"Re-phasing decision (2026-08-20)"
for the row-by-row destinations and the reason. Nothing is dropped.

P5 is greenfield: `apps/desktop/src/index.ts` and `packages/ui-kit/src/index.ts`
are still placeholders, and `packages/contracts` carries envelope factories but
no `CoquiClient`, channel registry, or request/response schemas.

---

## 2. Phases

### P0 — Foundation · 2–3 days

Build a repo that makes the predecessor's mistakes structurally impossible.

- Workspace, `tsconfig.base.json` strict, project references — `ARCHITECTURE.md` §2
- **The nine boundary rules** — `ARCHITECTURE.md` §3
- `ci.yml`: typecheck → lint → test → build **on every push**. The predecessor's
  only workflow was manual packaging; tests never ran automatically
- `audit.yml`: weekly `pnpm audit` + Dependabot. Watch `keytar` specifically
- **Pin every GitHub Action by commit SHA, not a movable tag** — S6
- `CLAUDE.md`, this audit into `docs/audit/`, ADR template
- First three ADRs: modular monolith · TS+Python · Electron-for-now
- Plus the three decisions in `MIGRATION.md` §4

**Resolved 2026-08-01:** `docs/adr/0001-stack.md` is Accepted. Phase 1 may begin
after the Phase 0 exit criteria pass.

**Write the boundary-violation test first.** A commit importing `electron` into
`core` must fail CI.

**Exit:** `pnpm verify` green; a deliberate boundary violation breaks the build.

---

### P1 — Pure core migration · 1–2 weeks

The engine moves and proves it did not change.

- `core/types` → `core/time` (N1) → `core/trials` (N2), in that order
- Copy the engine, statistics, risk and portfolio modules — `MIGRATION.md` §1
- Copy strategies with parameters unchanged — §2
- Refactor the backtest engine — R1, **each of its four changes a separate commit**
- Fold rotation in and delete `backtestRotation` — R2
- Move all corresponding tests

**Completed 2026-08-01:** canonical types, Clock, TrialRegistry, costs,
significance, validation, aligned market bars, risk controls, momentum,
vol-target, signal-tilt, and the fail-closed execution gate are ported. The
backtest is split below the 500-line ceiling, uses an injected Clock and
TrialRegistry, and includes rotation as the seventh track through shared
next-interval execution. The retired `backtestRotation` was not migrated. The
golden fixture and full verification gate pass.
Realism, allocation, holdings derivation, estimate-only rebalancing, and
auto-trade guardrails are now also ported with decimal notional math. Evidence
and reality checks, stable action reason codes, portfolio-size policy, canonical
buy-candidate scoring, shared indicators, and the decimal paper-order OMS are
also ported. The paper OMS keeps ambiguous submissions in `unknown` and omits
the predecessor's duplicate float-valued order API. Deterministic LRU/TTL cache
and FIFO semaphore utilities are ported without adding runtime dependencies.
The remaining portfolio engines now use canonical instruments and decimal lot,
balance, contribution, tax, and performance values. CSV parsing requires an
explicit canonical resolver and creates no lots. The long-term assessment feeds
the shared next-interval backtest instead of migrating its unsafe duplicate
simulator. The private `commissionPct` backtest override is removed, and the
golden fixture passes by exact object equality rather than tolerance.

**Exit:**
- All ported tests green
- **`fixtures/golden-backtest-v2.json` reproduces byte-identically** ← proof gate
- `canExecute('live', anything) === false` is tested
- Boundary lint catches a forbidden import
- `packages/core` imports no other workspace package and no I/O-capable runtime;
  its only third-party runtime dependency is the pinned decimal arithmetic library

**Watch:** the Sharpe/Sortino fix in R1(a) will change numbers. Regenerate the
fixture in its own commit with the delta in the message, so the metric fix and
the port are never confused.

Resolved: the predecessor's standalone long-term backtest was not copied. Its
assessment is adapted to the shared engine, which owns next-interval execution
and the venue cost profile, satisfying invariants 6 and 14.

---

### P2 — Market-data layer · 1–2 weeks

Real data, correctly timestamped, without survivorship bias.

- `adapters/http` at the **most conservative** published Coinbase limits — §1
- `adapters/coinbase` incl. permission probe, `adapters/coingecko`,
  `adapters/secrets` — §1, plus the JWT `alg`-probe fix R8
- Migrations unrenumbered; split repositories — §1, R5
- `services/market-data`: fetch → normalize → align → `DecisionMarketDataset`
- **Point-in-time universe** — N3
- Structured logger — N5 (completed 2026-08-04)
- Operational metrics foundation — N6 (completed 2026-08-04; scheduler wiring in P4)
- Bulk-archive acquisition/import groundwork — N8, after N6; source policy in
  `docs/DATA-SOURCES.md`

**Completed 2026-08-01:** the HTTP boundary applies verified conservative
per-host limits to every network attempt, honors `Retry-After` up to a bounded
60-second ceiling, retries transient failures only for idempotent reads, and
returns secret-safe typed failures for HTTP, network, timeout, parse,
serialization, and invalid-URL outcomes. The next slice is the Coinbase public
REST adapter, followed by authentication and the permission probe. The public
adapter is now ported with canonical product identities, decimal spot values,
validated 300-candle pagination, explicit completed-bar provenance, and a
canonical Coinbase asset catalog. ECDSA request-bound authentication and the
fail-closed View-only permission probe are now also ported. The authenticated
surface exposes GET only and rejects Trade or Transfer capability before account
reads. OS-backed secret storage is now ported through pinned
`@napi-rs/keyring` 1.3.0 with the predecessor's service/account identity,
explicit wallet scope, lazy native loading, stable secret-safe failures, and no
insecure fallback. The CoinGecko public fallback is now ported with batched
explicit-ID requests, canonical instrument joins, decimal spot values,
market-cap enrichment, and a conservative 30-request/minute host ceiling. It is
reference data only and never execution truth. CoinGecko Demo, CoinMarketCap
Basic, and CoinPaprika Free now share a secret-safe comparison path with
explicit provider-ID mappings, decimal normalization, per-host pacing, coverage,
latency, and pairwise deviation metrics; see
`docs/studies/provider-comparison-2026-08-02.md`.

**Completed 2026-08-03:** all 28 predecessor migrations are ported without
renumbering and run transactionally through built-in `node:sqlite`. Upgrade
tests cover every preceding schema version, exact decimal text and 64-bit
integers, restorable `VACUUM INTO` backups, rollback on failure, and fail-closed
future-schema detection. ADR-0003 records the binding decision and the remaining
Phase 5 packaged-runtime gate. The predecessor's 2,500-line storage facade is
now split into domain repositories, each below 400 lines. New writes use exact
decimal portfolio and wallet-risk tables, canonical venue/product identities,
explicit provider mappings, immutable registered research snapshots, append-only
wallet audits, and the fill-driven paper V3 ledger. Legacy REAL and symbol-era
rows are preserved and recorded as unresolved migration exceptions rather than
silently converted. The predecessor's lot-reconciliation/import promotion code
was deliberately not ported because it can invent or resize tax lots.

**Completed 2026-08-03:** `syncCoinbaseDecisionDataset` now performs the complete
daily ingestion path: canonical Coinbase instruments → validated paginated bars
→ atomic SQLite cache → completed-bar filtering → UTC calendar alignment →
freshness and minimum-history gates → deeply immutable
`DecisionMarketDataset` with deterministic SHA-256 provenance. Research defaults
to `reject-on-gap`; explicit intersection mode retains its full alignment report.
Wrong instrument identities, discontinuities, malformed OHLCV, provider failures,
stale latest bars, and partial multi-asset fetches all fail closed. The executable
`pnpm dataset:coinbase` command exercises the same service path.

**Completed 2026-08-03:** the point-in-time universe (N3) now captures each full
public Coinbase USD product response as an immutable, content-addressed snapshot.
It records canonical product identity, venue status, trading restrictions, and
available increments. An observation becomes effective only on the following
UTC day; strict research coverage requires a successful prior-day snapshot for
every decision day and never carries today's survivors backward or across a
missed observation. Dataset binding fails closed on uncovered days and hashes
the dataset plus its daily eligibility timeline. `pnpm universe:snapshot`
captures the live observation. Historical days before collection began remain
explicitly uncovered until trustworthy archived snapshots are imported.

**Completed 2026-08-04:** the dependency-free structured logger (N5) emits
stable JSON events through an injectable, failure-isolated sink. Recursive,
bounded sanitization redacts credential-bearing keys, registered secret values,
authorization material, URLs, headers, bodies, payloads, query data, JWTs, PEM
material, and nested error causes; stacks are omitted. Dataset and universe
workflows emit correlated lifecycle events containing only identifiers, counts,
status/reason codes, time bounds, and content hashes. Adversarial tests inject
canary secrets through values, keys, cycles, errors, and accessors and assert
against the fully serialized output. See
`docs/studies/structured-logging-2026-08-04.md`.

**Completed 2026-08-04:** N6 adds bounded low-cardinality counters, gauges, and
duration histograms with failure-isolated sinks. Migration 34 persists local
observations with a configurable 90-day default retention window. Coinbase
dataset and universe workflows now measure provider outcomes/retries, job
outcomes/durations, freshness, aligned coverage, validation issues, product
counts, and uncovered universe days without metric labels containing instrument
or correlation IDs. Scheduler health wiring remains in P4 because the scheduler
does not exist yet. See `docs/studies/operational-metrics-2026-08-04.md`.

**Completed 2026-08-04:** the first N8 slice downloads explicit Binance spot
monthly `1d` archives, verifies the published SHA-256, rejects unexpected ZIP or
CSV structure, normalizes both documented timestamp units, preserves exact
decimal text, writes immutable raw/checksum/manifest artifacts, and caches rows
under a venue-isolated Binance identity. A live BTCUSDT December 2024 smoke
import succeeded with 31 records. No Binance execution or credential surface was
added. See `docs/studies/binance-bulk-importer-2026-08-04.md`.

**Completed 2026-08-04:** the second N8 slice streams an explicitly downloaded
Kraken OHLCVT ZIP, extracts only the requested pair's `1440`-minute CSV, accepts
provider-documented no-trade gaps without inventing candles, preserves exact
decimal text, hashes and content-addresses the raw archive, and caches rows under
a venue-isolated Kraken identity. Kraken publishes no companion checksum, so the
manifest records that limitation instead of claiming upstream verification.
Google Drive quota prevented an official-archive live smoke on this date; strict
ZIP fixtures and SQLite round trips are covered. See
`docs/studies/kraken-bulk-importer-2026-08-04.md`.

N8 acquisition groundwork is complete. Binance and Kraken remain robustness
venues, not reconstructed Coinbase history; see `docs/DATA-SOURCES.md`.

**Completed 2026-08-04:** N7 writes immutable, year-partitioned Parquet datasets
through the pinned official DuckDB Node API. The semantic dataset hash binds the
ordered exact-decimal rows, schema, raw-source manifest hashes, code revision,
and runtime dependency versions. Every query first verifies the JSON manifest,
all Parquet SHA-256 values and sizes, the exact schema/row count, and the
re-derived semantic hash. `pnpm archive:parquet` exports one cached instrument
and refuses to create a citable dataset without an explicit raw-source manifest
and code-revision label. See
`docs/studies/parquet-duckdb-archive-2026-08-04.md`.

Phase 2 data plumbing now meets its planned archive scope. The next phase is P3:
research-engine evidence and honest default re-derivation, beginning with the
TrialRegistry boundary and a current predecessor-source audit before porting.

**Exit:** one command yields a hashed, aligned, provenanced dataset from live
Coinbase. Migration tests run from each preceding schema with row-preservation
assertions. An existing predecessor database opens unmodified.

---

### P3 — Research engine and honest defaults · 2 weeks

**The most important phase. Everything before it is plumbing; everything after is
presentation.**

- `services/research` owning TrialRegistry and evidence snapshots — R7
- Port `research-deep.mts` into `docs/studies/` as the provenance record of the
  ~180 searched configurations — `MIGRATION.md` §7
- **Seed TrialRegistry from that record**, including human-guided iterations and
  feature screens — not only the displayed finalists
- **Unify the cost model first.** The sweep script passed 10bps against an 85bps
  application default (S1), so the historical results may not share one friction
  model. Re-run everything under a single venue profile before drawing any
  conclusion
- **Re-run `momentum`, `voltarget`, `trendvol` with registered trial counts
  against the never-tuned 2016–2021 holdout, on a point-in-time universe**
- **If the tuned defaults no longer clear the deflated bar, ship round unswept
  parameters and publish the finding** — e.g. `lookbackDays` 90 or 180,
  `targetVolPct` 50, `trendGateDays` 200
- Demote `signal-tilt` from the default path and reduce its knob count — R6
- **Nested chronological validation plus CSCV/PBO** — S3. The current walk-forward
  selects among already-defined tracks; it does not nest parameter selection or
  purge overlapping label horizons, so it answers "did leader-chasing help", not
  "was the final default chosen out of sample"
- More folds; replace the verdict word with a confidence band, or state
  "insufficient folds". Three out-of-sample observations cannot distinguish signal
  from noise, and a 0.5pp margin over a multi-month fold is below the noise floor
- **Add benchmark-relative significance** — S4. PSR/DSR test Sharpe against zero
  and search luck; the product claim is excess after costs versus hold and
  passive. Different questions, both needed
- Python sidecar — §1; Parquet + DuckDB — N7; complete the bulk archive
  importer/backfill started after N6 — N8

**Completed 2026-08-04 — P3 provenance boundary:** the predecessor branch and
file history were audited at `pivot/kokintrader`. Thirteen append-only records
capture 178 unique, code-visible candidate evaluations across momentum (23),
vol-target (21), trend+vol (107), and rotation (27). This is deliberately marked
`known-lower-bound`: the script refers to an earlier rotation round and private
vault iterations that Git cannot enumerate. Lower-bound registries now withhold
DSR entirely. Migration 35 persists append-only trial records and immutable
evidence snapshots; verified evidence requires dataset, cost-profile, registry,
and code-revision hashes. The historical 10bps studies remain unresolved and
cannot support defaults. See
`docs/studies/predecessor-search-audit-2026-08-04.md`.

Next: reconcile any surviving private vault search history. If it cannot be
recovered, conservatively pre-register a replacement search budget and run the
cost-correct nested study on a verified N7 dataset; do not mark the legacy audit
complete merely to obtain a DSR number.

**Completed 2026-08-09 — immutable pre-registration boundary:** migration 36
adds append-only research plans with canonical hashes. The service requires an
exact grid count, immutable dataset/cost/code identities, UTC-day-aligned
chronological development and holdout windows, nested-fold/embargo declarations,
and non-optional hold, passive, significance, and drawdown adoption gates.
Evidence must reference that plan, cannot predate it, and must match its
dataset, cost profile, and code revision. The first 16-candidate trend-vol
replacement specification and registration command are recorded in
`docs/studies/cost-correct-preregistration-2026-08-09.md`. It was initially left
unregistered until a real verified N7 dataset hash existed. That prerequisite
and the later one-time execution are now complete below.

Next: implement the plan-driven nested chronological runner. It must consume the
registered split and grid rather than accepting ad hoc parameters, and it must
not open the final holdout during selection.

**Completed 2026-08-09 — plan-driven nested runner:** the pure research runner
expands exactly the frozen grid, performs inner chronological candidate scoring
inside embargoed outer development folds, selects the final candidate entirely
from development validation, then evaluates only that candidate on the final
holdout. The service requires exact plan/dataset/cost/code identities and appends
every attempted candidate to TrialRegistry even for negative outcomes. Repeat
execution is rejected before reopening the holdout. Future-perturbation tests
prove holdout values cannot affect development scores or selection. Legacy
lower-bound history still makes DSR unavailable and therefore blocks adoption.

Next: add CSCV/PBO and benchmark-relative uncertainty, then prepare the verified
multi-asset archive as the exact decision dataset used to register the real
16-candidate study.

**Completed 2026-08-09 — CSCV/PBO:** the registered runner now applies every
symmetric half-partition combination to synchronous, after-cost development
returns. It reports empirical PBO, OOS loss probability, degradation slope, and
the full rank/logit distribution. Partition count and maximum acceptable PBO are
frozen before execution; unavailable or excessive PBO blocks adoption. The
implementation never receives final-holdout returns, and holdout perturbation
cannot change its output. See `docs/studies/cscv-pbo-2026-08-09.md`.

Next: add benchmark-relative uncertainty/confidence bands, then prepare the
verified multi-asset archive as the exact decision dataset used to register the
real 16-candidate study.

**Completed 2026-08-09 — benchmark-relative uncertainty:** final-holdout
evidence now carries paired stationary-bootstrap confidence bands and
null-centered one-sided p-values for after-cost daily excess versus hold and
passive. Resamples, block length, confidence, and seed are pre-registered.
Adoption requires both analyses and strictly positive lower bounds; short or
invalid samples state insufficiency and fail closed. See
`docs/studies/benchmark-relative-uncertainty-2026-08-09.md`.

Subsequently completed below: prepare the verified multi-asset archive as the
exact decision dataset, register the real 16-candidate study, and execute it
once.

**Completed 2026-08-09 — verified decision-dataset preparation:**
`pnpm research:prepare-dataset` now verifies every immutable N7 source archive,
accepts complete reported Coinbase spot OHLC only, rejects duplicate intervals
and any missing requested day, and writes an immutable content-addressed
preparation manifest. The manifest binds the decision-dataset hash, source
archive dataset/manifest hashes, instruments, exact UTC boundaries, code
revision, generation time, and aligned day count. CoinGecko and other
aggregators remain reference-feature sources and cannot enter this execution
price path. See
`docs/studies/multi-asset-decision-preparation-2026-08-09.md`.

The next recorded step was choosing the Coinbase asset mix and coverage,
preparing that exact dataset, then registering and executing the real
16-candidate study once.

**Completed 2026-08-09 — Coinbase study archive acquired:** exact raw public
Coinbase candle responses for `BTC-USD`, `ETH-USD`, and `LTC-USD` were preserved
and bound to three verified N7 Parquet archives. The deterministic longest
shared gap-free span is 3,640 days from 2016-08-21 through 2026-08-08 inclusive.
Its prepared decision-dataset hash is
`d56276d736716bc8796be1c6a1c13a458933f5f5b52de262a0943b83890543f5`.
See `docs/studies/coinbase-study-acquisition-2026-08-09.md`.

The next recorded step froze the chronological development/holdout split and
created a stable code revision before registration. The acquisition's explicit
working-tree parser label was not used as the final application revision.

**Frozen 2026-08-09 — replacement-study split:** development is 2016-08-21
through 2021-12-31 (1,959 daily bars); the untouched holdout is 2022-01-01
through 2026-08-08 (1,681 daily bars). The three Coinbase base targets are
equal-weighted. The plan generator fixes the exact 16 candidates and all
previously declared adoption thresholds. An immutable study-run record now
persists atomically with the registered trial budget even when incomplete
legacy history prevents a citable evidence snapshot.

**Executed once 2026-08-10 — negative replacement result:** plan
`7aeec117f27df08d51820778f44ae4dd9cf5ff322e903961fb53f9d245c58d3a`
ran under commit `037927e6b876a86b53f6a9977d35fd0df1a37873`; immutable run hash
`1c19605cb28c1c418ae57393a9e520e6b47f74f4e0c8585259facf626ea62120`
records all 16 candidates. The selected 180-day/lookback, 50% target-vol,
100-day trend-gate, 30-day cadence candidate earned positive cumulative excess
on the final holdout, but its paired confidence lower bounds were negative,
PBO was 28.60% against the frozen 5% ceiling, drawdown was 35.84% against the
35% limit, and DSR remained unavailable because historical trial completeness
is only a lower bound. It is not adopted. Existing tuned defaults therefore do
not survive as evidence-backed defaults; they remain legacy/unvalidated and are
not replaced by another result-selected candidate. See
`docs/studies/trendvol-replacement-v1-2026-08-09.md`.

Next: recover or conservatively resolve the missing predecessor private-vault
trial count. Until then P3 cannot produce citable DSR evidence. P4 engineering
may proceed only with the UI and documentation clearly labeling strategy
parameters as unvalidated and without presenting this run as proof of edge.

**Exit:** the scoreboard reports deflated significance over the *true* historical
trial count. A study is committed recording the outcome either way. Determinism:
the same manifest run twice produces identical results.

> A negative result here is a success. It is the single most valuable thing this
> project can tell its owner. The predecessor already published three negative
> results; this would be the fourth and the most important.

**Completed 2026-08-10 - P1-P3 Nautilus strengthening and runtime proof:** the
owner-authorized local rebuild was re-audited by SHA-256 without consulting online Nautilus code or
changing the source tree. P2 now uses injected-monotonic-clock GCRA admission with explicit
acquired/aborted/destroyed outcomes, while HTTP retries honor caller cancellation, shutdown, and a
total elapsed budget without changing the GET-only rule. P1/P3 momentum and volatility evaluation
use indexed windows and pass differential property tests against the prior prefix implementations;
the golden backtest is unchanged. `fast-check` 4.9.0 is pinned. A quarantined TypeScript,
Rust/N-API, and persistent Python/NumPy comparison achieved exact 20-run spike parity, but Rust was
only 1.43x faster and Python was slower, so neither passed the 3x/2x/one-second gate and neither was
promoted. See `docs/studies/language-runtime-spike-2026-08-10.md`. P3 remains blocked, the current
strategy defaults remain unvalidated, and this work did not read a registered holdout.

---

### P4 — Services layer · 2–3 weeks

The old main process is decomposed and cannot re-form.

- Catalogue every `ipcMain.handle` into `docs/handler-inventory.md` — §5
- Implement the ten services — `ARCHITECTURE.md` §2
- `packages/contracts` with Zod schemas both directions, and `CoquiClient` — §5, N10
- Scheduler: UTC cadence, per-wallet leases, concurrency 2, injected `Clock`.
  **The scheduler must never read the keychain** — test that
- Extend the completed N6 metrics foundation with scheduler health measurements

**Completed 2026-08-09 — Nautilus-informed contract foundation:** the user's
personal rebuilt NautilusTrader fork was audited read-only in
`docs/nautilus-adoption-matrix.md`. P4 now has strict Zod command/event envelopes,
correlation and causation identity, injected-clock message factories, and a reduced
service component lifecycle state machine with exhaustive transition tests. The full
message bus, scheduler, IPC, `CoquiClient`, live execution, and synthetic
reconciliation behavior were not introduced. The next P4 task remains the predecessor
IPC handler inventory before domain-service implementation.

**Completed 2026-08-09 — predecessor IPC decomposition gate:**
`docs/handler-inventory.md` records all 140 unique `ipcMain.handle` registrations from
the user-owned predecessor at an exact commit and source hash, maps every handler to
one of the ten P4 services, and fixes phase/safety dispositions before implementation.
The inventory rejects synthetic lot promotion, direct paper-position replacement,
paper-evidence deletion, unregistered adaptive workers, and runtime strategy patches.
A repository test enforces row uniqueness, source ordering, valid ownership, and
per-service count reconciliation without making the ignored predecessor checkout a CI
dependency. P3 remains blocked, strategy defaults remain unvalidated, and neither IPC
nor domain-service behavior was introduced by this audit.

**Completed 2026-08-09 — first portfolio service slice:** the new portfolio
lot-ledger service owns manual lot creation, canonical asset-scoped listing,
unpriced holdings derivation, and safe manual-lot removal. It preserves exact decimal
strings, uses injected time and deterministic UUIDv4 sources, returns deeply immutable
views, and fails validation without consuming an ID or mutating storage. Removal is
limited to wholly unconsumed manual acquisitions; imported or partially consumed lots
remain untouched with stable reason codes. The first repository-level service graph
test now fails on dependency cycles and enforces the two-service import ceiling. This
slice adds no pricing, IPC, exports, strategy defaults, synthetic lots, or paper
behavior. The next portfolio slice is disposal/tax orchestration before priced and
allocation read models.

**Completed 2026-08-09 — portfolio disposal and tax slice:** sales now validate
canonical instruments, exact decimal quantity/proceeds, cost-basis method, and
injected-clock timestamps before touching storage. Only lots acquired by the sale
time are eligible. Any quantity shortfall or deterministic disposal-ID conflict leaves
all lots and disposal evidence unchanged; persistence rolls every earlier update back
if a later reference fails. Successful sales retain fully consumed acquisitions at
zero, append short/long disposal evidence atomically, and return deeply immutable tax
summaries and UTC years. Tax-method previews are immutable, validate bounded rate
assumptions, and perform no writes. Legacy disposal deletion remains deferred because
the current aggregate disposal record cannot restore the exact consumed lots; the
predecessor's synthetic replacement-lot behavior is not ported. Exports, harvest
pricing, IPC, and priced/allocation views remain outside this slice. The next portfolio
work is the priced and allocation read-model boundary.

**Completed 2026-08-09 — priced portfolio and allocation read models:** the
portfolio service now derives exact-decimal holdings from open lots through an
injected `PriceSource` and `Clock`. Every view exposes the application request and
receipt times, source name, priced/unpriced counts, and an explicit complete,
partial, unavailable, failed, or not-required pricing status. Total open cost is
kept separate from priced-book cost and unrealized P&L so a partial feed cannot look
like a complete portfolio valuation. Malformed, zero, and unrequested prices are
ignored; provider failures return an immutable unpriced view without leaking raw
diagnostics. Allocation reads only the stored user policy. Rebalance output remains
estimate-only and is suppressed when pricing is incomplete or a target lacks a real
holding, rather than synthesizing positions or trades. No polling, network adapter,
IPC, policy suggestions, or strategy defaults were added. P3 remains blocked and its
defaults remain unvalidated. The next portfolio work is the allocation-policy
mutation boundary: validate complete target invariants atomically while keeping
`ALLOCATION_SUGGEST` deferred to P3.

**Completed 2026-08-09 — Nautilus re-audit, price provenance, and allocation-policy
mutation:** the owner-authorized local rebuild was re-audited without consulting an
online Nautilus source or changing the source tree. The adoption matrix now anchors
the relevant local files by SHA-256 and records the additional configuration,
valuation-evidence, scheduler, testing, and benchmark decisions. Spot prices are now
immutable per-instrument observations with exact price, stable source and quality,
and nullable authoritative observation time. Fallbacks preserve the winning
observation, portfolio views expose deterministic source/quality counts and
per-holding provenance, and any non-Coinbase venue price blocks a rebalance estimate
without blocking display valuation. Allocation-policy saves collect all stable
path/code issues in deterministic order, canonicalize and freeze a complete valid
policy before starting storage, and atomically preserve the old policy after any
failure. Clearing is explicit and restores the 5% band. TypeScript remains
authoritative; the architecture now allows a pure Rust batch kernel only after the
documented parity and performance gate passes, and no production native dependency was added.
P3 remains blocked and strategy defaults remain unvalidated. Snapshot evidence,
carried-price policy, scheduling, IPC, and execution work remain queued for their
planned phases.

**Completed 2026-08-10 — append-only portfolio snapshot evidence:** migration 38 adds immutable
valuation facts with separate scheduled, observed, and locally recorded times. Complete equity is
nullable by construction: partial, unavailable, and migrated legacy-unverified observations retain
their display-only priced subtotal but can never enter the equity field or performance calculation.
Canonical unpriced instruments are persisted, exact retries are idempotent, later same-day recovery
is appended rather than overwriting earlier facts, and reads are bounded without truncating stored
history. The portfolio evidence service accepts an explicit scheduled time and uses injected reads
and clocks; it adds no scheduler. Daily performance deterministically selects the latest observation
per UTC day and excludes incomplete or legacy days. Carried-price reuse, snapshot UI, IPC, and
scheduler behavior remain deferred; P3 and its strategy defaults remain unchanged.

**Completed 2026-08-10 — durable UTC scheduler foundation:** migration 39 extends the existing
per-wallet lease record with an immutable cadence, UTC offset, enabled state, and deterministic due
index. The host-driven scheduler validates the complete task set before persistence, calculates
strict UTC boundaries from an injected `Clock`, recovers expired running leases idempotently, and
runs the deterministic due queue through a FIFO concurrency limit of two. Owner-bound release
prevents a stale worker from finalizing a lease it lost. Shutdown is idempotent, aborts active work,
does not let queued work acquire a durable lease or execute, and leaves canceled schedules due for
an explicit retry.
Task failures expose only stable reason codes; scheduler metrics contain outcome-level labels and no
wallet/profile cardinality. The service has no keychain, network, IPC, UI, strategy, or execution
dependency, and a regression test proves keychain-like construction extras are never read. The
composition root still owns the single wake-up mechanism; IPC and `CoquiClient` remain deferred.
P3 remains blocked and its strategy defaults and final holdout remain unchanged.

**Completed 2026-08-10 — scheduler automation-status boundary:** the remaining P4 scheduler-owned
status capability now returns bounded profile-ordered views classified as scheduled, running,
overdue, lease-expired, stopped, error, or disabled using only the injected `Clock`. Views omit lease
owner identity, expose an expiry only for an active lease, sanitize legacy free-form errors to a
stable `legacy_unverified_error` code, and are deeply immutable. Status reads never acquire,
finalize, or otherwise mutate a lease. Query metrics report only aggregate profile, active-lease,
and unhealthy counts with no wallet labels. `PROFILE_AUTOMATION_STATUS` is therefore implemented at
the service boundary while its contracts/IPC transport remain deferred; the P5-only launch-at-login
shell action remains outside the scheduler. P3, strategy defaults, and the final holdout are
unchanged.

**Completed 2026-08-10 — first risk-service slice:** `REALITY_CHECK` now validates every supplied
portfolio, cost, cadence, concentration, significance, history, paper-state, and evidence-hash fact
before reading the injected `Clock`. Invalid requests return all deterministic path/code issues and
never echo raw values or unknown field names. Successful reports expose only stable advisory codes,
are deeply immutable, and carry both the exact source-evidence hash and a deterministic assessment
hash binding all validated facts and assessment time. Even a clear report explicitly sets
`liveExecutionPermitted` to false: it is advisory evidence, never an execution gate. No strategy
configuration or default is selected or validated, and no portfolio, research, storage, scheduler,
IPC, or execution state is mutated. `EVIDENCE_TRACKER` and `LONG_TERM` were intentionally kept as
separate follow-up slices so their provenance contracts could not be blurred into this report. P3
and the final holdout remain untouched.

**Completed 2026-08-10 — fail-closed evidence tracker:** `EVIDENCE_TRACKER` now reads the append-only
trial registry and immutable research evidence without mutating either. The current project state is
reported honestly as `blocked_trial_history_incomplete`; the tracker cannot manufacture figures
while the historical trial count remains a known lower bound. With a complete registry it
distinguishes no snapshot, integrity failure, unsupported schema, unmet gates, and eligibility for
human review. Gate figures are accepted only from a strict versioned envelope whose snapshot hash,
dataset, costs, pre-registration, code-revision hash, and exact current trial-registry hash remain
bound together. Returned facts and gate codes are deeply immutable and contain no stored prose or
raw diagnostic text. Even when all four gates pass, the result is only `eligible_for_review` and
`liveExecutionPermitted` remains false. Contracts/IPC, exports, UI, strategy adoption, and the final
holdout remain deferred.

**Completed 2026-08-10 — explicit long-term risk assessment:** `LONG_TERM` now accepts only a
canonical Coinbase USD spot instrument, strictly increasing completed venue-reported observations,
an explicit source-dataset hash, and a complete caller-supplied indicator parameter set. It never
loads or implies strategy defaults and rejects reference, incomplete, malformed, non-monotonic, or
future observations. Exact input prices remain decimal strings while indicator calculations use the
existing pure core evaluator. Reports replace narrative rationale with stable reason codes, expose
dataset, series, and parameter hashes, preserve observation time and age, and are deeply immutable.
Both `orderIntentCreated` and `liveExecutionPermitted` are always false. With `REALITY_CHECK` and
`EVIDENCE_TRACKER`, all three P4 risk-owned service capabilities are now implemented; export/UI
transport remains P5/P8 work and P3 remains blocked.

**Completed 2026-08-10 — typed append-only alerts foundation:** migration 40 replaces predecessor
JSON alert state with profile-scoped typed policy, canonical Coinbase price targets, immutable alert
facts, and separate read/archive presentation metadata. Complete rule configurations validate every
boolean, exact decimal threshold, and quiet-hour invariant before one replacement write. Price
targets use injected UUIDv4/time sources, exact decimal USD prices, explicit directions, and removal
tombstones rather than deletion. Alert facts carry stable keys, kinds, severity/reason codes,
optional canonical instrument identity, observed/recorded time, and an evidence hash; exact retries
deduplicate while conflicting identities fail closed. Mark-read and clear/archive operations mutate
only presentation state and cannot update or delete evidence. Reads are bounded, deeply immutable,
and isolated by profile. No timer, rule evaluator, free-form notification copy, Electron API, native
notification, paper alert, IPC, or execution behavior was added; native delivery remains P5 and
alert evaluation/surfaces remain bounded by their later phases.

**Completed 2026-08-10 — secret-safe advisor connection boundary:** migration 41 persists only a
profile-scoped, allowlisted Coqui model-policy identifier and its injected-clock update time. Gemini
keys remain exclusively in the injected secret store: the main predecessor keyring account is
preserved, additional profiles are isolated, status exposes only connected, disconnected, or
unavailable presence, and no returned or SQLite value contains credential material. Connect,
disconnect, status, and policy mutation validate before touching time or state, return only stable
path/code failures, and produce deeply immutable advisory-only views with execution authority
explicitly false. Disconnect removes only the scoped advisor credential and safe model config.
Advisor questions, welcome state, TTS, social context, provider network calls, IPC, UI, strategy
signals, and execution behavior remain deferred. P3 remains blocked; its defaults and final holdout
are unchanged.

**Queued P4/P5/P8 — provider-neutral portfolio advisor:** extend the advisor boundary to Gemini,
the OpenAI API, and the Anthropic API through one provider interface and separately scoped OS-secret
entries. P4 owns only provider status, allowlisted Coqui model-policy mappings, bounded/cancelable
HTTP adapters, and strict versioned input/output schemas. P5 adds explicit provider selection,
streaming conversation and scan UI, payload/privacy preview, percentage-only sharing by default,
and a separate opt-in for exact dollar values. P8 may add evidence-grounded portfolio scans and an
explicit multi-provider comparison mode. Coqui computes every holding, return, allocation, price
quality, concentration, and risk fact locally; providers receive a minimized
`PortfolioAnalysisSnapshotV1` and may return only a validated `AdvisorReportV1` containing evidence
references, observations, uncertainties, data-quality warnings, and questions. They receive no
database, wallet identity, credential, tax-lot, strategy, scheduler, IPC, or execution tool access.
Reports never create order intents, mutate allocation/strategy policy, or affect the live-evidence
gate. Provider failover and sending to multiple providers are never silent. The implementation must
honor current provider retention controls, including OpenAI `store: false` where supported, while
making clear that this is not equivalent to approved zero-data-retention. See the official
[OpenAI structured-output](https://developers.openai.com/api/docs/guides/structured-outputs),
[OpenAI data-control](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint),
[Claude structured-output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
and [Anthropic retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
documentation. No provider SDK or network call is added by this plan note.

**Completed 2026-08-10 — accounts profile-metadata foundation:** the first accounts slice adapts
the predecessor's version-1 global wallet manifest without moving profile identity into any one
wallet database. The storage boundary accepts the predecessor field names and non-secret Coinbase
fingerprints, but strictly validates the complete manifest, unique profile/database identity, exact
ordering, active membership, palette/icon allowlists, timestamps, and path-safe database filenames.
Corrupt or unavailable manifests fail closed and are never silently replaced. Writes use an atomic
sibling replacement plus revision check. The accounts service now owns secret-free profile list,
active-profile, initialization, creation, display-metadata update, and exact-permutation reorder
behavior. It uses injected time and UUIDv4 sources, provisions and migrates an isolated database
before publishing a new profile, returns deeply immutable views, and validates before consuming
time, IDs, storage, or provisioning work. It never returns database filenames or Coinbase
fingerprints. Profile switching, duplication, delete preview/deletion, cross-profile summaries,
credential copying, IPC, and filesystem cleanup remain separate follow-up slices; no database is
closed and no user data or secret is removed here. P3, strategy defaults, and the final holdout are
unchanged.

**Completed 2026-08-10 — two-phase profile context switching:** `PROFILE_SWITCH` now validates the
target and resolves it from the strict global manifest before consuming injected time or preparing a
context. The injected context manager must open and migrate the target without changing the active
context; only then does the service revision-check and publish the durable selection and request one
atomic commit. A safe commit refusal leaves the old context active and rolls the manifest back to
the exact prior state. A thrown/ambiguous commit fails closed as `context_recovery_required` and
keeps the durable target for restart recovery rather than guessing which context is live. Concurrent
profile reads and mutations through the service return `profile_operation_in_progress`, repeated
selection of the active profile is a no-op, and successful views remain secret-free and deeply
immutable. This slice adds no Electron lifecycle, credential reads/copies, profile duplication,
deletion, or user-data cleanup; the P5 composition root must implement the prepared-context contract.
P3, strategy defaults, and the final holdout remain unchanged.

**Completed 2026-08-10 — fail-closed profile deletion-impact preview:**
`PROFILE_DELETE_PREVIEW` now resolves only strict manifest metadata and reads bounded category counts
for open lots, disposals, portfolio, paper, research, alert, Coinbase-import, and operational
evidence. Credential inspection crosses a value-free adapter boundary and returns only configured
categories; secret values, keychain account names, database filenames, evidence content, and raw
reader failures never enter the preview. The immutable result distinguishes complete from incomplete
inspection, reports stable blocker/warning codes, and always requires explicit confirmation. Last or
active profiles are blocked. Unavailable evidence or credential inspection fails closed. Preview
eligibility now requires a supplied backup artifact whose profile, manifest revision, evidence
counts, and credential categories all match the fresh inspection; an empty profile without a backup
is not called deletion-ready. The preview shares the profile-switch gate and performs no manifest
replacement, acknowledgement, database write, secret removal, filesystem mutation, backup, or
deletion. Backup and deletion are separate operations. P3, strategy defaults, and the final holdout
remain unchanged.

**Completed 2026-08-10 — verified recoverable profile-backup foundation:** an inactive, non-last
profile can now be backed up through the same serialized profile-operation gate. Storage opens the
source read-only and uses SQLite `VACUUM INTO`, writes a strict version-1 manifest containing source
manifest revision, schema version, bounded evidence counts, deterministic credential categories,
and SHA-256 database identity, then atomically publishes the artifact directory. Creation and later
verification both require SQLite integrity/schema agreement and checksum parity; tampering,
traversal, conflicts, malformed metadata, unavailable inspection, and destination failures return
stable codes without raw diagnostics. Credential values are never read by the backup boundary or
written to the artifact; `credentialsIncluded: false` is explicit. Tests prove source database,
global manifest, and secret-store values remain unchanged, failed temporary artifacts are cleaned,
and successful results are deeply immutable and path-free. The artifact grants no implicit restore
or deletion authority; the separately confirmed deletion workflow is recorded below. Restore
remains deferred. P3, strategy defaults, and the final holdout remain unchanged.

**Completed 2026-08-10 — confirmed, recoverable profile deletion:** `PROFILE_DELETE` now accepts
only an exact `delete_profile_permanently` confirmation bound to the target profile and verified
backup UUID. Before consuming injected time or a deletion UUID it rejects active/last profiles,
re-verifies the artifact, and requires the current manifest revision, bounded evidence counts, and
credential categories to equal the backup metadata. Storage writes and flushes a strict deletion
journal before the revision-checked manifest replacement; manifest removal is the explicit commit
point because the manifest, filesystem, and OS keychain cannot form one transaction. Target
database, WAL/SHM, Coinbase credential, and Gemini credential cleanup are idempotent and scoped.
After the commit point, interruption returns `deleted: true` with exact pending cleanup rather than
misreporting rollback. Recovery enumerates a bounded journal set, re-verifies the retained backup,
resumes cleanup, and fails closed on corrupt journals. Tests cover exact confirmation, tampered and
stale backups, changed evidence/credential categories, source/manifest/secret isolation, completed
deletion, pending keychain cleanup, restart recovery, and repeated recovery. The verified backup is
retained; restore, IPC, and UI remain separate work. P3, strategy defaults, and the final holdout
remain unchanged.

**Completed 2026-08-10 — explicit credential-free profile duplication:** `PROFILE_DUPLICATE` now
creates a consistent SQLite snapshot under the shared profile-operation gate, assigns a new injected
UUID/time, and publishes an inactive manifest record only after complete verification. Unlike the
predecessor's optional secret-copy branch, the Coqui service has no secret-store dependency and the
new manifest entry omits Coinbase key/portfolio fingerprints. Storage discovers every current or
future table with an explicit `profile_id`, rejects any foreign identity in the source snapshot, and
rewrites all scoped rows transactionally. Completed settings, portfolio, paper, research, alert,
risk, import, and operational evidence remain local to the clone, while scheduler lease authority,
unfinished Coinbase staging rows, and legacy Coinbase/Gemini connection/sync markers are explicitly
excluded. Schema version, foreign keys, integrity, SHA-256 identity, discovered-table count,
rewritten-row count, transient exclusions, and cleared metadata are returned as immutable evidence.
Manifest conflict cleanup first rechecks that no record references the clone before removing it.
Tests cover future-schema discovery, full identity rewrite, source immutability, contamination
rejection, transient/credential-marker exclusion, secret and fingerprint isolation, destination
conflicts, publication rollback, validation, and operation serialization. P3, strategy defaults,
and the final holdout remain unchanged.

**Completed 2026-08-10 — bounded cross-profile comparison:** `PROFILE_COMPARE` now validates an
optional unique profile selection, preserves manifest order, and captures detached facts from
isolated SQLite databases under the shared operation gate with read concurrency capped at four.
The gate is released after database readers close; one shared price request then covers the union of
canonical tracked and paper instruments. All values remain exact decimal strings. Tracked and paper
priced subtotals are distinct from nullable complete equity, while source/quality counts and sorted
canonical unpriced instruments make coverage explicit. Missing, corrupt, or oversized databases
produce stable per-profile unavailable rows instead of false zero balances, and provider failure is
contained without raw diagnostics. Results omit database filenames, credential state, fingerprints,
and raw evidence rows. Tests cover mixed Coinbase/reference/missing prices, tracked and paper
valuation, selection/order validation, partial database failure, four-reader concurrency, operation
serialization, provider failure, secrecy, and deep immutability. P3, strategy defaults, and the final
holdout remain unchanged.

**Completed 2026-08-10 — secret-free multi-profile dashboard:** `PROFILE_DASHBOARD` now composes the
bounded comparison view with isolated operational reads capped at four. An injected clock determines
Coinbase freshness, schedule health, lease expiry, and overdue state. The result exposes only stable
warning, risk-stage, and safety-kind codes plus grouped unresolved-incident counts; it never returns
credential values, provider fingerprints, lease owners, incident detail, safety reasons, database
filenames, or raw diagnostics. Exact tracked and paper subtotals remain distinct from nullable
complete aggregates, so missing prices or unavailable profiles cannot become false complete equity.
Manifest changes between valuation and status capture fail closed, while an individual corrupt status
read remains an explicit partial profile without erasing valid valuation. Tests cover exact aggregation,
freshness, schedule/risk/safety warnings, incomplete prices, concrete persisted corruption, partial
failure, snapshot conflict, four-reader concurrency, secrecy, and deep immutability. Transport remains
deferred; P3, strategy defaults, and the final holdout remain unchanged.

**Completed 2026-08-10 — bounded all-profile refresh orchestration:** `PROFILE_REFRESH_ALL` now
captures manifest order and one injected request time under the shared profile-operation gate, then
fans out through a narrow injected authenticated-acquisition executor with at most four profiles in
flight. Results preserve every profile in deterministic order and distinguish refreshed, skipped,
failed, and cancelled outcomes with aggregate counts, bounded evidence counts, and closed reason
codes. Caller cancellation prevents new work from starting while retaining truthful terminal results
for already-running work. Thrown, malformed, or secret-bearing executor responses are contained as
stable failures; database filenames, credentials, HTTP objects, response bodies, and raw diagnostics
never enter the public result. Unlike the predecessor, the command does not serialize all network
work or couple completion to another dashboard request. The accounts layer itself performs no
storage mutation; authenticated acquisition remains injected, and dashboard invalidation/querying is
deferred to P5 composition. Tests cover deterministic order, mixed outcomes, malformed responses,
four-way concurrency, mid-flight and pre-flight cancellation, busy-operation exclusion, corrupt
manifest and invalid-clock fail-fast behavior, secrecy, and deep immutability. IPC, scheduling,
execution, tax-lot mutation, P3, strategy defaults, and the final holdout remain unchanged.

**Audited 2026-08-10 — P4 service completion reconciliation:** the 76 `Adapt` rows in the
predecessor handler inventory were checked against concrete service exports and tests. Fifteen
previously unlabelled rows are proven aliases of completed profile, portfolio, and scheduler
boundaries; lower-layer helpers were not counted as services. Thirty-five genuine gaps remain,
grouped and dependency-ordered in `docs/p4-completion-audit.md`. Coinbase connection is next because
the completed all-profile fan-out must not be bound to authenticated acquisition until credential
publication, duplicate portfolio identity, rollback/recovery, and view-only permission semantics are
proven. This audit changes no runtime state and does not advance P3, strategy defaults, the final
holdout, IPC, `CoquiClient`, or P5 UI work.

**Completed 2026-08-10 — profile-scoped Coinbase connection boundary:** `COINBASE_STATUS`,
`COINBASE_CONNECT`, `COINBASE_CONNECT_JSON`, and `COINBASE_DISCONNECT` now share one secret-safe
service. Credentials are validated and canonicalized as ES256 before an abortable GET-only probe
proves account readability and requires View while rejecting Trade, Transfer, and Coinbase's newly
separate Receive permission. Successful publication stores private material only in the scoped
secret store and writes only SHA-256 key/portfolio identities to the revision-checked global
manifest; either duplicate identity blocks another profile. Connect and disconnect restore the prior
secret after manifest conflict, surface explicit recovery-required state if restoration fails, and
never delete portfolio evidence. Status derives disconnected, connected, attention-required, or
unavailable state without network access, raw errors, credentials, or fingerprints. Current adapter
source is now resolved directly by both typecheck and Vitest, closing a stale-build test gap. Tests
cover the official four permission flags, retry-bound cancellation, malformed and secret-bearing
input containment, duplicate identities, both rollback directions, derived mismatch states,
idempotent disconnect, secrecy, and deep immutability. Coinbase account/fill ingestion and
discrepancy evidence remain next; no IPC, execution, tax-lot promotion, P3/default, or final-holdout
behavior was added.

**Completed 2026-08-10 — Coinbase account/fill and discrepancy evidence:** `COINBASE_SYNC` and
`COINBASE_IMPORT_DISCREPANCIES` now use a complete bounded cursor acquisition over Coinbase accounts
and spot fills, with exact-decimal normalization, authoritative provider timestamps where supplied,
separate injected request/receipt times, deterministic dataset identity, duplicate/cursor conflict
rejection, cancellation, and stable secret-free failures. Migration 42 atomically appends immutable
sync, account, fill, and directional balance-discrepancy facts; exact retries are idempotent and
bounded reads retain origin-profile provenance across isolated profile duplication. The existing
four-way refresh boundary is bound through an injected profile context, and the last-sync marker is
committed with the evidence. Tests prove rollback and that tax lots/disposals remain byte-for-byte
unchanged: no missing balance creates a lot, no outflow resizes a lot, and no discrepancy creates a
fill, resolution, or execution estimate. The verified baseline is 104 test files / 631 tests. The P4
queue advances to the profile-scoped display universe/watchlist; P3, defaults, the final holdout,
IPC, scheduler expansion, and live execution remain unchanged.

**Completed 2026-08-10 — profile display universe and Coinbase catalog:** `CATALOG_SEARCH`,
`COINS_GET`, `COINS_SET`, and `COINS_SEARCH` now share a bounded `DisplayUniverseService` over the
officially documented public Coinbase product catalog. The adapter accepts only complete online USD
spot identities, strictly validates product metadata and conflicting duplicates, forwards caller
cancellation, and returns stable failures without provider diagnostics. Search/page results retain
canonical Coinbase mappings with injected request/receipt time. Migration 43 stores an exact ordered
profile preference and immutable origin events; explicit empty selection is allowed, while unknown,
duplicate, oversized, or extra-field input fails before mutation. Profile copies rewrite current
preference ownership but preserve historical origin. Tests prove that `universe_snapshots` and the
golden research path remain unchanged. The predecessor audit also corrected `WATCHLIST_*`: those
handlers concern attributed public blockchain addresses, not selected coins, so their observation and
unverified-attribution evidence remains queued separately. The verified baseline is 107 test files /
650 tests. The P4 queue advances to typed account settings; P3, strategy defaults, the final holdout,
IPC, scheduling, and execution remain unchanged.

**Completed 2026-08-10 — typed profile presentation settings:** `SETTINGS_GET` and `SETTINGS_SET`
now terminate at `AccountSettingsService`, which owns only theme, density, motion, and language.
Migration 44 stores a complete typed row per profile; unsaved reads return explicit Coqui presentation
defaults without writing them. Patch validation reports every invalid field in deterministic input
order before time or storage, rejects unknown fields and all predecessor financial/tax/provider/
strategy/venue-cost/advisor fields, and atomically merges only a valid partial patch. No value is
silently dropped or clamped. Tests prove default/saved provenance, profile isolation and duplication,
clock rollback, transaction rollback, deep immutability, and that the predecessor `user_settings`
blob cannot be mutated through this boundary. The verified baseline is 108 test files / 657 tests.
The P4 queue advances to the market-data display query facade and optional CoinGecko connection; P3,
strategy defaults, the final holdout, IPC, scheduler expansion, and execution remain unchanged.

**Exit:** every old handler has a home. **A dependency-cycle test fails the
build.** No service imports more than two others. No service over 500 lines.

---

### P5 — Shell and new UI · 3–4 weeks

The UX problem is solved, not relocated.

- Electron main as composition root only, under 500 lines
- **Port the hardening verbatim, then add presence tests** — §1, N11
- **Restrict `shell.openExternal` to HTTPS with an explicit domain allowlist** — S5
- Preload with Zod validation — §5
- **Query layer** — N9
- Implement the design, motion, accessibility, and performance contract in
  `docs/UI-UX.md`; `ui-kit` first, then screens — `ARCHITECTURE.md` §9
- Begin with task maps and low-fidelity wireframes for the scoreboard, portfolio,
  and paper-action review. Obtain owner approval on information hierarchy before
  applying a visual theme or propagating components to other screens
- Screen the user's
  [UI-library catalogue](https://github.com/gabrielizalo/Awesome-CSS-Frameworks-and-UI-Libraries)
  as a discovery index. Audit each candidate's own license and maintenance; do
  not assume the catalogue license covers linked code or assets
- Prototype Base UI, React Aria Components, and Radix against the same Electron,
  CSP, keyboard, high-contrast, reduced-motion, bundle, and performance checks.
  Select and pin at most one headless primitive layer in an ADR; Tailwind and
  Coqui-owned tokens remain the visual layer
- Enforce the anti-template authorship rules in `docs/UI-UX.md` §0: no wholesale
  styled kit, mixed component packs, card-everything dashboard, glass/gradient
  decoration, generic AI copy, or unlicensed/generated filler assets
- Use tokenized 83/167/250ms motion for purposeful local transitions; native
  CSS/Web Animations first, compositor-friendly properties only, with a tested
  reduced/no-motion path
- Implement the action-feedback contract in `docs/UI-UX.md` §3.1: next-frame
  press acknowledgement, stable pending labels without layout shift, keyboard
  parity, duplicate-command prevention, and explicit success/failure/blocked/
  unknown outcomes. Optimistic success is forbidden for financial, credential,
  kill-switch, export, and destructive actions
- Add a production-build performance harness before feature polish: p75
  interaction latency ≤200ms, warm useful shell ≤1.5s on the recorded reference
  machine, responsive chart pan/zoom, and no recurring renderer-blocking work
- **First screen: the strategy scoreboard**, every number carrying provenance
- Then portfolio, allocation, tax, markets, paper, settings
- Port `help.ts` — §1

**Exit:** app runs; no component owns a timer; no component over 300 lines; CSP,
sandbox, navigation-block and permission-deny presence tests pass; the
`setInterval` lint rule is active. The task review, keyboard/zoom, reduced-motion,
incremental-chart, loading/error-state, and measured performance gates in
`docs/UI-UX.md` §7 pass. The three-workflow screenshot set is owner-approved and
the heuristic review records no unresolved high-severity usability finding.
Action feedback remains responsive under the recorded stress case, sends no
duplicate non-idempotent command, preserves focus/layout, and never displays an
unconfirmed financial result as success.

---

### P6 — Paper-trading engine · 2 weeks

- Consolidate the simulators — R3
- Durable orders, fills, positions, append-only journal
- **One OMS state machine, the same one a future live path would use.** Not two
  implementations that drift
- **Double-entry position and cash ledger**; every state mutation and posting in a
  single transaction
- Forward-evidence counters: observed UTC days, decisions, fills — never elapsed
  empty days
- Split the simulation lab into scenario definitions + runner — R4
- **Reconciliation harness** — N4
- Wire the full chain with no bypass — `ARCHITECTURE.md` §6

**Exit:** 7-day unattended run with a complete journal. Reconciliation reports a
quantified divergence. **A test proves no path reaches execution while skipping a
gate.** Kill switch halts everything including paper.

---

### P7 — Coinbase read-only integration · 1–2 weeks

- Connect flow with permission probe — §1
- Accounts and fills: cursor pagination, loop detection, **atomic failure** so a
  mid-import error leaves the ledger unchanged
- **Rebuild reconciliation as an explicit ledger** — transfers, rewards,
  adjustments, and *unresolved exceptions*. **Never invent a zero-basis lot or
  proportionally rescale lots** (S2). Tax exports stay labelled estimates
- CSV importer from the `pivot` branch — R10
- Multi-wallet manifest and per-wallet DB contexts — §1

**Exit:** a real view-only key imports a real portfolio. All four permission
combinations tested — view-only accepted; trade, transfer, and both rejected with
clear messages. **A secret-leak suite asserts no secret appears in any IPC
response, log line, error message, database column, exported file, or crash
report.** No cross-wallet data leakage.

---

### P8 — Risk and evidence surfaces · 2 weeks

The honesty machinery becomes the product's face.

- Risk dashboard: stage ladder, expected shortfall, exposure scaling, drawdown
- Allocation targets and drift; rebalance plan with `estimateOnly` preserved
- Tax ledger, disposals, harvest, cost-basis method
- **Evidence tracker**: live-gate progress — 90 observed days / 50 decisions /
  30 fills / beats hold and passive / clears deflated Sharpe
- **Negative-results surface** rendered from `docs/studies/`
- Alerts: rules, cooldown, OS notifications — R9

**Exit:** every displayed figure has visible provenance. **The gate cannot be
edited or overridden from the UI** — tested. Reaching the gate does not enable
live; it only makes live *considerable*.

---

### P9 — Observability and distribution · 1 week

- Logging throughout with redaction; metrics; append-only incidents
- One `electron-builder` config; macOS + Windows on tag
- Release checklist, install guide
- Code signing when funded — the only paid item in this plan

**Exit:** a background failure is diagnosable from logs alone. A log-redaction
test injects a known secret and asserts it never appears. CI produces installable
artifacts on tag.

---

### P10 — Webhook ingestion *(optional — decide first)* · 1–2 weeks

**What TradingView is not.** It is not a market-data API and not a broker API.
There is no sanctioned endpoint to pull OHLCV from it, and orders cannot be
placed *through* it by a third-party application — its broker integrations run
inside its own UI. The only supported programmatic surface is **outbound webhook
alerts**. Any library claiming otherwise is scraping private endpoints; do not
use one.

The one piece of TradingView technology that legitimately belongs in this project
is already here: `lightweight-charts`, their open-source charting library, is a
direct dependency.

**Default answer is no.** This system's value is that signals are generated and
validated internally with next-bar timing, charged costs, and deflated
significance. An externally generated alert arriving over the network bypasses
all of it. There is also an architectural cost: a webhook needs a public HTTPS
endpoint, and this is a local desktop app.

Build only to *evaluate* an external strategy, never to *follow* one. Write the
ADR before any code.

**The second audit sequences this differently** — its Phase 6 of 9, treated as a
real feature rather than an optional late one. Its argument is stronger than a
straight "external signal" framing because it pairs the webhook with **Pine ↔
backend parity fixtures**: reimplement the Pine strategy as a versioned backend
strategy, pin strategy version, bar timing and next-tick semantics, and prove the
two agree. Under that design the webhook is a redundant trigger for a strategy
you *have* validated internally, which answers the main objection. If you build
this, build the parity fixture first — it is the part that makes the rest
legitimate.

Practical blocker either way: a webhook needs a public HTTPS endpoint on port 80
or 443 answering within three seconds, and this is a local desktop application.
Under the alternative hosted architecture in ADR-0001 that endpoint already
exists; under the local-first path it is extra infrastructure. **This decision is
partly downstream of ADR-0001.**

If built: unguessable per-user route over HTTPS · HMAC shared secret with
constant-time comparison, never exchange credentials in the body · small JSON
schema with `schema_version`, `alert_id`, `strategy_version`, `instrument`,
`bar_time`, `issued_at`, `expires_at`, `action` · payload size cap · durable
inbox with idempotency key, **acknowledged inside three seconds** · asynchronous
processing that rejects expired, duplicate, unknown-version and out-of-order
alerts · per-source rate limit · append-only log **including rejected alerts** ·
Pine ↔ backend parity fixtures · a replay harness scoring logged alerts through
the backtest · alerts enter at the **top** of the guardrail chain.

**Never submit an order in the HTTP request path.** IP allowlisting is
supplemental — TradingView publishes source ranges but they change, so the shared
secret is the identity check. Alerts require 2FA on the TradingView account, and
alert instances are snapshots that must be recreated after any script or input
change — so `strategy_version` in the payload is load-bearing, not decoration.

**Exit:** logged alerts are replayable through the backtest and scored. Pine and
backend agree on the parity fixture. A failure campaign — replay, duplicate,
stale, malformed, oversized, wrong secret, out-of-order, delayed worker —
produces no duplicate order intent. A test proves an alert cannot reach execution
without passing every gate.

---

### P11 — Live-trading preparation · 3–4 weeks · **do not start until P0–P9 are done**

Close the three live-blocking gaps. **Still do not enable live.**

**Preconditions, all required:**

1. A strategy cleared 90 observed paper days, 50 decisions, 30 fills
2. It beats hold **and** passive out-of-sample
3. It clears the deflated Sharpe **against the true registered trial count**
4. Reconciliation divergence is within a stated tolerance
5. Logging and metrics are in place and have caught at least one real incident

**Work:** order idempotency keys (nothing currently prevents duplicate submission
on retry) · **ambiguous submissions transition to `unknown` and recovery queries
the venue before resubmitting — never blind retry** · continuous position
reconciliation that **halts on mismatch and never self-heals** · order state machine extended with exchange-side confirmation ·
dry-run mode that builds the real payload and submits nothing · tiny-notional
first path with a separate write-scoped key, explicit consent, minimum notional,
one trade per day, manual approval per trade.

Note: Coinbase's Advanced Trade sandbox returns static predefined responses and
requires no authentication (S7). It validates contract parsing only — not fills,
latency, rejection, or matching. The deterministic simulator is not optional.

**Exit:** dry-run produces a valid payload with zero network writes. A simulated
retry storm produces exactly one order. An injected desync halts and alerts. The
kill switch stops live.

**Enabling live is a separate, explicit human decision that this plan does not
make.**

---

## 3. Sequence

```
P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 ─┬─→ P10 (optional)
                                                  └─→ P11 (gated)
```

P0–P9 ≈ 16–20 weeks part-time to an application better than the predecessor in
every dimension, with the engine's correctness proven rather than assumed.

## 4. Not before their phase — and some never

| Item | When | Why |
|---|---|---|
| Live order submission | P11 + all five preconditions | Idempotency, reconciliation and desync detection do not exist. This is the one that loses money |
| Webhook ingestion | P10, if ever | Bypasses the validation chain that is the entire point |
| ML in the decision path | Never (research-only) | ~500 daily bars cannot support it |
| `adaptive-learning` in the default path | Never | Unbounded unregistered search invalidates the significance test |
| Second exchange | Not planned | Interface exists; implementation buys nothing for a single US spot trader |
| Multi-user accounts | Not planned | Confirmed single-user |
| WebSocket feeds | P9+ if justified | Daily bars do not need them |
| Market making, HFT, grid trading, cross-exchange arbitrage | Never | ~170bps round-trip friction on daily bars rules them out arithmetically, regardless of engineering |
| Any server, cloud DB, container orchestration | Never | It is a desktop app |

## 5. Definition of done — every work item

1. `pnpm verify` green
2. Tests written alongside the code, in the same package
3. Golden fixture still passes, or is regenerated in a separate commit with the
   delta documented
4. No `TODO` comments
5. No file over 500 lines (300 for renderer components)
6. Boundary lint passes
7. Anything touching guardrails, the kill switch, `canExecute`, permissions or
   secrets carries a test proving the safeguard still holds
8. Anything affecting performance claims updates the relevant study in
   `docs/studies/`
9. Public functions have doc comments explaining *why*

## 6. The three that matter most

Everything else is supporting detail.

1. **Register trial counts and re-derive the defaults** (P3). The significance
   machinery exists and is correct; it is simply not pointed at the defaults.
2. **One query layer, zero component timers** (P5). This is the actual cause of
   the UX problems, and it reproduces itself in any new interface unless replaced
   deliberately.
3. **Build the reconciliation harness** (P6). The only mechanism that can reveal
   a dishonest backtest before real money does.
