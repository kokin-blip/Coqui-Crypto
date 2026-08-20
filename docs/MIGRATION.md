# MIGRATION

**Single source of truth for what moves where.** If you are porting a module,
this is the only file you need besides the predecessor source.

Predecessor: `kokin-trading-framework` @ branch **`main`** (not `pivot/kokintrader`
— that branch is stale and contains a look-ahead bug that `main` already fixed).
Clone it locally; paths below are relative to its root.

**Default decision is COPY.** Read the predecessor file, move it, fix import
paths, move its tests. Do not reimplement from these descriptions.

The user's personal rebuilt NautilusTrader fork is a separate, owner-authorized
design reference, not the predecessor migration source. Its read-only concept audit
and Coqui adoption decisions are recorded in
[`nautilus-adoption-matrix.md`](nautilus-adoption-matrix.md). That matrix does not
override Coqui's stack, scope, safety invariants, or copy-first predecessor rules.
Its fourth bounded P4 adoption is now implemented as a host-driven scheduler over durable Coqui
leases: UTC cadence, injected time, concurrency two, cancellation, and expired-lease recovery were
adapted without copying a message bus, timer registry, keychain access, or execution behavior.
Migration 40 similarly replaces predecessor alert JSON with typed profile policy, tombstoned
canonical targets, immutable evidence facts, and separate read/archive presentation state; no
predecessor timer or native notification behavior is copied.
Migration 41 stores only a profile-scoped, allowlisted advisor model policy. Gemini credential
material remains exclusively in the injected secret-store adapter, with the predecessor's main
keyring account preserved and additional profiles isolated by scope. Advisor conversation, TTS,
social data, IPC, and execution authority are not copied into the P4 connection boundary.
The first accounts slice keeps the predecessor's version-1 `wallet-profiles.json` compatibility but
replaces permissive loading with strict validation, revision-checked atomic writes, injected IDs and
time, and database provisioning before manifest publication. Only secret-free display metadata is
returned. Context switching, credential copying, and destructive profile deletion remain deferred
to their explicitly bounded follow-up slices.
Profile switching is now a two-phase service contract: prepare and migrate the target while the old
context remains active, publish the revision-checked durable selection, then atomically commit the
prepared context. Safe commit refusal rolls the manifest back; ambiguous commit failure requires
restart recovery and never guesses. Electron lifecycle wiring remains a P5 composition-root task.
Deletion preview is now an independent read-only accounts use case. It counts durable evidence by
category and checks credential presence without reading secret values into the service. Incomplete
inspection, active/last profile state, or evidence without a recoverable backup blocks eligibility.
The recoverable-backup prerequisite is now a separate accounts operation over inactive, non-last
profiles. It creates a consistent SQLite `VACUUM INTO` artifact, a strict versioned manifest,
database and manifest SHA-256 checksums, schema/integrity verification, bounded impact counts, and
credential-category metadata while explicitly excluding credential values. Creation is serialized
with profile switching and changes neither the source database nor global manifest. The
predecessor's direct remove path is not copied. Confirmed deletion now requires a fresh verified
backup even for an otherwise empty profile. The exact confirmation binds profile and backup UUID;
the service rechecks manifest revision, bounded evidence counts, and credential categories before
writing a durable deletion journal. Revision-checked manifest removal is the commit point, followed
by idempotent database/WAL and profile-scoped Coinbase/Gemini credential cleanup. Interrupted
cleanup remains visible and resumable; corrupted recovery state fails closed. Restore remains a
separate future operation.
Profile duplication keeps the predecessor's consistent SQLite-backup concept but deliberately
removes its `copyCredentials` option. Coqui dynamically rewrites every explicit `profile_id` column,
rejects cross-profile contamination, clears legacy Coinbase/Gemini connection and sync markers,
and excludes scheduler leases plus unfinished Coinbase staging jobs. Completed local facts remain in
the isolated clone. The source database, source credentials, and source manifest record are
unchanged; the new manifest record contains neither credential material nor provider fingerprints.
Revision conflict cleanup first proves the target database is unreferenced, avoiding cross-process
deletion of a newly published profile.
Profile comparison replaces the predecessor's sequential per-wallet network pricing, binary-float
totals, ambient `Date.now`, and missing-database zero fabrication. Coqui captures bounded detached
facts with injected time and four-way read concurrency, then prices the union of canonical
instruments once. Exact tracked and paper values distinguish priced subtotal from complete equity,
carry source/quality counts and canonical unpriced identities, and expose per-profile unavailable
states without leaking filenames, credentials, fingerprints, rows, or diagnostics.
Profile dashboard adapts the predecessor summary instead of copying its ambient time, binary-float
totals, raw warning/error text, missing-database zero fallbacks, and credential-marker assumptions.
Coqui composes the comparison result with bounded isolated status reads, injected-clock freshness,
stable warning codes, and sanitized automation/risk/safety evidence. Invalid or unavailable status
remains explicit, and incomplete tracked or paper valuation makes the corresponding aggregate total
null rather than overstating a priced subtotal as complete equity.
All-profile refresh replaces the predecessor's serial loop, raw credential/provider error strings,
ambient time, and command-plus-dashboard coupling. Coqui snapshots ordered profile metadata, uses
one injected request time, and invokes a narrow authenticated-acquisition boundary with four-way
bounded concurrency and caller cancellation. The accounts result copies no database filename,
credential, response, or diagnostic data: it contains only profile display identity, terminal
status, bounded evidence count, and an allowlisted reason code. Dashboard retrieval remains a
separate query, and this accounts slice adds no scheduler, IPC, execution, or tax-lot authority.
Coinbase connection replaces the predecessor's raw authentication messages and database credential
markers with one profile-scoped, secret-safe service. Direct credentials and bounded key-file JSON
both pass canonical ES256 validation and the same authenticated view-only probe. In addition to
Trade and Transfer, Coqui rejects Coinbase's separately documented Receive permission. Only hashed
key/portfolio identities enter the manifest, where they prevent duplicate assignment across
profiles; private material remains in the OS secret store. Revision conflict restores the prior
scoped secret, and a failed restore becomes explicit recovery-required state. Disconnect clears only
that profile's Coinbase secret and identity markers and never deletes imported or portfolio evidence.
Coinbase synchronization ports only the predecessor's bounded account/fill fetching. Cursor pages,
normalized exact-decimal facts, provider times, local request/receipt times, and deterministic dataset
hashes are appended through migration 42. Local remaining lots are read only to produce directional
balance discrepancies. The predecessor's zero-cost lot synthesis, proportional lot resizing, staged
promotion, and import deletion/replacement behavior are rejected. Duplicate profile databases retain
the immutable origin profile as provenance; a later sync appends facts for the new profile rather than
rewriting copied history. `COINBASE_SYNC` is now the authenticated executor behind the existing
four-way profile refresh boundary, while IPC and scheduler ownership remain deferred.
Migration 43 replaces the predecessor's mutable `tracked_coins` JSON and silent default fallback
with an explicit ordered profile display universe. Only normalized Coinbase USD spot identities
observed through the bounded public catalog can be selected; search/page observations retain a
verified Coinbase provider mapping. Replacements are atomic, allow an intentional empty set, reject
unknown or duplicate identities, and append immutable origin provenance. Profile duplication rewrites
the current preference while preserving the source origin on historical events. This state never
writes `universe_snapshots` or changes research membership. The similarly named predecessor
`WATCHLIST_*` surface is not part of coin selection: it concerns attributed public chain addresses
and remains separate until observation and unverified-attribution provenance are implemented.
Migration 44 replaces the predecessor's permissive all-domain `user_settings` JSON merge with an
accounts-owned presentation schema. Only theme, density, motion, and language are available through
`SETTINGS_GET/SET`; default-versus-saved provenance is explicit. Unknown fields and predecessor cost
basis, rebalance, pricing-provider, cash-yield, tax-rate, venue-cost, strategy, and advisor fields are
rejected rather than ignored, clamped, or written through a generic key. Valid partial patches are
merged with the current complete row inside one transaction. Other domains must expose their own
typed policy service, and the unvalidated strategy defaults remain untouched.

---

## 1. Copy verbatim — no behaviour change

These are correct. Move them, adjust imports, keep the tests. **Do not "improve"
anything in this list**; several encode deliberate pessimism or safety.

### Engine and statistics → `packages/core`

| Predecessor path | Destination | Note |
|---|---|---|
| `src/core/execution/significance.ts` | `core/src/significance/` | PSR, DSR, expected-max-Sharpe. Self-contained `erf` + Acklam inverse-normal |
| `src/core/execution/walk-forward.ts` | `core/src/validation/` | Expanding-window OOS with oracle bound. See §3 for the one change |
| `src/core/execution/monte-carlo.ts` | `core/src/validation/` | Seeded PRNG, stationary bootstrap |
| `src/core/execution/ml-purged-cv.ts` | `core/src/validation/` | Purged cross-validation |
| `src/core/execution/trade-costs.ts` | `core/src/costs/` | Venue-accurate. **Pessimism is load-bearing** |
| `src/core/execution/market-bars.ts` | `core/src/market/` | Timestamped, provenanced, completeness-flagged bars |
| `src/core/execution/risk-controls.ts` | `core/src/risk/` | 4-stage ladder, expected shortfall, execution policy |
| `src/core/execution/realism.ts` | `core/src/risk/` | Venue profile, profitability gate, evidence thresholds |
| `src/core/execution/autotrade.ts` | `core/src/risk/` | Guardrails + `canExecute`. **Safety-critical** |
| `src/core/execution/evidence.ts` | `core/src/evidence/` | Gate checklist |
| `src/core/execution/paper-orders.ts` | `core/src/paper/` | Durable order/fill state machine |
| `src/core/execution/portfolio-sizing.ts` | `core/src/risk/` | Size-tier policy |
| `src/core/execution/buy-candidates.ts` | `core/src/strategies/` | Candidate scoring overlay |
| `src/core/execution/reality-check.ts` | `core/src/evidence/` | User-facing sanity notices |
| `src/core/execution/action-notices.ts` | `core/src/evidence/` | Reason codes → copy |
| `src/core/types/*` | `core/src/types/` | **Treat doc comments as the spec.** Preserve them |
| `src/core/portfolio/*` (13 files) | `core/src/portfolio/` | Cost basis FIFO/LIFO/HIFO/avg, holdings, allocation, rebalance, tax, harvest |
| `src/core/market/longterm.ts` | `core/src/indicators/` | Pure — belongs in core, not adapters |
| `src/core/market/indicators.ts` | `core/src/indicators/` | Merge the duplicate `rsi` export while moving |
| `src/core/cache/`, `concurrency/`, `crypto/sha256.ts` | `core/src/` | |

### I/O → `packages/adapters`

| Predecessor path | Destination | Note |
|---|---|---|
| `src/core/http/*` | `adapters/src/http/` | Rate limiter, `Retry-After`, `HttpResult<T>` never throws. Configure to the **most conservative** published Coinbase limits — sources disagree; verify against live docs before raising |
| `src/core/secrets/` | `adapters/src/secrets/` | See §4 for the one decision |
| `src/core/market/coinbase.ts` | `adapters/src/coinbase/` | Public REST |
| `src/core/market/coinbase-account.ts` | `adapters/src/coinbase/` | Accounts + fills, cursor-paginated. **Port the fetching only — not the fill-to-lot reconciliation (S2)** |
| `src/core/market/coinbase-market-quality.ts` | `adapters/src/coinbase/` | Spread/depth/liquidity scoring |
| `src/app/main/coinbase-{connect,probe,status}.ts` | `services/accounts/` | **Preserve the trade/transfer permission rejection verbatim** |
| `src/core/market/adapters.ts` | `adapters/src/` | `PriceSource` / `AssetCatalog` composition |
| `src/core/market/coingecko-*.ts` | `adapters/src/coingecko/` | Canonical-id joins already fixed on `main` |
| `src/core/market/{feargreed,yields,unlocks,news,watchlist,wallet-account,prices,markets}.ts` | `adapters/src/` (`watchlist` → `services/portfolio/`) | Free/keyless. Strip memecoin prose from `prices.ts`, keep the exclusion logic. Keep `news.ts`'s "never signal" framing |
| `src/core/market/dca.ts` | `core/src/portfolio/` | Label honestly: behavioural, not alpha |

### Storage, shell, tooling

| Predecessor path | Destination | Note |
|---|---|---|
| `src/core/storage/migrations.ts` | `storage/src/migrations/` | **Port at current numbering. Never renumber.** An existing predecessor DB must open unmodified |
| `src/core/wallets/*` | `services/accounts/` | Per-wallet DB contexts, manifest |
| `src/core/research/python-toolchain.ts` | `services/research/` | Schema-versioned JSON contract |
| `src/app/main/research-worker*.ts` | `services/research/` | `worker_threads` job execution |
| `src/app/main/index.ts` window + security block | `apps/desktop/src/main/` | **CSP, `sandbox: true`, `will-navigate` block, window-open deny, permission deny-all. All correct today — copy exactly, then add the presence tests it never had** |
| `src/app/renderer/index.html` CSP meta | `apps/desktop/src/renderer/index.html` | Includes `connect-src 'none'` — preserve |
| `src/app/renderer/src/help.ts` | `apps/desktop/src/renderer/` | ~335 lines of explanatory copy. Real work — port, don't rewrite |
| `tests/*` | Co-located per package | ~75 files, ~598 cases |
| `tests/fixtures/golden-backtest-v2.json` | `fixtures/` | **The proof gate for the whole migration** |
| `research/python/*` | `research/python/coqui_research/` | Rename package, pin versions |
| `scripts/{research-export,research-python,research-setup,cdp}.*` | `scripts/` | `cdp.mjs` is a useful UI-verification pattern |
| `build/afterPackHardening.cjs`, `afterSignAdHoc.cjs` | `apps/desktop/build/` | Keep until real signing exists |

## 1a. Corrections from the second audit

### Required type corrections

The predecessor's `src/core/types/portfolio.ts` cannot be copied byte-for-byte:

- `AssetRef.id` is a display/base symbol, but Coqui identifies instruments by
  `(venue, product_id, product_type)`.
- Ledger quantities and USD amounts are binary `number`, but Coqui requires
  decimal or fixed-point representations for lots, balances, orders, and fills.

The Phase 1 type transplant preserves the domain structure while replacing
those fields with `InstrumentIdentity` and validated branded decimal strings.
This is an invariant-driven migration correction, not a behavior rewrite.

The predecessor's `paper-orders.ts` also contains an older number-valued order
API beside its v3 decimal OMS. Phase 1 migrates only the v3 state machine,
removes the duplicate float API, and replaces `productId`/`canonicalAssetId`
joins with `InstrumentIdentity`/`InstrumentKey`. Transition, normalization,
execution-price, and balanced-ledger behavior are preserved. This is required by
invariants 11, 13, and 15; retaining both APIs would create two OMS paths.

The predecessor cache and semaphore wrap `lru-cache` and `p-limit`. Phase 1
preserves their LRU/TTL and FIFO-concurrency behavior with small local
implementations so Decimal remains core's only runtime dependency. Cache time is
injected through `Clock`, making expiry deterministic and satisfying the core
time boundary.

The predecessor HTTP client acquires a rate-limit token once per logical call,
so its retries bypass the host budget, and it retries generic JSON `POST`
requests after transient failures. Phase 2 instead acquires before every network
attempt and automatically retries only idempotent reads. It also makes the
rate-limited client the sole exported construction path rather than retaining an
optional unthrottled composition. Typed failure, timeout, bounded `Retry-After`,
trace-ID, and response-parsing behavior are preserved and hardened to cover
invalid URLs and request serialization.

The predecessor Coinbase public adapter keys price maps by display/base symbol,
converts quoted spot prices to binary numbers, silently maps unknown candle
timeframes to daily, and deduplicates catalog rows by base symbol. Phase 2 keys
decimal spot values and catalog rows by `InstrumentIdentity`, rejects unknown
timeframes, and preserves distinct product IDs even when display symbols
collide. Daily pagination otherwise retains the predecessor behavior, with
malformed pages rejected atomically and completed-bar status made explicit.

The predecessor Coinbase signer accepts Ed25519 and ECDSA keys and signs a
throwaway validation string after parsing. Current Coinbase App documentation
requires ECDSA P-256 / ES256 and explicitly rejects Ed25519 for this product.
Phase 2 therefore detects the algorithm from key metadata without a validation
signature and rejects Ed25519 locally with a secret-safe error. The authenticated
client is GET-only, binds a fresh JWT to every network attempt, and refuses any
destination outside the exact HTTPS Coinbase App host. The permission probe also
fails closed on missing boolean flags rather than treating an omitted Trade or
Transfer field as false.

The predecessor secret store dynamically loads archived `keytar`, accepts raw
backend error messages as result text, and reads the active-wallet callback
separately for cache and backend lookup. Phase 2 uses pinned
`@napi-rs/keyring` 1.3.0 through its asynchronous keytar-compatible facade,
preserving the same OS service/account entries. Calls take an explicit wallet
scope, eliminating wallet-switch races. Native failures become stable typed
errors, invalid values are rejected before the backend, and unavailable secure
storage has no plaintext, file, SQLite, or `safeStorage` fallback.

The predecessor CoinGecko price fallback returns binary numbers and its market
enrichment still contains a conditional symbol join. Phase 2 resolves
CoinGecko only through each canonical asset's explicit `coingeckoId`, keys
results by `InstrumentKey`, converts spot and USD metadata to decimal strings,
and batches provider IDs. Current CoinGecko documentation also makes the
keyless public allowance dynamic and positions it for light use, so the retained
30-request/minute limiter is a local ceiling backed by 429 retry handling, not a
guaranteed allowance or production availability claim.

The owner-requested provider evaluation also adds CoinMarketCap Basic and
CoinPaprika Free beside CoinGecko Demo. These adapters have no predecessor
source to copy. They remain reference data, require explicit provider IDs, and
are documented in `docs/studies/provider-comparison-2026-08-02.md`.

The predecessor's 28 migrations are copied verbatim at versions 1–28. The only
structural change is a mechanical split into `v1-v8.ts`, `v9-v17.ts`,
`v18-v23.ts`, and `v24-v28.ts` to satisfy the 500-line rule. The database handle
type changes from `better-sqlite3` to the minimal `exec` surface shared by
`node:sqlite`; migration SQL and behavior are unchanged. ADR-0003 records why
this is a binding substitution rather than a migration rewrite.

Coqui-native migrations 29–34 are forward-only corrections layered after the
unchanged predecessor history. They add exact-decimal canonical portfolio
tables, quarantine non-canonical legacy market rows, add an instrument/provider
registry for Coinbase, CoinGecko, CoinMarketCap, and CoinPaprika, and replace
REAL-valued wallet risk peaks with decimal text. Legacy rows are never guessed
into the new schema: each unsafe conversion is recorded in a migration-exception
table for explicit review.

Migration 33 adds immutable full-product Coinbase observations for N3. These
snapshots provide forward point-in-time universe coverage only. The current
catalog is never projected into historical dates, and an absent daily snapshot
remains an uncovered research day rather than silently carrying membership.

Migration 34 adds bounded local operational metric observations for N6. The
repository applies configurable retention on insert (90 days by default), caps
diagnostic reads, and stores only validated low-cardinality labels. See
`docs/studies/operational-metrics-2026-08-04.md`.

The predecessor's ~2,500-line storage facade is split into domain repositories,
all below 400 lines. The migrated surface includes settings, portfolio,
market-data, evidence, research, wallet scheduling/risk, append-only audits,
canonical provider mappings, and fill-driven paper V3 execution. Float-valued
paper V1/V2 functions are omitted. Staged Coinbase import promotion and lot
reconciliation are also omitted: that implementation can synthesize or resize
tax lots, so Phase 7 must rebuild it around an explicit discrepancy ledger.

The predecessor CSV parser emits symbol-only, number-valued trades and silently
applies `Math.abs` to negative quantities and USD values. The migrated parser
requires an explicit symbol-to-`InstrumentIdentity` resolver, emits validated
decimal strings, and rejects negative rows. It remains a parser only: it does
not create lots, infer cost basis, or reconcile balances.

The predecessor `longterm.ts` combines the assessment with a second standalone
backtest that signals and fills on the same close and accepts a private
commission override. Phase 1 migrates the assessment plus a typed evaluator
adapter into the shared backtest engine; the duplicate simulator is deliberately
not migrated. The shared engine owns next-interval execution and venue costs.

An independent audit (`docs/audit/second-audit-2026-08-01.md`) verified the
predecessor separately and found items this matrix originally missed. All are
stack-independent. Treat them as binding.

| # | Finding | Consequence for migration |
|---|---|---|
| S1 | **`scripts/research-deep.mts` passes `commissionPct: 0.1`** — 10bps — while the application default is 60 fee + 10 spread + 15 slippage = **85bps** | The sweeps that selected the shipped defaults may have modelled one-eighth the real friction. This compounds §2. Phase 3 must re-run under a single cost model, and one cost profile must be the only source (`CLAUDE.md` invariant 14) |
| S2 | **`coinbase-account.ts` fill replay creates zero-cost lots** for unexplained positive balances and **proportionally rescales lots** when live balances are lower | **Do not port the reconciliation implementation.** Rebuild as an explicit ledger with transfers, rewards, adjustments, and *unresolved exceptions*. Tax exports stay labelled estimates. This is `CLAUDE.md` invariant 12 |
| S3 | **Walk-forward selects among already-defined tracks** — it does not nest parameter selection, purge overlapping label horizons, or model research iteration | R1 and Phase 3 need nested chronological validation plus CSCV/PBO, not just more folds. It answers "did leader-chasing help", not "was the final default chosen out of sample" |
| S4 | **PSR/DSR test Sharpe against zero and search luck; the product claim is excess after costs versus hold and passive** | Add benchmark-relative bootstrap/permutation tests with confidence intervals alongside the existing significance report |
| S5 | **A generic navigation helper still opens arbitrary `http:`/`https:` destinations** even on `main` | When porting the hardening (§1), restrict schemes to HTTPS and add an explicit domain allowlist. Treat `shell.openExternal` input as untrusted |
| S6 | **GitHub Actions use movable tags, not commit SHAs**; `hardenedRuntime: false`; no PR CI, SAST, SBOM, licence or secret-scan gate | Pin actions by SHA in Phase 0. The CI gaps are already Phase 0 work |
| S7 | **Coinbase's Advanced Trade sandbox returns static predefined responses** and needs no authentication | Useful only for contract parsing. It cannot validate fills, latency, rejection, or matching. The deterministic simulator is not optional |
| S8 | Coinbase channels close after 60–90s without updates unless heartbeats are subscribed; Level 2 quantity is a replacement value and zero removes a level | Relevant only if WebSocket feeds are ever added. On a sequence gap: mark the book invalid, resnapshot, replay. Never silently continue |
| S9 | **Test suite state, now verified** | 434 pass, 15 fail — all four failures are SQLite suites unable to load a `better-sqlite3` native binary in a sandbox, not application defects. `pnpm typecheck` and `pnpm lint` pass. `CLAUDE.md` §6's "test suite never executed" caveat is resolved |

### Design concepts to adopt regardless of stack

The second audit is right about these and they are additive, not conflicting:

- **One OMS state machine shared by paper and any future live path.** Not two implementations that drift. R3 already consolidates the simulators; make the resulting machine the one live would use.
- **Double-entry position and cash ledger.** Every order-state mutation and ledger posting inside a single transaction.
- **Immutable dataset snapshots with run manifests** — raw inputs, code revision, dependency versions, machine-readable results committed together. A dataset hash without the durable dataset is not reproducibility (extends N7).
- **Trial counts include human-guided iterations and feature screens**, not only displayed finalists (extends N2).
- **Point-in-time universe must precede any rotation work** (already N3; rotation stays deferred until it exists).

## 2. Copy, then re-derive the parameters

The code is sound. The **shipped default constants** were selected through many
searches in `scripts/research-deep.mts` whose trial counts never reached the
significance calculation. A 2026-08-04 source-and-history audit re-derived 178
unique code-visible strategy candidates, not a defensible exact lifetime total:
the script itself refers to an earlier rotation round and private vault notes
that are absent from Git. They are registered as a known lower bound, so DSR
stays unavailable until the audit is complete. Port the code with parameters
unchanged, then re-derive in Phase 3.

| Predecessor path | Destination | Provenance to preserve |
|---|---|---|
| `src/core/execution/momentum.ts` | `core/src/strategies/` | Keep the comment block above `DEFAULT_MOMENTUM_CONFIG` — it is the evidence trail for the TrialRegistry |
| `src/core/execution/vol-target.ts` | `core/src/strategies/` | Same, above `DEFAULT_VOL_TARGET_CONFIG` |

Do not mark the pending re-derivation with a `TODO`. Reference the Phase 3 work
item instead.

## 3. Refactor while moving

| # | Predecessor path | Destination | Required change |
|---|---|---|---|
| R1 | `src/core/execution/strategy-backtest.ts` | `core/src/backtest/` | Four changes, each a separate commit: **(a)** fix the Sharpe/Sortino basis mismatch — Sharpe uses the arithmetic mean of daily returns, Sortino uses geometric annualised return ÷ downside deviation, so the ratios are not comparable, and strategy selection ranks on one while significance ranks on the other; **(b)** accept an injected `Clock`; **(c)** absorb rotation as a seventh track (see R2); **(d)** read trial counts from TrialRegistry and remove the zero-padding hack in `computeSignificance` |
| R2 | `src/core/execution/rotation.ts` | `core/src/strategies/` | **Delete `backtestRotation`.** Verified: it has no `executionPrices` and still fills at the same bar its signal observed — the exact look-ahead defect that was fixed in the shared engine. Express rotation as a track in R1. **Any rotation result produced before this is invalid** |
| R3 | `src/core/execution/paper-{account,wallet}.ts` | `core/src/paper/` | Two overlapping simulators. Consolidate onto the `paper-orders.ts` state machine; delete the superseded one |
| R4 | `src/core/execution/simulation-lab.ts` | `core/src/validation/` | ~879 lines. Split into scenario definitions + runner |
| R5 | `src/core/storage/index.ts` | `storage/src/repositories/` | ~2,500 lines that nearly every service reaches through. Split by domain: lots, disposals, orders, fills, journal, evidence, research jobs, wallets, settings, alerts. Max 400 lines each. **If this moves as one file it becomes the new monolith** |
| R6 | `src/core/execution/signal-tilt.ts` | `core/src/strategies/` | Seven tunable knobs, three presets, no dedicated study. Reduce the knob count; demote from the default decision path until it has its own pre-registered study |
| R7 | `src/core/execution/{multi-cycle-research,research-inbox,research.ts}` | `services/research/` | Three overlapping research surfaces. Fold `research.ts` into `multi-cycle-research`. Feed TrialRegistry |
| R8 | `src/core/market/coinbase-auth.ts` | `adapters/src/coinbase/` | CDP JWT signing is correct — keep it. One fix: it signs a throwaway `'probe'` payload just to derive `alg`. Detect key type from format instead |
| R9 | `src/core/alerts/` | `core/src/` + `services/alerts/` | Split pure rules from dispatch |
| R10 | `src/core/portfolio/import-csv.ts` | `services/portfolio/` | Reconciliation must raise explicit exceptions, never invent or rescale lots (S2). **Take the version from branch `pivot/kokintrader` commit `80b5a1b`** — the only work that exists there and not on `main`. Coinbase report parsing, BOM/preamble detection, fee-inclusive totals, duplicate-import fingerprints |
| R11 | `src/core/market/{feargreed,yields,news}.ts` + `fetchTrending` in `src/core/market/markets.ts` | `adapters/src/reference/` | **Completed 2026-08-20.** Parse, selection, and filtering logic copied unchanged: alternative.me's published bands, DefiLlama's single-asset regex + $1M TVL floor + best-APY-wins, the RSS/Atom extractor, and the Federal Register title-must-match precision rule. **One deliberate contract change:** each predecessor function degraded to `null`, `[]`, or `{}` on every error, which made "provider down", "payload malformed", and "genuinely nothing to report" indistinguishable at the UI — the display rows require stable failures, so all four now return a typed `ReferenceResult` carrying a `ReferenceFailureCode`. Multi-feed calls additionally fail only when *every* feed failed, so one broken publisher degrades the view instead of blanking it. Hardening added at the untrusted boundary: HTTPS-only links, title and payload size caps, and no fabricated observation time when a feed omits one |

## 4. Decisions needed before porting

| Item | Decision | Record in |
|---|---|---|
| Keychain service string | Predecessor uses `KEYCHAIN_SERVICE = 'kokincrypto'` with wallet-scoped accounts (`${key}:${walletId}`). Keeping it preserves existing installs' stored keys; changing to `'coqui'` costs one re-entry. Either is fine — decide once | `docs/adr/` |
| `better-sqlite3` vs `node:sqlite` | Node 22+ ships SQLite built in. Adopting it removes a native dependency and the Electron/Node ABI rebuild friction. Evaluate during Phase 2 | `docs/adr/` |
| Advisor mascot subsystem | `SpriteAnim`, `WalkAround`, `BotBuddy`, `sprite-url.ts`, sprite PNGs, `build-advisor-sprites.py`. Real complexity — animation code, packaging quirks, a Python build script — serving a character. Keep only if it is in the new UX | `docs/adr/` |

## 5. Rewrite — read as specification, never copy

| Predecessor path | Destination | Approach |
|---|---|---|
| `src/app/main/index.ts` | `packages/services/*` + `apps/desktop/src/main/` | ~9,900 lines, 140 `ipcMain.handle` registrations, ~331 functions. The read-only [handler inventory](handler-inventory.md) maps all 140 unique channels to one of the ten services before implementation against the new contracts. Target: `apps/desktop/src/main/` under 500 lines, wiring only |
| `src/app/ipc-types.ts` | `packages/contracts/` | ~1,850 lines. Reuse the *shape*; split by domain; add Zod schemas validated in both directions |
| `src/app/preload/index.ts` | `apps/desktop/src/preload/` | Explicit allowlist; validate every payload |
| `src/app/renderer/src/components/*` (~40 files) | `apps/desktop/src/renderer/features/` | **Read for feature inventory only.** No component keeps its `setInterval`. Max 300 lines each — the predecessor's settings panel is ~2,100 |

## 6. New — no predecessor equivalent

| # | Component | Destination | Purpose |
|---|---|---|---|
| N1 | `Clock` | `core/src/time/` | `SystemClock`, `FixedClock` (tests), `ReplayClock` (backtest). Shared timing so backtest and paper cannot diverge |
| N2 | **TrialRegistry** | `core/src/trials/` | Trial-count provenance. Schema in `ARCHITECTURE.md` §5. Without it the deflated Sharpe bar sits far too low |
| N3 | **Point-in-time universe** | `services/market-data/` + `scripts/snapshot-universe.mjs` | Daily `/products` snapshot. Backtests currently draw assets from the user's *current* mix run over history — survivorship bias by construction |
| N4 | **Reconciliation harness** | `services/paper/` | Compare paper fills against backtest assumptions; report divergence in bps and fill-timing terms |
| N5 | Structured logger | `packages/observability/` | Secrets redacted by construction |
| N6 | Metrics | `packages/observability/` | API error rates, data staleness, job durations, scheduler health |
| N7 | Parquet + DuckDB archive | `storage/src/archive/` | Reproducible research over a citable dataset hash |
| N8 | Bulk archive importer | `adapters/src/bulk/` | Free deep history comes from first-party archives. Binance and Kraken are implemented; CryptoDataDownload is cross-check only. Preserve venue identity and verify upstream checksums when the publisher supplies them. See `docs/DATA-SOURCES.md` |
| N9 | Query layer | `apps/desktop/src/renderer/query/` | TanStack Query. Replaces every component timer |
| N10 | `CoquiClient` | `packages/contracts/src/client.ts` | Transport abstraction |
| N11 | Electron hardening tests | `apps/desktop/` | Controls already exist; the tests never did |

## 7. Do not migrate

| Item | Reason |
|---|---|
| Branch `kokinmemecoin` | Retired pump.fun / Solana build. Archive as a tag in the old repo |
| Branch `kokinstocks` | Stale fork, nothing unique |
| `src/core/execution/adaptive-learning.ts` (~960 lines) | Self-tuning parameters = unbounded unregistered search. **Never in the default path.** If ported at all, research sandbox only, behind boundary rule 8, with mandatory trial registration and its own pre-registered study |
| `src/core/execution/ml-{meta-label,logistic,features,labeling}.ts` | Correct methods, insufficient data (~500 daily bars). Research-only; never gates a trade; remove the meta-label card from the default UI. Consider moving entirely to the Python sidecar |
| `src/core/execution/paper-account.ts` | Superseded by `paper-orders.ts` (R3) |
| `backtestRotation` in `rotation.ts` | Duplicate engine with look-ahead (R2) |
| `.agents/skills/*`, `skills-lock.json` | Not application code |
| Obsidian vault as authoritative build log | Move the living log into `docs/`. External authority means project status is invisible to code readers and tooling |
| `scripts/research-deep.mts` (as code) | Keep as `docs/studies/` provenance record instead — it is the evidence for TrialRegistry |

## 8. Order

Each step leaves the repo working.

```
 1. Workspace, boundary rules, CI                              ARCHITECTURE §2–3
 2. core/types → core/time (N1) → core/trials (N2)
 3. core: costs, significance, validation, market-bars         §1
 4. core: risk, guardrails, realism                            §1
 5. core: strategies, parameters unchanged                     §2
 6. backtest engine (R1) — GOLDEN FIXTURE MUST REPRODUCE       ← proof gate
 7. adapters: http, secrets, coinbase, coingecko               §1
 8. storage: migrations unrenumbered, split repositories       §1, R5
 9. core: portfolio engines + CSV import                       §1, R10
10. services: decompose the old main process                   §5
11. contracts + CoquiClient + preload                          §5, N10
12. desktop shell: hardening ported verbatim + query layer      §1, N9, N11
13. UI: scoreboard first, then remaining screens                §5
14. RE-DERIVE STRATEGY DEFAULTS under registered trials         §2 — the point
15. point-in-time universe (N3) + reconciliation harness (N4)
16. observability, archive, Python sidecar                      N5–N8
```

**Step 6 is the proof gate.** If the ported engine cannot reproduce
`golden-backtest-v2.json`, behaviour changed silently. Stop until it does.

**Step 14 is why this project exists.** Everything before it is plumbing.

## 9. Rules for the migration itself

1. Nothing enters `packages/core` that imports Electron, React, or Node I/O.
2. No file over 500 lines survives the move. If it is bigger, it splits now —
   the cheapest moment it will ever be.
3. Every migrated module brings its tests. A module without tests is a rewrite
   candidate, not a copy candidate.
4. The golden fixture passes at every step after step 6.
5. `src/app/main/index.ts` is a specification. Read it; never copy from it.
6. **Do not weaken the cost model, the guardrails, or `canExecute`** — the
   temptation arrives exactly when the numbers look disappointing.
7. If this document contradicts the predecessor source, the source wins. Fix this
   document in the same change.
