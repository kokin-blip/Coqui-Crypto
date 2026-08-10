# Operational metrics — 2026-08-04

## Outcome

N6 now has a dependency-free recording contract in `packages/observability`, a
local SQLite repository in `packages/storage`, and concrete instrumentation for
the Coinbase decision-dataset and point-in-time-universe workflows.

Metrics survive application restarts. Migration 34 adds
`operational_metric_observations`; each insert transaction also removes rows
older than the configurable retention window, which defaults to 90 days. Reads
are newest-first and capped at 10,000 rows.

## Cardinality and secret boundary

Metric names and labels are deliberately less expressive than logs. Names are
stable lowercase identifiers. A measurement may carry at most eight labels from
the fixed set `component`, `created`, `operation`, `outcome`, `policy`,
`provider`, `reason`, and `status_class`. Values are bounded identifiers.

Instrument IDs, correlation IDs, URLs, request/response data, exception text,
account IDs, and arbitrary provider strings cannot be labels. Registered secret
values cause an observation to be dropped before it reaches the sink. Broken
sinks and clocks are isolated from application control flow.

## Measurements

The implemented market-data workflows record:

- final provider request outcomes and HTTP status class;
- retry counts exposed by failed HTTP results;
- workflow outcomes and duration histograms;
- cached bar count, aligned-day count, and alignment/validation issue count;
- age of the newest retained completed bar;
- universe product count and whether a capture created a new snapshot; and
- uncovered point-in-time universe days during dataset binding.

The metrics intentionally do not label individual instruments. Instrument-level
diagnostics remain in bounded structured logs, where they do not multiply metric
series.

## Deferred wiring

Scheduler health cannot be emitted until the Phase 4 scheduler exists. It will
use the same recorder and SQLite sink rather than introducing a second metrics
system. HTTP successes currently do not expose an internal retry count; failure
retries are recorded. If success-after-retry rates become operationally useful,
extend the HTTP result contract explicitly instead of inferring them.

## Verification

Focused tests cover canonical measurements, one-shot timers, unsafe-label and
secret rejection, sink/clock isolation, SQLite round trips, retention pruning,
migration upgrades, and secret-safe workflow instrumentation.

