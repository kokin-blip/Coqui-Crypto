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

## Follow-up: TLS diagnosis and prepared transport option

Prompt used (selected response): “Live ingestion remains unmet: the naturally due request failed before headers after 10.6 seconds; zero articles retained. Analysis remains disabled. The running dev host preserved the next 07:30 UTC / 00:30 Phoenix slot.” Annotation: “Find a way to fix this”.

On this machine/network, TCP port 443 on the GDELT API host connects, but TLS negotiation stalls with Node's default settings, TLS 1.2 and TLS 1.3, and two independent OpenSSL clients. Coinbase API and GDELT blog TLS controls succeed. Local, Google and Cloudflare DNS agree on the API address. These checks localize the failure to the API TLS path; they do not establish a global outage. Certificate verification remains enabled; no proxy, DNS, IP pinning or system networking change was made. TCP port 80 is reachable, but no HTTP API request has been made and valid HTTP service is not established.

Added bounded native network-cause diagnostics. Only an allowlisted category is stored; native messages, addresses and arbitrary properties are excluded. A credential-free, fixed-host GDELT HTTP transport is prepared behind explicit internal configuration. HTTPS remains the default, with no fallback or additional automatic attempt. Marketaux/Currents retain HTTPS and their existing deadlines. Plain HTTP removes transport encryption and authentication, so Main activation awaits the user's explicit transport decision and successful quota-governed live validation. Official DOC examples recommend HTTPS; this option is not represented as documented HTTP support.

GDELT observations now use strict schema version 2 with immutable `transportProtocol` provenance. Existing version-1 data and hashes remain unchanged. Protocol changes append revisions; repeat receipt times do not. Both versions pass storage, analysis and Parquet round-trip checks. SQLite stays at version 91; no SQL migration or external dependency is needed. Older binaries with version-1-only readers cannot read new version-2 observations: downgrade requires a compatible reader or the established isolated recovery procedure, never removal of immutable fields. A consistent backup before the updated dev host started is `coqui.db.pre-news-observation-v2-1791617160299.bak` (2026-10-10T07:26:00.299Z), alongside Main; `quick_check` returned `ok`.

Only the owned dev host was shut down normally and restarted on the new build. Main remains on HTTPS and analysis remains disabled. Its naturally due 07:30 UTC slot reserved at `2026-10-10T07:30:03.636Z` and failed at `07:30:14.637Z`: headers/network/connection_timeout, elapsed 10,999 ms, HTTP status 0, zero articles. UTC-day accounting is reserved=5/failed=5/succeeded=0, budget=72. The next normal slot is `2026-10-10T08:00:00Z` (01:00 Phoenix). No clock change, forced poll, refund or ownership takeover occurred. Live ingestion and Phase 3 analysis gates remain unmet; registered mappings remain ready.

Verification for this follow-up: `pnpm verify` passed typecheck, lint, 262 files / 1,785 tests and build. After extending the archive fixture, 10 files / 118 targeted tests passed, including golden backtest, boundaries, secret leakage, host/runtime, immutable storage, intelligence and archive checks. No local verification failures remain. Generated manifests retain required source-provenance changes; model/rule parameters and golden behavior were not changed. Synthetic HTTP tests do not constitute live HTTP validation. CI acceptance, human review, merge, release, metered credentials/rights and prospective history remain open.

Allowlisted local evidence: `data/news-validation/4136e6020c07d6947fe8550e6fd6167c49bfadbeab9d8178f2c2704aa53c8b32/report.json`, exact-byte SHA-256 `4136e6020c07d6947fe8550e6fd6167c49bfadbeab9d8178f2c2704aa53c8b32`. The dev host continues normal HTTPS scheduling. To select the prepared mode after approval and validation, use `news:configure --database EXISTING_MAIN_DATABASE --gdelt enabled --gdelt-transport http`, then restart only the owned host normally. Select `https` to restore the secure default. Preserve GDELT attribution and unknown first-page coverage. No metered article retention or trading change was introduced.

## Approved HTTP activation — 07:38 UTC

**Prompt used:** “Implement the workaround its fine.” This supersedes the pending transport decision above. The user approved the GDELT-only workaround with its stated lack of transport authentication/encryption.

Only the owned dev host was stopped normally. Existing backup infrastructure created `coqui.db.pre-http-validation-1791617903879.bak`. One explicit transient HTTP validation request was made through the existing shared quota governor, with retries disabled and article retention disabled. It completed at `2026-10-10T07:38:26.911Z` with HTTP **429**, transport elapsed 2,604 ms. This establishes a received HTTP response, not successful article/schema validation. Zero articles were retained. Request journal ID: `ebff8655-eaba-4191-a5a1-8a292547fa5a`; reserved `1791617904306`, completed `1791617906910`. UTC-day usage moved reserved/failed 5→6; succeeded=0, budget=72. Existing cooldown persisted through `1791617966910`. No retry, refunded attempt or clock change occurred.

Main internal configuration is now `{schemaVersion:1,gdeltEnabled:true,gdeltTransport:"http"}`. The owned dev host restarted normally, preserving the next natural slot `2026-10-10T08:00:00Z` (01:00 Phoenix) and journal/cooldown state. No scheduler poll was forced. Scheduled analysis remains disabled because Main still has zero observations. No metered requests, retention, credentials enrollment or trading changes were made. New installations still default to disabled/HTTPS. The validation CLI now honors the configured protocol on initial creation and reopen rather than silently reverting to HTTPS.

Synthetic activation safeguards: 3 files / 45 provider/runtime/host tests passed. ESLint passed for the modified CLI; its disabled invocation reported disabled and made no network requests. The preceding implementation's full `pnpm verify` passed 1,785 tests; no source algorithm changed in this activation follow-up. Generated manifests remain unchanged. Actual article ingestion, live analysis, exact-revision CI/human review, merge/release and prospective evidence remain open. HTTP 429 is explicitly an unmet ingestion gate.

Allowlisted local activation evidence: `data/news-validation/96989f2e65cfcfd605a1580ed0f9879a92fd38793cb53a4ee66bd2a9c710343c/report.json`, exact-byte SHA-256 `96989f2e65cfcfd605a1580ed0f9879a92fd38793cb53a4ee66bd2a9c710343c`. Future successful articles must retain schema-v2 HTTP provenance. Preserve [GDELT attribution](https://gdeltproject.org/about.html), coverage uncertainty and the documented reader/downgrade limits.
