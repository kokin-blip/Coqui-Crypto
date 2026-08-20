# Nautilus rebuild adoption matrix

Read-only audit of the user's personal rebuilt NautilusTrader fork at:

`C:\Users\erick\Downloads\nautilus_trader-develop (1)\nautilus_trader-develop`

This matrix treats the rebuild as owner-authorized design knowledge. Coqui adapts only concepts
which fit its TypeScript/Electron, local-first, Coinbase-centric, daily-cadence scope. The rebuild
remains unmodified, and no online Nautilus source is consulted. User-owned Rust may be reused
directly only through the benchmark gate below; Nautilus branding and out-of-scope infrastructure
are not transplanted.

## Re-audit source anchors

The downloaded folder has no embedded Git metadata, so the re-audit is anchored to SHA-256 hashes
of the local files which materially informed the added decisions.

| Local source path | SHA-256 |
|---|---|
| `crates/common/src/config.rs` | `407A3D8BD7947462E6833725489E2A53F20AA0361A401B6D74B2B0DCDFC03B6F` |
| `docs/concepts/portfolio.md` | `B80E88B326E7EDFAE7B015123FCD76B90A3C6CBF607D308B3FCFEA53ACD9E5AB` |
| `crates/model/src/events/portfolio/snapshot.rs` | `2F92A6629871FBB38E54155B689EF49DB021134DC2A85820F6B07CC5BE933C73` |
| `crates/common/src/timer.rs` | `C32A55DF1F484013AEF6B07CB02A010EE40B3B7053C665A8274C4C5BC5F7306C` |
| `crates/backtest/benches/engine.rs` | `335238B18491459971D8FFC1BEC2A61544C4D1F0CB7F9D8877E31E7477F3BD52` |
| `crates/execution/src/reconciliation/proptests.rs` | `723A37A17AB2487C1D71D0B97812EA5F291C9D6F29C8E7620C27335DF5DC21BA` |
| `crates/network/src/ratelimiter/gcra.rs` | `A3B044538F4EBD75A522ED03244287D760169493E4C6175DABCF4E4967ED0159` |
| `crates/network/src/ratelimiter/clock.rs` | `5FD9262BB0FB0209670BD2928BD8211E80617BF624255766E2BF07D7082386A5` |
| `crates/network/src/ratelimiter/quota.rs` | `C77537C7A6B31715094EEB4DB454153B444A6D94A131B134D32F74D5FB91D144` |
| `crates/network/src/retry.rs` | `BBB66A6A0C7CC0455DDED271D28F84171EDF289A4014220B7BAF89C28916D452` |
| `crates/network/src/backoff.rs` | `C4696C662D0304B0BB36464A6BCEC7BE9BDAD9AE59BFE776EAD584F9A90E3AD8` |
| `crates/network/tests/property_ratelimiter.rs` | `CCC9A686AAF3288907B44982E5C51D495EAD4B9518CAE1B49972E1E38205D957` |
| `crates/network/tests/property_backoff.rs` | `5ACA554BFFB6B1BC6E7B3AF108CE41B10725BD20F755A619ED80A780DD701A0C` |
| `crates/backtest/src/data_iterator.rs` | `0631C3C18CCC2CD1F131F6F14291CEE4C8587A96C28A4486257EA7E542030DDB` |
| `crates/backtest/src/accumulator.rs` | `DD275F83BE590A4FB769A6C1979AE2A58DA15F79184568C6C8846CD9026A6516` |
| `crates/indicators/src/momentum/rsi.rs` | `24DBC457BB6D969D1708932CDD6E6DD1B03D02DD4897BF0553077FA6693823C6` |
| `crates/indicators/src/average/sma.rs` | `3B6DA56DFC171371AEBA44D3C9BA033372EB05D9FAC1190F2E745AE23EBAA0F8` |
| `crates/model/src/types/fixed.rs` | `126CD6D31DBCDF91368F84C74469DD3014A023C5CB23F9AFFFD8A3D8F6E688C8` |
| `crates/analysis/src/statistics/max_drawdown.rs` | `75332F21B025A41587D175FD5EED3105A9A4F13B795C6837714388EFADCE0344` |

## P0-P3 strengthening

| Concept or subsystem | Rebuild source path | Coqui destination | Benefit | Stack and safety implications | Decision |
|---|---|---|---|---|---|
| GCRA admission with injected monotonic time | `crates/network/src/ratelimiter/gcra.rs`; `clock.rs`; `quota.rs` | `packages/adapters/src/http/rate-limiter.ts` | Prevents fixed-window boundary bursts and makes timing deterministic | Preserve keyed quotas and FIFO outcomes in TypeScript; no registry or ambient clock | **Adapt now** |
| Explicit cancellation and destruction outcomes | `crates/network/src/ratelimiter/`; property campaigns | HTTP admission boundary | Shutdown cannot masquerade as successful capacity acquisition | Stable `acquired`, `aborted`, and `destroyed` values; no raw errors | **Adapt now** |
| Elapsed retry budgets and bounded backoff | `crates/network/src/retry.rs`; `backoff.rs` | `packages/adapters/src/http/client.ts` | Bounds the complete request, not only individual attempts | Caller cancellation, `Retry-After`, and GET-only retry policy remain authoritative | **Adapt now** |
| Deterministic replay ordering | `crates/backtest/src/data_iterator.rs` | Existing backtest ordering and research spike | Makes equal-time processing and output hashes reproducible | Coqui canonical identities, next-bar timing, and event ordering remain authoritative | **Adapt tests/pattern** |
| Streaming accumulators and indexed windows | `crates/backtest/src/accumulator.rs`; indicator sources | Core momentum and volatility evaluation | Removes repeated prefixes and full-history recomputation | Differential tests must preserve exact public results and registered boundaries | **Adapt now** |
| Fixed-point boundary cases | `crates/model/src/types/fixed.rs` | Decimal parsers, policy validation, property regressions | Sharpens overflow, sign, precision, and rounding cases | Coqui decimal strings stay authoritative; Rust fixed-point types do not cross contracts | **Adapt tests only** |
| Property and minimized regression campaigns | Network property tests; indicator tests | Vitest plus pinned `fast-check` 4.9.0 | Explores timing, cancellation, and calculation boundaries deterministically | Fixed seeds and retained minimized examples are required | **Adapt now** |
| Existing Coqui data and evidence model | No transplant | Core/storage/research | Avoids invalidating proven behavior | Decimal strings, canonical instruments, SQLite/DuckDB, provenance, golden fixture, registered trials, and benchmark-relative statistics remain authoritative | **Keep Coqui** |
| Full backtest/exchange engine, PyO3 boundary, tick/order-book processing | Backtest/execution/model runtime | None | Not aligned with daily-bar research or paper-only scope | Would add live/multi-venue authority and replace proven timing semantics | **Reject** |
| Operational Python rewrite | Python bindings and application surface | None | Python is useful only behind a bounded research worker | It cannot own adapters, portfolio state, lifecycle, storage, scheduling, IPC, or execution | **Reject** |

## P4 service architecture

| Concept or subsystem | Rebuild source path | Potential Coqui destination | Phase | Expected benefit | Stack mismatch | Safety implications | Decision |
|---|---|---|---|---|---|---|---|
| Immutable typed commands and events | `docs/developer_guide/design_principles.md`; `crates/system/src/messages/controller.rs`; `crates/common/src/messages/system/component.rs` | `packages/contracts/src/`; `packages/services/src/runtime/` | P4 | Stable, replayable service inputs and state facts | Rust structs become strict Zod schemas and readonly TS values | Prevents consumers from rewriting historical inputs | **Adapt now** |
| Correlation and causation identity | `crates/common/src/messages/data/request.rs`; `crates/common/src/messages/data/response.rs`; `crates/testkit/src/events.rs` | Contract envelopes and later `CoquiClient` transport | P4 | Connects one request, workflow, logs, responses, and events | UUID fields replace Rust `UUID4` domain types | IDs carry no secrets or payload data | **Adapt now** |
| Component lifecycle state machine | `docs/concepts/architecture.md`; `crates/common/src/enums.rs`; `crates/common/src/component.rs` | `packages/contracts/src/lifecycle.ts`; `packages/services/src/runtime/` | P4 | Makes start, stop, degradation, failure, and disposal explicit | Coqui omits registry-specific initialization, resume, and reset states | Invalid transitions fail before state mutation | **Adapt now** |
| Injected clocks and deterministic timers | `crates/common/src/clock.rs`; `crates/common/src/timer.rs`; `docs/developer_guide/testing.md` | Existing core `Clock`; future scheduler | P4 | Reproducible timestamps and scheduler tests | Nanoseconds become Coqui's safe epoch milliseconds | No ambient wall-clock reads in core; scheduler remains injected | **Adapt; timer work deferred** |
| Path-aware configuration issues and multi-error collection | `crates/common/src/config.rs`; `crates/portfolio/src/config.rs` | Core policy validation and service mutations | P4 | One review shows every invalid field without repeated partial submissions | Rust enum/collector becomes stable TS codes and readonly path issues | Values, raw errors, and diagnostic text never enter returned issues | **Adapt now** |
| Per-instrument valuation source and quality | `docs/concepts/portfolio.md`; `crates/model/src/events/portfolio/snapshot.rs` | Core `PriceSource` and portfolio read models | P4 | Mixed venue/reference pricing remains visible per holding | Rust cache price tiers become two bounded Coqui quality tags | Reference prices may value a display but cannot enable a rebalance estimate | **Adapt now** |
| Event time versus initialization time | `crates/common/src/timer.rs`; `crates/model/src/events/portfolio/snapshot.rs` | Price observations, later scheduler events and snapshots | P4 | Separates provider or scheduled time from local receipt or construction time | Nanoseconds become safe epoch milliseconds; missing provider time is explicit null | Late work cannot rewrite when an event was actually scheduled or observed | **Adapt now/later** |
| UTC daily equity evidence including flat days | `docs/concepts/portfolio.md`; `crates/portfolio/src/portfolio.rs` | Portfolio performance service and scheduler | P4/P8 | Produces account-level returns rather than conflating position returns with portfolio returns | Coqui persists local daily evidence rather than an in-memory account ring | Partial or legacy-unverified valuation days must not become performance claims | **Adapt later** |
| Current, carried/stale, and never-priced valuation states | `docs/concepts/portfolio.md`; `crates/model/src/events/portfolio/snapshot.rs` | Portfolio snapshots and P8 evidence UI | P4/P8 | Explains whether a number is current, carried, or incomplete | Coqui has no persisted carried-price policy yet | Silent carry is forbidden; carried values never enable rebalance estimates | **Defer carry; adapt metadata later** |
| Deterministic missing-price recovery and warning transitions | `docs/concepts/portfolio.md`; `crates/portfolio/src/portfolio.rs` | Portfolio observability and evidence status | P4/P8 | Warns on state transitions rather than every refresh and clears only proven recovery | Account/venue scopes reduce to Coqui wallet/instrument scopes | A narrower successful query cannot erase another scope's unresolved gap | **Adapt later** |
| In-process publish/subscribe bus | `docs/concepts/message_bus.md`; `crates/common/src/msgbus/` | None; direct typed service calls remain authoritative | P4 | Topic fan-out is valuable at larger scale | Coqui is a small modular monolith without actor routing needs | Topic strings can hide dependencies and bypass service limits | **Reject full bus** |
| Redis/external streams | `docs/concepts/message_bus.md` external egress and ingress | None | Never | Distributed durability and cross-process delivery | Requires daemon, serialization, and operational infrastructure | Adds partial failures and violates local-only scope | **Reject** |
| Thread-local actor/component registries | `crates/common/src/component.rs`; `crates/common/src/actor/registry.rs` | None | Never | Central runtime lookup | Relies on Rust ownership, unsafe cells, and re-entrant registries | Global lookup would obscure Coqui service ownership | **Reject** |
| Cache-before-publish ownership | `docs/concepts/architecture.md` data flow; `crates/common/src/cache/` | Domain service caches; renderer query layer in P5 | P4/P5 | Consumers observe coherent state when notified | Coqui uses direct calls and TanStack Query rather than a kernel cache | Cache ownership must remain explicit per service | **Adapt later** |
| Silent carried-price reuse | `docs/concepts/portfolio.md` price fallback | None until a persisted source/age policy exists | Later/never for decisions | Can keep visual curves continuous | Coqui currently performs fresh bounded reads without a price cache | A plausible stale number could be mistaken for an actionable current price | **Reject now; display-only if later provenanced** |

## P6 execution and reconciliation

| Concept or subsystem | Rebuild source path | Potential Coqui destination | Phase | Expected benefit | Stack mismatch | Safety implications | Decision |
|---|---|---|---|---|---|---|---|
| Evidence-based command outcomes | `docs/concepts/execution.md` command outcomes | Paper OMS state machine and journal | P6 | Separates definitive local failure, confirmed result, and ambiguity | Live adapter branches are unnecessary | Ambiguous submissions remain `unknown`; no blind retry | **Adapt** |
| Typed execution commands and reports | `crates/common/src/messages/execution/`; `crates/model/src/reports/` | Pure paper types and service contracts | P6 | Explicit order, fill, position, and report boundaries | Multi-venue/live fields must be reduced to Coqui scope | Decimal and canonical instrument identity remain mandatory | **Adapt selectively** |
| Duplicate-fill and deterministic replay identity | `docs/concepts/execution.md`; `crates/execution/src/reconciliation/ids.rs` | Paper repository and reconciliation harness | P6 | Restart-safe idempotency and repeat-event detection | Reimplement hashing with Coqui-owned canonical inputs | IDs must bind wallet, canonical instrument, order, fill, and time | **Adapt** |
| Ordered reconciliation reports | `docs/concepts/reconciliation.md`; `crates/execution/src/reconciliation/` | Reconciliation harness | P6 | Compare orders, then fills, then positions against one coherent snapshot | Coqui compares paper behavior with backtest assumptions, not a live venue | Discrepancies remain explicit and append-only | **Defer to P6** |
| Synthetic fills and reconciliation orders | `crates/execution/src/reconciliation/types.rs`; `positions.rs` | None | Never | Nautilus can reconstruct incomplete live histories | Conflicts with Coqui tax-lot and accounting rules | Would invent fills/lots or silently resize state | **Reject** |
| Live and multi-exchange execution routing | `crates/execution/src/engine/`; adapter execution clients | None | Never | Broad venue execution coverage | Outside Coqui's Coinbase read-only and paper-only product | Would create a real-order path | **Reject** |
| Failure campaigns and execution testers | `crates/testkit/src/testers/exec/`; `docs/developer_guide/spec_exec_testing.md` | P6 scenario runner | P6 | Exercises transition, timeout, duplication, and restart failures | Rust live-venue harness becomes deterministic TS fixtures | Each campaign must prove a concrete Coqui guardrail | **Defer to P6** |

## P8 evidence and visualization

| Concept or subsystem | Rebuild source path | Potential Coqui destination | Phase | Expected benefit | Stack mismatch | Safety implications | Decision |
|---|---|---|---|---|---|---|---|
| Provenance-rich portfolio snapshots | `crates/model/src/events/portfolio/snapshot.rs`; `docs/concepts/portfolio.md` | Risk/evidence contracts and screens | P8 | Exposes stale, carried, unpriced, and timestamp metadata with each valuation | Money types must remain decimal strings on Coqui wire contracts | Prevents apparently precise figures when valuation inputs are incomplete | **Adapt** |
| Drawdown and expected-shortfall reporting | `crates/analysis/src/statistics/max_drawdown.rs`; `expected_shortfall.rs` | Existing core risk calculations and P8 presenters | P8 | Clear risk summaries and timelines | Nautilus analysis uses binary floats in several outputs | Reuse concepts only; do not replace Coqui decimal financial values | **Adapt selectively** |
| Order, fill, and position timelines | `crates/model/src/events/`; `crates/analysis/src/analyzer.rs` | Append-only evidence views | P8 | Reconstructs what happened and when | UI will be React/lightweight-charts rather than Nautilus tooling | Never mutate journal facts or hide rejected/unknown states | **Defer to P8** |
| Architecture diagrams and supplied charts | `assets/architecture-overview.png`; tutorial render scripts | UX research reference | P8 | Informs diagnostic hierarchy and visual storytelling | Branding and framework topology do not match Coqui | Visuals must show costs and provenance honestly | **Adapt concepts; reject branding** |

## Testing patterns

| Concept or subsystem | Rebuild source path | Potential Coqui destination | Phase | Expected benefit | Stack mismatch | Safety implications | Decision |
|---|---|---|---|---|---|---|---|
| State-transition tables | `crates/common/src/component.rs`; execution state tests | Service and OMS tests | P4/P6 | Exhaustive legal/illegal transition coverage | Rust parameterized tests become Vitest tables | Prevents hidden lifecycle and order-state bypasses | **Adapt now** |
| Deterministic clock tests | `crates/common/src/clock.rs`; `docs/developer_guide/testing.md` | Scheduler and runtime tests | P4 | No sleeps or wall-clock races | Use existing `FixedClock` | Proves event timestamps and cadence without ambient time | **Adapt now** |
| Property tests for reconciliation | `crates/execution/src/reconciliation/proptests.rs`; regression corpus | Reconciliation harness | P6 | Explores transition sequences beyond hand-picked examples | Add a TS property library only if concrete invariants justify it | Must never generate production self-healing behavior | **Defer to P6** |
| Correlated bounded async waits | `crates/testkit/src/events.rs` | Client, worker, and scheduler test helpers | P4/P5 | Tests finish on the matching response rather than arbitrary sleeps | Tokio channels become promises/fakes | Timeouts must not invent command outcomes | **Adapt when async runtime exists** |
| Fixture-driven adapter parsing | Adapter `test_data/` directories; `docs/developer_guide/testing.md` | Adapter tests | Current/later | Preserves real malformed and edge-case payloads | Existing TypeScript fixture conventions remain | Malformed inputs fail closed and atomically | **Adopt pattern** |
| Generated-artifact drift checks | Generated denial-code block in `docs/concepts/execution.md`; generator tests | Contract/channel and documentation generators if introduced | Later | Keeps derived docs and schemas synchronized | No generator is warranted for the current small contract | Generated outputs must be changed only through their source | **Defer until needed** |

## Benchmark-gated direct Rust reuse

TypeScript remains the authoritative application and domain runtime. Direct local Rust reuse is an
exception for a pure batch kernel, not permission to add a Rust service or transplant Nautilus's
runtime. The first candidate is repeated registered backtest/replay work; reconciliation campaign
replay may be evaluated in P6. Portfolio reads, allocation validation, messages, lifecycle, and
scheduling remain TypeScript. Tick/order-book matching remains rejected because it is outside the
daily-bar, paper-only product.

A candidate must include serialization and native-call overhead in the comparison, preserve exact
golden outputs, decimal behavior, event order, and failures, and repeat deterministically. Adoption
requires at least 3x kernel speed, 2x end-to-end speed, and either one second saved on a representative
registered research batch or removal of a documented product latency violation. A passing kernel is
isolated behind a batch N-API boundary with no disk, network, clock, secrets, UI, or execution
authority and must load and pass parity tests in packaged Windows x64 and macOS arm64 builds. A
failing candidate is ported to TypeScript and adds no native dependency.

The 2026-08-10 Windows comparison is recorded in
`docs/studies/language-runtime-spike-2026-08-10.md`. All three spike implementations produced the
same SHA-256 output hash across 20 repetitions, but Rust reached only 1.43x TypeScript end-to-end
speed and saved 47 ms; Python was 3.37x slower. Neither backend passes the performance gate, and
neither is promoted. The reproducible losing prototypes remain quarantined under
`benchmarks/language-spike`; no production package imports them and no application runtime
dependency was added.

## Bounded P4 adoptions

The implemented P4 foundation consists only of strict command/event envelopes, correlation and
causation identity, injected message time and IDs, and the reduced Coqui lifecycle state machine.
The second adoption adds exact per-instrument spot observations, source/quality-preserving fallback,
non-venue rebalance blocking, and immutable allocation-policy validation with deterministic
path/code issues before atomic persistence. It does not add carried prices, a dispatcher, scheduler,
IPC surface, `CoquiClient`, message broker, native kernel, or execution behavior.

The third bounded adoption adds append-only daily portfolio evidence with separate scheduled,
observed, and recorded times; explicit complete, partial, unavailable, and legacy-unverified
valuation states; canonical unpriced-instrument metadata; and bounded reads over untruncated stored
history. Only complete daily equity enters performance calculations. It still adds no carried-price
policy, scheduler, IPC surface, UI, native production kernel, or execution behavior.

The fourth bounded adoption adds a host-driven UTC scheduler boundary over Coqui's existing durable
per-wallet leases. It adapts scheduled-versus-executed time, injected clocks, deterministic due
ordering, idempotent expired-lease finalization, owner-bound completion, explicit cancellation, and
bounded concurrency two. Scheduling policy is immutable after creation and failure evidence is
limited to stable reason codes and low-cardinality outcome metrics. The scheduler never reads the
keychain and has no network, IPC, UI, strategy, live execution, synthetic fill, message-bus, timer,
or global-registry authority; the desktop composition root will own the eventual single wake-up
mechanism.

The scheduler adoption also includes a bounded, immutable automation-status read model. It
classifies current, overdue, stopped, failed, disabled, and expired-lease states from injected time
without finalizing a timer during a read. Lease owners and credentials are omitted, active expiry is
shown only while authoritative, and any legacy free-form failure is reduced to a stable unverified
reason code. This is service evidence only; no IPC channel or renderer surface was added.

The fifth bounded P4 adoption applies immutable report and provenance patterns to the first risk
service use case. Reality-check facts are validated as one deterministic multi-error set before the
injected clock is read. Returned notices are stable codes rather than copied diagnostics or prose,
and an assessment hash binds the source-evidence hash, all validated facts, time, and outcome. The
report always denies live-execution authority. Evidence tracking, long-term regime assessment,
contracts/IPC, strategy defaults, and order behavior remain outside this slice.

The sixth bounded P4 adoption adds an immutable evidence-tracker report over Coqui's own append-only
trial and research records. It fails closed on incomplete trial history, content-hash failure,
trial-registry mismatch, unknown schema, or contradictory gate facts. Only a strict versioned
snapshot can expose numeric gate evidence, and each figure shares exact dataset, cost,
pre-registration, code, trial-registry, and snapshot provenance. Passing every gate permits human
review only; it never enables live execution. No Nautilus registry, analyzer, message bus, UI, or
execution machinery was copied.

The seventh bounded P4 adoption completes the risk-service boundary with a provenance-bound
long-term assessment. It requires explicit parameters rather than adopting defaults, accepts only
strictly ordered completed Coinbase venue observations, and hashes the input series and parameter
set alongside the upstream dataset identity. Free-form rationale is reduced to stable assessment
codes, while reference prices, future/incomplete bars, implicit sentiment, order intents, and live
permission are rejected. This adapts immutable report/provenance discipline without copying a
Nautilus strategy registry or execution path.

The eighth bounded P4 adoption applies append-only evidence and validation-before-mutation to alert
state. Typed profile policy and canonical decimal price targets replace mutable JSON blobs; target
removal is a tombstone. Stable, evidence-hashed alert facts are immutable and deduplicated, while
read/archive state lives in a separate mutable presentation table. This preserves replayable facts
without adopting a message bus, timer registry, free-form diagnostics, native notification I/O,
paper execution, or silent action behavior.

The ninth bounded P4 adoption applies immutable report, provenance, bounded-query, and
validation-before-mutation patterns to Coinbase account evidence. Complete bounded cursor walks are
normalized into exact account/fill facts with provider event time separated from injected local
request/receipt time. Deterministic directional balance discrepancies remain unresolved evidence;
the service never carries prices, manufactures fills or lots, resizes accounting history, or silently
self-heals. Provider dataset hashes and origin-profile provenance survive isolated profile copies.
This adapts the local Nautilus evidence discipline without adopting its bus, registries, OMS,
reconciliation orders, tick engine, or execution authority.

The tenth bounded P4 adoption separates mutable user presentation preference from immutable research
and provenance evidence. A profile's ordered display universe contains only canonical Coinbase spot
identities retained from a bounded provider catalog; real replacements append immutable origin events,
while point-in-time research snapshots remain byte-for-byte unchanged. Unknown identities, duplicate
selection, malformed provider metadata, oversized reads, cancellation, and provider failures all fail
with stable outcomes. This adapts configuration/evidence separation without adopting a registry,
message bus, dynamic strategy universe, or live execution path.

The eleventh bounded P4 adoption replaces a permissive cross-domain settings blob with immutable
typed account-presentation views and validation-before-mutation. Stable path issues collect every
invalid patch field, while a valid partial patch becomes one complete transactional row. Financial,
tax, provider, strategy, venue-cost, and advisor policy cannot cross this boundary. This adapts the
local configuration-error collector and immutable validated-configuration patterns without adopting
global registries, free-form values, hidden clamping, or runtime strategy mutation.
