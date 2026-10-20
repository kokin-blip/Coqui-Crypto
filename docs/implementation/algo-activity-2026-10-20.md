# Algorithm Activity / Order Book — local implementation

COQ-33: https://linear.app/coqui-crypto/issue/COQ-33

The compact terminal panel now opens on **Algo Activity**, with **Order Book** as its only other tab. It reuses the existing Coqui Figma library and terminal styles. Defaults are all assets, seven days, closed net P/L and grouped executed orders.

## Behavior and data

- Source/account selection is shared with the chart, positions and algorithm views. Each source exposes only supported account choices. Combined simulations remain explicitly combined; Alpaca sources and details include a masked account suffix. Existing wallet nicknames are reused when available.
- Four metrics show selected-window realized net P/L, current open P/L, winning/losing sell-order outcomes and executed-order count. Imported inventory, unknown fees, quantity mismatches and incomplete history keep affected totals unavailable, with labeled known subtotals.
- The 80px chart defaults to cumulative realized net P/L, with its endpoint equal to the summary. Optional Total plots the change from the first valid recorded valuation and exposes the effective start and gaps. It requires two valid attributable observations. Equity-only observations are accepted only for the sealed exploratory simulation, across all assets; ledger and parallel sources reconcile per-asset quantities and basis. No account-wide equity, live-price backfill or new recorder substitutes for missing evidence.
- Recent executions are grouped by order and scoped instrument/account. Partial fills retain recorded order state. In-window totals and lifetime detail are separate. Unknown order identity remains a standalone fill. Buys never display realized profit. Asset links select the main chart; disclosures show individual fills, fees, source account, identifiers and available recorded reason.
- The first 20 groups are returned with the overview. Older groups and order fills use source/profile/filter-bound cursors with a fixed observation cutoff. Polling preserves expanded groups, focus and scroll position. Superseded query results do not cross selections.
- The Order Book retains its market/aggregation/depth/midpoint behavior, with an independently timestamped performance strip opening Algo Activity without resetting filters or chart mode. The public market-trade channel remains registered.

The new validated reads are `trading.activity.overview`, `trading.activity.orders` and `trading.activity.order-detail`. `trading.activity.scopes` additionally lists supported account selections. Existing summary/trail requests remain compatible. Financial calculations stay in the core/main process, use decimal FIFO accounting and reuse one replay implementation for current and historical observations. Historical caches use SQLite local changes plus `data_version` to notice detached writers. Newest executions are read separately when the 50,000-record cost-basis cap is exceeded; affected totals stay unavailable.

Overview reads use centralized five-second foreground polling and two-second stale time. Both tabs share one parent query. Historical chart output is bounded to 256 observations while preserving endpoints, extrema and explicit gaps; a history with too many gaps is unavailable rather than misleadingly connected. No storage migration, provider call, strategy/execution permission change or background valuation task was added.

## Figma correspondence

Source library: https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs

Inspected high-fidelity Panel `3:64`, active Tab `3:28` / set `3:30`, Dropdown `3:47` / set `3:56`, Table Row `3:72` and Book Row `3:74`. Existing semantic `CoquiSelect`, `CoquiButton`, `CoquiBadge`, `TerminalTabs` and financial formatters are reused, with component node mappings retained. The existing neutral panels, IBM Plex Sans, 340px desktop column and theme tokens remain. No temporary Figma assets or additional charting dependency is introduced.

Screenshots and actual viewport measurements: [UI evidence](evidence/coq33/smoke.json). The responsive batch covers requested 1920/1440/1280/960/640 widths and 200% zoom, with dark, light and high-contrast themes. Native macOS limits some window heights to 861 CSS pixels; the evidence records actual dimensions. In-scope panel geometry has no horizontal clipping. The simulated profile intentionally contains offline/missing unrelated data; those existing screen states are not part of this feature’s visual acceptance.

- [Compact panel preview](evidence/coq33/algo-activity-panel.png)
- [Dark terminal at 1440](evidence/coq33/algo-activity-dark-1440.png)
- [Light terminal at 1280](evidence/coq33/algo-activity-light-1280.png)
- [High contrast at 200% zoom](evidence/coq33/algo-activity-zoom-1280.png)
- [Order Book and performance strip](evidence/coq33/order-book-dark-1920.png)
- [Unavailable broker evidence](evidence/coq33/algo-activity-alpaca-missing-evidence.png)

## Verification

The full repository suite passed **275 files / 1,871 tests**. Subsequent focused checks cover the latest additions, including detached-writer invalidation. See [verification.json](evidence/coq33/verification.json) and saved logs for final counts and source hashes.

- Repository typecheck, ESLint, build and desktop production build passed.
- Dedicated Electron smoke: **26 checks passed**, including defaults, shared source/account state, grouped pagination, keyboard chart inspection, expansion/focus retention through refresh, both chart modes, Order Book strip navigation, late-response isolation, missing-data states and responsive themes/zoom. Synthetic trading-read p95 was **2.45ms** in that workload.
- Standard Stage 2.4 Electron smoke gate passed, including the updated default tab, market/decision linking, Order Book/depth controls, native fullscreen and drawer keyboard focus.
- Bounded terminal performance workload: 2,000 bars, 12 navigation cycles, 15 seconds of synthetic one-second market updates. Cached navigation p75 **15ms**, frame p95 **10.1ms**, IPC p95 **0.4ms**, zero removed chart canvases, zero viewport drift, zero unchanged extension recomputations and zero long tasks. The removed public-trade tab generated zero tape polls. This is a current synthetic workload measurement, not a claim of live venue performance or a controlled before/after speedup.
- The 50,001-fill test confirms the newest group remains current after the history cap and affected P/L stays unknown. The shared replay handles historical observations without repeatedly rebuilding each fill prefix.

The existing Chromium warning about `frame-ancestors` in a meta CSP is recorded separately in UI evidence; no new uncaught renderer/chart errors occurred. Production build retains its existing large-chunk warning.

Commands were run with `pnpm --config.verify-deps-before-run=false` to use installed workspace dependencies without pnpm attempting an unrelated dependency installation. UI/performance entrypoints:

```sh
node apps/desktop/node_modules/electron/cli.js apps/desktop/scripts/algo-activity-smoke.mjs
node apps/desktop/node_modules/electron/cli.js apps/desktop/scripts/algo-activity-perf.mjs
node apps/desktop/node_modules/electron/cli.js apps/desktop/scripts/smoke.mjs
```

## Delivery

Local implementation only. No commit, PR, merge, packaged installation or release was performed for COQ-33. Existing unrelated working-tree edits were preserved. Human review and release gates remain open. Linear is updated to reflect review readiness, with originating prompts and final evidence.

[Prompt used — exact originating requests, follow-up choices and implementation plan](evidence/coq33/prompts.md).
