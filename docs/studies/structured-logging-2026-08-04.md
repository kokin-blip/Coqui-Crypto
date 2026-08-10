# Structured logging boundary — 2026-08-04

## Outcome

N5 is implemented in `packages/observability`. The package has no runtime
dependencies and exposes a structured logger, an injectable sink, child context,
severity filtering, recursive sanitization, and a no-op logger. The Coinbase
decision-dataset and point-in-time-universe workflows now emit correlated
lifecycle events through this boundary.

The logger is operational telemetry, not an audit ledger. Evidence hashes and
workflow outcomes may be logged, but immutable research manifests and trading
decisions still belong in their dedicated append-only stores.

## Threat model and contract

Diagnostic data is treated as untrusted. Secrets may arrive in an ordinary
string, an object key, a nested provider error, an error cause, an authorization
header, a URL query, or an object with hostile accessors. Before a sink sees an
entry, the logger:

- redacts credential-bearing keys plus headers, bodies, payloads, queries,
  request/response objects, and URLs;
- removes registered exact secret values even when embedded inside other text;
- recognizes authorization schemes, JWT-shaped values, PEM material, URLs, and
  credential assignments in otherwise ordinary strings;
- serializes errors as bounded name/message/cause objects and omits stacks;
- handles cycles, depth, entry count, long strings, accessors, unusual primitive
  values, and unreadable objects without invoking user getters; and
- contains sink and injected-clock failures so logging cannot change workflow
  behavior.

Registered secrets remain defense in depth. Callers must still obey the stronger
rule: do not pass provider request objects, response payloads, raw headers, or
caught authentication errors into telemetry.

## Event vocabulary

| Workflow | Event | Safe context |
|---|---|---|
| Dataset | `market_dataset.sync_started` | asset IDs, requested days, policy |
| Dataset | `market_dataset.fetch_failed` | asset ID, status, reason |
| Dataset | `market_dataset.provider_data_rejected` | asset ID, issue count |
| Dataset | `market_dataset.bars_persisted` | row count |
| Dataset | `market_dataset.alignment_failed` | aligned-day and issue counts |
| Dataset | `market_dataset.insufficient_history` | retained and required counts |
| Dataset | `market_dataset.stale_data` | expected and observed interval bounds |
| Dataset | `market_dataset.sync_succeeded` | counts, bounds, dataset hash |
| Universe | `market_universe.capture_started` | observation time |
| Universe | `market_universe.fetch_failed` | status, reason, retry count |
| Universe | `market_universe.capture_succeeded` | count, effective day, snapshot hash |

Every workflow event inherits a component name and, when supplied by the caller,
a correlation ID. No event contains OHLCV rows or a product-catalog payload.

## Verification

The adversarial tests inspect the final `JSON.stringify` output—not only an
intermediate object—and prove that canary values do not survive through nested
objects, keys, provider errors, causes, authorization strings, URLs, cycles, or
payload-shaped fields. Additional tests cover severity filtering, inherited
correlation context, stable event names, hostile accessors, broken sinks, and
broken clocks. Service tests cover successful correlated dataset events and a
provider exception containing an unregistered canary that is never forwarded to
the logger.

N6 can add counters and duration distributions keyed from this vocabulary. It
must preserve bounded cardinality: hashes and correlation IDs belong in logs,
not metric labels.
