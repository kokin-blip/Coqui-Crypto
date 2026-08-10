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
Current phase:  P2 — in progress
Last completed: P1 — Pure core migration (2026-08-01)
Blocked on:     —
```

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
`docs/studies/cost-correct-preregistration-2026-08-09.md`. It remains unregistered
until a real verified N7 dataset hash exists.

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

Next: prepare the verified multi-asset archive as the exact decision dataset,
register the real 16-candidate study, and execute it once.

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

Next: choose the actual Coinbase asset mix and coverage from available source
archives, prepare that exact dataset, then register and execute the real
16-candidate study once. No plan has been registered and no holdout has been
opened yet.

**Completed 2026-08-09 — Coinbase study archive acquired:** exact raw public
Coinbase candle responses for `BTC-USD`, `ETH-USD`, and `LTC-USD` were preserved
and bound to three verified N7 Parquet archives. The deterministic longest
shared gap-free span is 3,640 days from 2016-08-21 through 2026-08-08 inclusive.
Its prepared decision-dataset hash is
`d56276d736716bc8796be1c6a1c13a458933f5f5b52de262a0943b83890543f5`.
See `docs/studies/coinbase-study-acquisition-2026-08-09.md`.

Next: freeze the chronological development/holdout split and create a stable
code revision before registration. The repository has no commit yet, so the
acquisition uses an explicit working-tree parser label; the final study must not
pretend that label is a committed application revision. Do not open the holdout
until both choices are recorded.

**Exit:** the scoreboard reports deflated significance over the *true* historical
trial count. A study is committed recording the outcome either way. Determinism:
the same manifest run twice produces identical results.

> A negative result here is a success. It is the single most valuable thing this
> project can tell its owner. The predecessor already published three negative
> results; this would be the fourth and the most important.

---

### P4 — Services layer · 2–3 weeks

The old main process is decomposed and cannot re-form.

- Catalogue every `ipcMain.handle` into `docs/handler-inventory.md` — §5
- Implement the ten services — `ARCHITECTURE.md` §2
- `packages/contracts` with Zod schemas both directions, and `CoquiClient` — §5, N10
- Scheduler: UTC cadence, per-wallet leases, concurrency 2, injected `Clock`.
  **The scheduler must never read the keychain** — test that
- Extend the completed N6 metrics foundation with scheduler health measurements

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
- Use tokenized 83/167/250ms motion for purposeful local transitions; native
  CSS/Web Animations first, compositor-friendly properties only, with a tested
  reduced/no-motion path
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
`docs/UI-UX.md` §7 pass.

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
