# News live recovery — 2026-10-10

Branch `codex/news-live-recovery`, stacked on Phase 4 baseline `487431cb04ff93213c065bcd1c412968c3fbd1b4`. This is local implementation and development validation; review, merge and release remain deferred. Cost remains $0.

## Recovery implementation

GDELT query construction uses bare single-word keywords and quoted multiword phrases, with operator injection rejected. This matches the [official DOC API examples](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/); it does not establish the cause of prior timeouts. GDELT alone uses a 30-second header-attempt timeout and 35-second overall deadline. Lower-level network failures may still occur earlier. Metered deadlines remain 10/15 seconds, with existing retry, spacing, quotas and poll cadence unchanged.

The internal transport result optionally carries bounded stage/code/elapsed diagnostics. Latest operational diagnostics use existing app_settings keys `news_transport_diagnostic_v1.<provider>` and `news_ingestion_diagnostic_v1.<provider>`. They distinguish header/body deadline failures, HTTP failures, invalid JSON, response bounds and schema rejection; they are operational status, not immutable article evidence. Raw errors, request URLs, headers, credentials and response bodies are excluded. Existing quota journals and immutable news observations are preserved. No migration, dependency or renderer API was added.

## Reviewed Main registry

Main remains at schema 91; the verified branch requires no further migration. Existing `backupDatabase` created consistent backup `coqui.db.news-recovery-v91-1791614993918.bak` alongside `~/Library/Application Support/@coqui/desktop/coqui.db`; its `PRAGMA quick_check` returned `ok`.

Exactly three Coinbase spot identities were explicitly registered through the existing transactional registry writer, with fresh official public product metadata. All matched their product/base/USD identities, online status and trading-disabled=false. Immutable news analysis remains separate from the existing registry's mapping-event history.

- BTC-USD: received 2026-10-10T06:49:54.614000+00:00, allowlisted metadata SHA-256 `2b31de2ee57ddbb6c96a54bb77c735b93a1c361cd2059bd5ccaa9081b36182ce`.
- ETH-USD: received 2026-10-10T06:49:54.662000+00:00, allowlisted metadata SHA-256 `e0d60a927ebc7f4bfb5a9b76d8f5904177a6fa05ebb720b0437c1a96dccdd1b0`.
- SOL-USD: received 2026-10-10T06:49:54.765000+00:00, allowlisted metadata SHA-256 `d93449cb094ee7b7110592d9e503fb22e07820c770162494e709a3023788f48e`.

Reviewed mapping/registry availability: `2026-10-10T06:49:54.765Z` (1791614994765). The registry read before that time returns no new identities. The mapping has no publisher aliases. No automatic instrument creation or trading/display/research-universe selection was performed. Scheduled analysis remains disabled.

## Actual collection and restart

The dev host used Node 24 and the selected Main database. Only our host was stopped/restarted normally; no competing host ownership was taken.

The preserved natural slot at `2026-10-10T07:00:00Z` dispatched at `07:00:37.707Z`. Its one attempt completed at `07:00:48.313Z` with `network`, HTTP status 0, before response headers. The safe diagnostic reports 10,605 ms. Zero articles were retained. These observations do not isolate DNS, connection, TLS or upstream availability as the root cause, and do not prove that the query fix restores service.

UTC-day accounting moved from reserved=3/failed=3 to reserved=4/failed=4, succeeded=0, budget=72. The next slot is `2026-10-10T07:30:00Z` (00:30 Phoenix). Restart inspection at `07:02:40.234Z` preserved those counts and that slot without another request. No quota reservation was refunded, clock changed or poll forced.

Live Phase 3 analysis and scheduled activation remain gated by successful real ingestion. No empty batch was credited as live validation and no synthetic article was inserted into Main. The reviewed mapping is now ready for a future explicit incremental batch. After real observations arrive, stop our host, run network-free incremental analysis, validate resolution/sentiment/events/clusters/diversity and actual availability, then enable the existing Main-only setting and verify restart.

## Verification and evidence

- Final `pnpm verify`: passed typecheck, lint, 262 test files / 1,773 tests and build.
- Focused transport/runtime: 2 files / 27 tests passed, including slow GDELT responses, unchanged metered deadlines, body stalls, malformed data, shutdown and safe diagnostics. Node timers and monotonic time are controlled in deadline tests.
- Host/intelligence/registry/golden/boundary/secrets: 8 files / 78 tests passed.
- Post-build recovery/golden/boundary/secret checks: 7 files / 58 tests passed.
- Introduced test-clock and unsupported registry-trigger assumptions were corrected; no pre-existing local verification failure remained in the final run.
- Generated study manifests were inspected and retained. Only source provenance hashes changed; research rules, parameters and golden outputs were preserved.
- Local allowlisted evidence report: `data/news-validation/84b2c503e9f3b1ddfab21ece1bdd1a00296514c846af2844ba77c4d031df5bd6/report.json`; SHA-256 of exact report bytes `84b2c503e9f3b1ddfab21ece1bdd1a00296514c846af2844ba77c4d031df5bd6`. Contains registration metadata hashes, backup, journal/schedule snapshots and validation gates, without article bodies or credentials.

## Gates and restrictions

Live ingestion and live analysis remain unmet, and scheduled analysis is disabled. Metered credentials were previously unavailable; this recovery made zero Marketaux/Currents requests and did not enroll credentials. Metered collection, retention and export permissions remain restricted. Human review, exact-revision CI acceptance, merge/release and prospective evidence remain open. Missing or backfilled history cannot satisfy prospective requirements.

News remains research context with unknown first-page coverage; publisher diversity does not establish independent corroboration. Preserve [GDELT Project attribution](https://gdeltproject.org/about.html). The dev host remains running for normal collection; its next preserved slot is stated above. To stop it, use normal application shutdown. Existing schema-91 backup and migration recovery rules apply; no downgrade or direct evidence deletion is attempted.
