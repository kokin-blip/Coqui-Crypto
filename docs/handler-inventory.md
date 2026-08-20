# Predecessor IPC handler inventory

## Audit boundary

This inventory is the Phase 4 decomposition gate required by `docs/MIGRATION.md` §5. It is a
read-only audit of `.migration-source/src/app/main/index.ts` at predecessor commit
`b653abc1922bc2ab3549c5dcfe4a25ab28b6eecc` (source SHA-256
`98d570bbbc372e69afdb46f4e8538b383529fb377f1c220574229caa61d44ca0`). The audit found **140
registrations and 140 unique channel constants** in `registerIpc`, at source lines 9583–9852.

The source tree is user-owned and remains unchanged. A destination names the application service
that owns the use case, not an IPC implementation: services must remain unaware of Electron. A
future desktop handler may perform a narrowly allowed shell action after validating contracts, but
all domain work belongs behind the named service. Composite predecessor handlers must be split at
that boundary rather than recreating the old main-process monolith.

Disposition meanings:

- **Adapt** — retain the capability through strict contracts and the named service.
- **Defer P3/P4/P5/P6** — retain the inventory entry, but do not expose it before that phase's
  safety or evidence gate is complete.
- **Reject** — do not migrate the legacy behavior or provide a compatibility path.

## Service totals

| Destination service | Handlers |
|---|---:|
| `market-data` | 15 |
| `portfolio` | 23 |
| `research` | 26 |
| `paper` | 22 |
| `risk` | 4 |
| `alerts` | 8 |
| `accounts` | 26 |
| `advisor` | 9 |
| `scheduler` | 2 |
| `ingest` | 5 |
| **Total** | **140** |

## Handler catalogue

The line is the first line of the predecessor `ipcMain.handle` registration. Channel constants are
recorded instead of their old string values because the new wire API will use versioned dotted
message types rather than preserve these channels verbatim.

| Source line | Channel constant | Destination | Disposition | Migration contract |
|---:|---|---|---|---|
| 9583 | `MARKET_PRICES` | `market-data` | Adapt | Reference prices only; never splice aggregator prices into Coinbase decision bars. Implemented by `MarketDisplayQueryService.prices`; transport remains deferred. |
| 9584 | `FEAR_GREED` | `market-data` | Adapt | Keyless reference feature with provenance and freshness. Implemented by `MarketDisplayQueryService.fearGreed`; transport remains deferred. |
| 9585 | `COIN_CANDLES` | `market-data` | Adapt | Return canonical, completed, timestamped bars; validate instrument and timeframe. Implemented by `MarketDisplayQueryService.candles`; transport remains deferred. |
| 9588 | `MARKETS` | `market-data` | Adapt | Reference market snapshot with source and observation time. Implemented by `MarketDisplayQueryService.markets`; transport remains deferred. |
| 9589 | `TRENDING` | `market-data` | Adapt | Informational only; never a trading signal. Implemented by `MarketDisplayQueryService.trending`; transport remains deferred. |
| 9590 | `YIELDS` | `market-data` | Adapt | Informational reference data with staleness metadata. Implemented by `MarketDisplayQueryService.yields`; transport remains deferred. |
| 9591 | `DCA_PLAN` | `portfolio` | Adapt | Behavioural contribution plan, explicitly not an alpha claim. |
| 9595 | `CATALOG_SEARCH` | `market-data` | Adapt | Implemented by `DisplayUniverseService.search` over a bounded, cancellable, strictly normalized Coinbase USD spot catalog; returned identities and verified Coinbase mappings are retained without changing research membership. |
| 9596 | `PORTFOLIO_VIEW` | `portfolio` | Adapt | Implemented by `PortfolioReadModelService.portfolioView` with exact valuation, per-holding source/quality provenance, and explicit incomplete pricing. |
| 9597 | `LOT_ADD` | `portfolio` | Adapt | Implemented by `PortfolioLedgerService.addManualTaxLot` with canonical Coinbase identity, exact decimals, injected ID/time, and validation before persistence. |
| 9598 | `ASSET_LOTS` | `portfolio` | Adapt | Implemented by `PortfolioLedgerService.listAssetLots` as a deeply immutable canonical-instrument view. |
| 9599 | `LOT_REMOVE` | `portfolio` | Adapt | Implemented by `PortfolioLedgerService.removeManualTaxLot`; only wholly unconsumed manual lots can be removed. |
| 9600 | `ASSET_REMOVE` | `portfolio` | Adapt | Explicit user mutation; never cascade across wallets. |
| 9601 | `DASHBOARD_MOVERS` | `portfolio` | Adapt | Derived portfolio view; price provenance must remain visible. |
| 9602 | `ALLOCATION_VIEW` | `portfolio` | Adapt | Implemented by `PortfolioReadModelService.allocationView` with exact policy/allocation evidence and fail-closed rebalance availability. |
| 9603 | `ALLOCATION_SAVE_TARGETS` | `portfolio` | Adapt | Implemented by `PortfolioAllocationPolicyService.savePolicy` with deterministic multi-error validation and one atomic replacement. |
| 9606 | `ALLOCATION_SUGGEST` | `portfolio` | Defer P3 | Suggestions cannot imply validated strategy defaults before P3 completes. |
| 9609 | `TAX_VIEW` | `portfolio` | Adapt | Implemented by `PortfolioTaxService.view` as an immutable disposal/summary/year view with no invented basis. |
| 9610 | `RECORD_SALE` | `portfolio` | Adapt | Implemented by `PortfolioTaxService.recordSale` as an atomic exact-decimal disposal against eligible existing lots. |
| 9611 | `DELETE_DISPOSAL` | `portfolio` | Defer P4 | Requires exact consumed-lot provenance; never reconstruct a synthetic replacement lot. |
| 9612 | `HARVEST_VIEW` | `portfolio` | Adapt | Estimate-only view with tax assumptions and price provenance. |
| 9613 | `TAX_EXPORT` | `portfolio` | Defer P5 | Service creates bounded export data; desktop owns the save dialog. |
| 9614 | `COINBASE_STATUS` | `accounts` | Adapt | Implemented as profile-scoped connected/disconnected/attention/unavailable state derived from secret presence and non-secret identity hashes; no credential or provider error object is returned. |
| 9615 | `COINBASE_CONNECT` | `accounts` | Adapt | Implemented with canonical ES256 validation and an authenticated probe requiring View while rejecting Trade, Transfer, and Receive permissions before publication. |
| 9618 | `COINBASE_CONNECT_JSON` | `accounts` | Adapt | Implemented as bounded local key-file parsing followed by the same view-only connection path; credentials remain only in the scoped secret store. |
| 9621 | `COINBASE_CONNECT_FILE` | `accounts` | Defer P5 | Desktop selects a file; service receives validated credential bytes only. |
| 9622 | `COINBASE_SYNC` | `accounts` | Adapt | Implemented by `CoinbaseAccountSyncService` as complete cursor-paginated account/fill evidence with exact normalized values, stable failures, atomic append-only persistence, and no tax-lot, disposal, or execution mutation. |
| 9623 | `COINBASE_IMPORT_DISCREPANCIES` | `accounts` | Adapt | Implemented as deterministic exact-decimal provider-versus-local evidence with immutable origin provenance and bounded reads; discrepancies never synthesize lots, fills, or resolutions. |
| 9626 | `COINBASE_IMPORT_RESOLVE` | `accounts` | Reject | Legacy acceptance promotes adjusted lots; discrepancies must remain explicit. |
| 9630 | `COINBASE_DISCONNECT` | `accounts` | Adapt | Implemented with scoped secret removal, non-secret manifest identity clearing, conflict rollback, and no portfolio-evidence deletion. |
| 9631 | `COINGECKO_STATUS` | `market-data` | Adapt | Optional provider configuration status; never expose the key. |
| 9632 | `COINGECKO_CONNECT` | `market-data` | Adapt | Optional reference-source key only; key remains in the secret adapter. |
| 9633 | `COINGECKO_DISCONNECT` | `market-data` | Adapt | Remove only the optional provider key. |
| 9634 | `COINGECKO_RESEARCH_SYNC` | `market-data` | Adapt | Persist reference features with observation time; never execution prices. |
| 9635 | `RESEARCH_MATRIX_RUN` | `research` | Defer P3 | Replace ad hoc matrices with immutable registered plans. |
| 9638 | `RESEARCH_MATRIX_CANCEL` | `research` | Defer P3 | Cancellation belongs to the registered research job lifecycle. |
| 9639 | `RESEARCH_RUNS` | `research` | Adapt | Return immutable plan, dataset, code, cost, and outcome identities. |
| 9640 | `RESEARCH_JOB_START` | `research` | Defer P3 | Start only a registered plan; never accept an unregistered search payload. |
| 9643 | `RESEARCH_JOB_LIST` | `research` | Adapt | Bounded job summaries with stable status and reason codes. |
| 9644 | `RESEARCH_JOB_GET` | `research` | Adapt | Scoped immutable job evidence; no raw worker errors. |
| 9647 | `RESEARCH_JOB_CANCEL` | `research` | Defer P3 | Deterministic cancellation with a recorded terminal outcome. |
| 9650 | `RESEARCH_STRESS_START` | `research` | Defer P3 | Stress work must be pre-registered and excluded from default selection. |
| 9653 | `AUTOTRADE_GET` | `paper` | Defer P6 | Paper automation state only; no live mode. |
| 9654 | `AUTOTRADE_SET_MODE` | `paper` | Defer P6 | Permit `off`/`paper` only and enforce the full execution gate. |
| 9655 | `AUTOTRADE_KILL` | `paper` | Defer P6 | Durable kill switch must halt every paper path. |
| 9656 | `AUTOTRADE_STOP_ACKNOWLEDGE` | `paper` | Defer P6 | Require a stable acknowledgement reason code and append-only audit. |
| 9660 | `AUTOTRADE_RUN` | `paper` | Defer P6 | Use the decimal OMS and injected clock; never submit a live order. |
| 9661 | `AUTOTRADE_SET_STRATEGY` | `paper` | Defer P3 | Only an adopted, evidence-bound strategy may be selected. |
| 9664 | `STRATEGY_COMPARE` | `research` | Defer P3 | Rebuild from registered out-of-sample evidence. |
| 9665 | `META_LABEL_STUDY` | `research` | Defer P3 | Research-only; no default or decision-path adoption without validation. |
| 9666 | `REALITY_CHECK` | `risk` | Adapt | Implemented at the P4 service boundary as an immutable injected-clock report with stable notice codes, deterministic validation issues, source-evidence and assessment hashes, and no execution authority; transport remains deferred. |
| 9667 | `CONTRIBUTION_PLAN` | `portfolio` | Adapt | Decimal estimate with explicit cadence and assumptions. |
| 9670 | `EVIDENCE_TRACKER` | `risk` | Adapt | Implemented at the P4 service boundary as a read-only, hash-verified, versioned gate view that reports incomplete history, missing/invalid/unsupported evidence, unmet requirements, or review eligibility; live execution always remains disabled and transport is deferred. |
| 9671 | `EVIDENCE_EXPORT` | `risk` | Defer P5 | Risk produces redacted evidence data; desktop owns file selection. |
| 9672 | `TAX_PREVIEW` | `portfolio` | Adapt | Implemented by `PortfolioTaxService.previewSale` as a no-write exact-decimal comparison with explicit rates and lot-method identity. |
| 9677 | `BOT_VIEW` | `paper` | Defer P6 | Paper status/read model only; remove promotional or live claims. |
| 9678 | `NEWS_VIEW` | `market-data` | Adapt | Informational and explicitly never a signal. Implemented by `MarketDisplayQueryService.news`; transport remains deferred. |
| 9679 | `BOT_SET_BUDGET` | `paper` | Defer P6 | Decimal paper-only budget with an explicit funding source. |
| 9684 | `STRATEGY_BACKTEST` | `research` | Defer P3 | Use registered dataset, costs, trials, and final-holdout policy. |
| 9687 | `SIMULATION_LAB` | `research` | Defer P3 | Evidence-only sandbox; cannot mutate production/default strategy. |
| 9688 | `KOKIBOT_CREW` | `research` | Defer P3 | Read-only sandbox evidence if retained; no registry or default-path control. |
| 9689 | `KOKIBOT_WORKERS_RUN` | `research` | Reject | Autonomous unregistered worker search invalidates trial accounting. |
| 9692 | `KOKIBOT_PROPOSALS_APPLY` | `research` | Reject | No self-applying research proposals. |
| 9693 | `KOKIBOT_AUTONOMY_SET` | `research` | Reject | Adaptive autonomy is forbidden in the default path. |
| 9696 | `KOKIBOT_WORKERS_SET` | `research` | Reject | Do not expose autonomous research workers as product behavior. |
| 9699 | `KOKIBOT_CONTROLLER_AUTO_APPLY_SET` | `research` | Reject | No controller may silently apply research outcomes. |
| 9702 | `RESEARCH_INBOX` | `research` | Defer P3 | Replace mutable inbox state with registered hypotheses and evidence. |
| 9703 | `RESEARCH_ADD_HYPOTHESIS` | `research` | Defer P3 | Create immutable pre-registration records before execution. |
| 9706 | `RESEARCH_VALIDATE_HYPOTHESIS` | `research` | Defer P3 | Run only the frozen registered test and append its result. |
| 9709 | `STRATEGY_CONFIG_GET` | `research` | Defer P3 | Read approved configuration and provenance; current defaults remain unvalidated. |
| 9710 | `STRATEGY_CONFIG_SET` | `research` | Reject | Arbitrary runtime strategy patches bypass registration and adoption gates. |
| 9714 | `PLAYBACK_DATA` | `research` | Defer P5 | Split the composite view into provenanced market and simulation queries. |
| 9717 | `PAPER_WALLET_GET` | `paper` | Defer P6 | Derive decimal balances from the append-only paper ledger. |
| 9718 | `PAPER_WALLET_SET` | `paper` | Reject | Direct position replacement bypasses orders, fills, and ledger evidence. |
| 9721 | `PAPER_WALLET_CLEAR` | `paper` | Defer P6 | Explicit reset creates an audited boundary; never delete journal history. |
| 9722 | `PAPER_WALLET_SEED_BUDGET` | `paper` | Defer P6 | Seed decimal cash through a recorded ledger event, not synthetic fills. |
| 9725 | `PAPER_WALLET_AUTO_ALLOCATE` | `paper` | Defer P6 | Create gated order intents; never replace positions directly. |
| 9728 | `PAPER_MONITOR_GET` | `paper` | Defer P6 | Paper monitor state uses injected time and scheduler status. |
| 9729 | `PAPER_MONITOR_SET` | `paper` | Defer P6 | Scheduler owns cadence; paper owns the durable enablement policy. |
| 9730 | `PAPER_RUN_START` | `paper` | Defer P6 | Start a correlated, durable paper-run lifecycle. |
| 9731 | `PAPER_RUN_END` | `paper` | Defer P6 | End with immutable summary evidence. |
| 9732 | `PAPER_ACTIVITY_GET` | `paper` | Defer P6 | Read append-only order/fill/journal evidence. |
| 9733 | `PAPER_ACTIVITY_CLEAR` | `paper` | Reject | Evidence is append-only; support an archive/view boundary instead. |
| 9734 | `PAPER_WALLET_BACKTEST` | `research` | Defer P3 | Research owns historical evaluation; bind it to registered inputs. |
| 9737 | `RECOMMENDATIONS_GET` | `paper` | Defer P3 | Recommendations require validated evidence and remain paper-only. |
| 9738 | `RECOMMENDATION_APPLY` | `paper` | Defer P6 | Convert to a gated paper order intent; do not rotate stored positions. |
| 9741 | `RECOMMEND_AUTO_APPLY_SET` | `paper` | Defer P6 | Opt-in paper automation only, behind every execution gate. |
| 9744 | `WALLET_LIST` | `accounts` | Adapt | Implemented as the predecessor alias of `PROFILE_LIST`; returned metadata is ordered, immutable, and secret-free. |
| 9745 | `WALLET_ADD` | `accounts` | Adapt | Implemented as the predecessor alias of `PROFILE_CREATE`; the isolated database is provisioned before atomic manifest publication. |
| 9746 | `WALLET_REMOVE` | `accounts` | Adapt | Implemented through the safer `PROFILE_DELETE_PREVIEW` → verified backup → confirmed `PROFILE_DELETE` workflow rather than one destructive call. |
| 9747 | `WALLET_SYNC` | `accounts` | Adapt | Implemented as the predecessor alias of `PROFILE_REFRESH_ALL`, a bounded cancellable fan-out with ordered per-profile outcomes. |
| 9748 | `WATCHLIST_GET` | `portfolio` | Adapt | Predecessor semantics are attributed public BTC/ETH/SOL addresses, not selected coins. Return bounded profile-scoped entries with observation/provenance status; never import balances into holdings. |
| 9749 | `WATCHLIST_ADD` | `portfolio` | Adapt | Validate an explicit chain/address and attribution metadata, deduplicate by chain-specific canonical address, and make no identity-verification claim. |
| 9750 | `WATCHLIST_REMOVE` | `portfolio` | Adapt | Remove only a profile-scoped user entry; immutable observation history and any future curated evidence remain separate. |
| 9751 | `ADVISOR_STATUS` | `advisor` | Adapt | Implemented at the P4 service boundary as secret-free provider, presence, and model-policy status; transport remains deferred. |
| 9752 | `ADVISOR_CONNECT` | `advisor` | Adapt | Implemented at the P4 service boundary through the profile-scoped secret adapter; key material never enters a result or SQLite. |
| 9753 | `ADVISOR_DISCONNECT` | `advisor` | Adapt | Implemented at the P4 service boundary; removes only the scoped Gemini credential and non-secret model configuration. |
| 9754 | `ADVISOR_SET_MODEL` | `advisor` | Adapt | Implemented at the P4 service boundary with Coqui-owned allowlisted policy identifiers and no free-form endpoint. |
| 9755 | `ADVISOR_ASK` | `advisor` | Defer P5 | Treat output as explanation, never an execution or strategy signal. |
| 9756 | `ADVISOR_MARK_WELCOME` | `advisor` | Defer P5 | Safe presentation preference only. |
| 9757 | `ADVISOR_TTS` | `advisor` | Defer P5 | Bounded text, redacted request, and no financial action side effect. |
| 9758 | `SOCIAL_STATUS` | `advisor` | Defer P5 | Informational provider status with freshness. |
| 9759 | `SOCIAL_GET` | `advisor` | Defer P5 | Informational consensus only; never a strategy signal. |
| 9761 | `COINS_GET` | `market-data` | Adapt | Implemented as a bounded Coinbase catalog page plus the ordered profile-scoped tracked display set, with explicit continuation and no strategy/default inference. |
| 9765 | `COINS_SET` | `market-data` | Adapt | Implemented as an atomic exact ordered replacement over already-known canonical Coinbase spot identities with immutable transition provenance; point-in-time research universes are never written. |
| 9768 | `COINS_SEARCH` | `market-data` | Adapt | Implemented as the `DisplayUniverseService.search` alias with strict query/limit validation, injected timing, stable failures, cancellation, and canonical mapping retention. |
| 9774 | `LONG_TERM` | `risk` | Adapt | Implemented at the P4 service boundary as an explicit-parameter, Coinbase-completed-series assessment with dataset/series/parameter hashes, stable reason codes, and no order or live-execution authority; transport remains deferred. |
| 9775 | `LONG_TERM_SIM` | `research` | Defer P3 | Use the shared registered backtest path, not a duplicate simulator. |
| 9778 | `PERFORMANCE_VIEW` | `portfolio` | Adapt | Implemented by `PortfolioSnapshotEvidenceService.performance`; incomplete and legacy-unverified days are excluded from return claims. |
| 9779 | `ALERTS_GET` | `alerts` | Adapt | Implemented at the P4 service boundary as a bounded profile-scoped view over typed policy, canonical targets, immutable alert facts, and separate presentation state; transport remains deferred. |
| 9780 | `ALERTS_CONFIG_SET` | `alerts` | Adapt | Implemented as complete deterministic validation before one atomic typed policy replacement; unknown fields and invalid thresholds never partially mutate policy. |
| 9784 | `ALERTS_MARK_READ` | `alerts` | Adapt | Implemented as profile-scoped presentation metadata; acknowledgement never updates or deletes the immutable alert fact. |
| 9785 | `ALERTS_CLEAR` | `alerts` | Adapt | Implemented as a visibility archive timestamp over currently recorded facts; historical alert evidence remains append-only. |
| 9786 | `ALERTS_TEST_NOTIFICATION` | `alerts` | Defer P5 | Service creates a safe request; desktop owns native notification I/O. |
| 9787 | `PRICE_TARGET_ADD` | `alerts` | Adapt | Implemented with Coinbase spot identity, exact decimal USD target, deterministic UUIDv4 source, explicit direction, and validation before ID/time/storage use. |
| 9791 | `PRICE_TARGET_REMOVE` | `alerts` | Adapt | Implemented as a profile-scoped removal tombstone; target rows are never physically deleted. |
| 9795 | `PRICE_TARGET_SET_ENABLED` | `alerts` | Adapt | Implemented as a profile-scoped explicit toggle; re-arming clears only the prior trigger marker and cannot revive a removed target. |
| 9800 | `APP_INFO` | `ingest` | Defer P5 | Replace the composite with a minimal shell capability/status contract; omit local paths. |
| 9801 | `DATA_BACKUP` | `ingest` | Defer P5 | Storage produces a consistent backup; desktop owns the chosen destination. |
| 9802 | `DATA_RESTORE` | `ingest` | Defer P5 | Verify schema/integrity before an atomic restore; never surface raw errors. |
| 9803 | `DATA_REVEAL` | `ingest` | Defer P5 | Desktop shell action only; no arbitrary renderer-provided path. |
| 9804 | `OPEN_EXTERNAL` | `ingest` | Defer P5 | Desktop enforces an exact HTTPS origin/path allowlist. |
| 9805 | `CSV_IMPORT` | `portfolio` | Adapt | Use the pivot importer; explicit resolver, fingerprints, and no invented lots. |
| 9806 | `TAX_PACKET_EXPORT` | `portfolio` | Defer P5 | Portfolio builds redacted files; desktop owns destination selection. |
| 9807 | `LAUNCH_AT_LOGIN_SET` | `scheduler` | Defer P5 | Desktop applies OS login settings; scheduler exposes requested operational policy. |
| 9811 | `SETTINGS_GET` | `accounts` | Adapt | Implemented by `AccountSettingsService.get` as a profile-scoped immutable view of Coqui-owned theme, density, motion, and language preferences with explicit default/saved provenance. |
| 9812 | `SETTINGS_SET` | `accounts` | Adapt | Implemented as deterministic complete validation followed by one atomic typed merge; unknown fields and predecessor financial, tax, provider, strategy, or advisor fields are rejected without mutation. |
| 9817 | `PROFILE_LIST` | `accounts` | Adapt | Implemented at the P4 service boundary as ordered, deeply immutable, secret-free metadata from a strictly validated predecessor-compatible manifest; transport remains deferred. |
| 9818 | `PROFILE_GET_ACTIVE` | `accounts` | Adapt | Implemented at the P4 service boundary as active profile metadata only, with no database filename, fingerprint, or credential fields. |
| 9821 | `PROFILE_CREATE` | `accounts` | Adapt | Implemented with injected UUIDv4/time, complete validation, isolated database provisioning before revision-checked atomic manifest publication, and no implicit activation. |
| 9826 | `PROFILE_UPDATE` | `accounts` | Adapt | Implemented as a typed display-metadata-only replacement that preserves database identity and non-secret Coinbase fingerprints without returning them. |
| 9831 | `PROFILE_REORDER` | `accounts` | Adapt | Implemented as an exact-permutation, revision-checked atomic replacement; invalid input is a no-op. |
| 9834 | `PROFILE_SWITCH` | `accounts` | Adapt | Implemented at the P4 service boundary through serialized two-phase preparation, revision-checked durable selection, atomic context commit, safe rollback, and explicit ambiguous recovery; P5 composition wiring remains deferred. |
| 9835 | `PROFILE_DUPLICATE` | `accounts` | Adapt | Implemented as a verified SQLite snapshot with transactional profile-ID rewrite, explicit transient-state exclusions, no secret/fingerprint copy, and revision-safe publication cleanup; transport remains deferred. |
| 9838 | `PROFILE_DELETE_PREVIEW` | `accounts` | Adapt | Implemented as a read-only, bounded, secret-value-free consequence preview; eligibility requires a current verified backup matching manifest, evidence-count, and credential-category state. |
| 9841 | `PROFILE_DELETE` | `accounts` | Adapt | Implemented at the P4 service boundary with exact profile/backup confirmation, fresh backup parity, a durable manifest-commit journal, scoped database/keychain cleanup, and explicit resumable cleanup outcomes; restore and transport remain deferred. |
| 9845 | `PROFILE_COMPARE` | `accounts` | Adapt | Implemented as a bounded secret-free comparison with one canonical price batch, exact subtotals versus nullable complete equity, source/quality provenance, and explicit per-profile failures; transport remains deferred. |
| 9848 | `PROFILE_DASHBOARD` | `accounts` | Adapt | Implemented as a bounded secret-free dashboard over exact valuation plus sanitized freshness, automation, risk, safety-stop, and incident-count evidence; transport remains deferred. |
| 9849 | `PROFILE_REFRESH_ALL` | `accounts` | Adapt | Implemented as a four-way bounded, cancellable fan-out through an injected authenticated-acquisition boundary with ordered per-profile outcomes, stable reason codes, and no diagnostic or credential leakage; transport remains deferred. |
| 9850 | `PROFILE_AUTOMATION_STATUS` | `scheduler` | Adapt | Implemented as bounded injected-clock schedule health with no owner identity, credentials, or raw errors; transport remains deferred. |

## Binding safety decisions

- `COINBASE_SYNC` may ingest provider accounts and fills, but it must not replace, resize, or
  invent tax lots. `COINBASE_IMPORT_RESOLVE` is rejected because its acceptance path promotes the
  adjusted staged ledger. Reconciliation remains a quantified report.
- Direct paper-position replacement and paper-activity deletion are rejected. P6 must route
  mutations through decimal order/fill/ledger facts and preserve ambiguous outcomes as `unknown`.
- Kokibot worker execution, proposal application, runtime strategy patches, and adaptive
  auto-application are rejected. P3 remains blocked and current strategy defaults remain
  unvalidated.
- File dialogs, native notifications, login settings, folder reveal, and external navigation stay
  in the future desktop shell. Services expose validated intent/data only; they never import
  Electron. External navigation remains an exact allowlist rather than a general URL opener.
- The scheduler is deferred but its boundary is fixed: UTC cadence, injected `Clock`, durable
  per-wallet leases, concurrency two, low-cardinality health metrics, and no keychain reads.

## Completion rule

The catalogue is complete only when its 140 rows are unique, every row names one of the ten
services, the per-service totals sum to 140, and source lines are strictly increasing. The
repository test suite enforces those local invariants without depending on the ignored,
user-owned `.migration-source` checkout.
