# Frontend performance audit — 2026-10-08

Coqui's Figma design and algorithm behavior are preserved. This pass eliminates repeated presentation work and defers secondary route modules. It does not change ingestion, calculation inputs, execution, scheduler behavior, polling intervals, or history limits. Existing unrelated working-tree edits were retained.

## Architecture confirmed from the repository

The frontend is `apps/desktop`, not the entire monorepo. Installed versions: Electron 43.4.1, React 19.2.8, Vite 8.2.2, TanStack React Query 5.101.4, Lightweight Charts 5.2.1 and Recharts 2.15.4. Ionic 9.0.1 provides deferred overlay/segmented controls; Base UI and Lucide are also present. No dependencies were added or removed.

Entry and hierarchy:

```text
src/renderer/index.html → main.tsx → App
  WorkspaceProvider (preferences, responsive shell, inspector)
  WorkspaceApp
    Sidebar + StatusRail
    RouteScreen (route registry in app/routes.ts)
      Overview → TerminalWorkspace → Workspace
        AdvancedMarkets → ChartTile → TradingWorkstationChart → ChartFrame
        TerminalOrderBook / depth / recent trades
        account tabs + algorithm/evidence sidebar or drawer
```

`query/use-channel.ts` uses shared TanStack query keys, structural sharing, and centralized `query/refetch.ts` policies. Inline request objects are hashed by value; they do not by themselves create distinct subscriptions. `query/client.ts` communicates through `preload/index.ts`; the renderer CSP forbids network connections.

Market socket ingestion, live-candle aggregation, depth and trade caches belong to Electron main (`coinbase-market-stream.ts`, `coinbase-microstructure.ts`, `market-handlers.ts`). Display indicators, evidence grouping, keyboard labels, and chart rendering run on the renderer thread. The scheduler and financial services are outside React; ML inference has an explicit worker boundary in `ml-signal-runtime.ts`. Being outside React does **not** imply every main-process calculation is off-thread.

The examined beta.14 package manifest already contained Ionic, Recharts, Lightweight Charts and TanStack Query. These dependencies cannot be attributed to the latest redesign merely because they are expensive. The terminal redesign retained several eager secondary route imports and inherited CSS rules.

## Ranked findings and changes

| Priority | Evidence and root cause | Action and scope |
| --- | --- | --- |
| 1 | One-second book/live subscriptions live in `TerminalWorkspace.Workspace`. In a 30-second feed it executed 136 times, passing unchanged chart inputs into `AdvancedMarkets` 139 times. That component recreated tile objects, extension ID arrays, marker arrays, callbacks and annotation arrays, propagating work into chart hooks. | Added a shallow `memo` boundary to `AdvancedMarkets`. Its own query, context, product and activity changes still render. Executions fell to 9; `ChartTile` 199 → 68 and `TradingWorkstationChart` 229 → 98. No polling changes. |
| 2 | `use-chart-extension-series.ts` serialized up to 2,000 completed OHLCV bars on every render, although its content key already prevented duplicate evaluations. Live-only candle changes rebuilt the input unnecessarily. | Memoized serialization and supplied structurally shared history from `MarketChartTile` instead of concatenated history/live arrays. Filtering, 2,000-bar bound, OHLCV correction detection and extension authority stay intact. Evaluations during unchanged completed history remained zero before and after. |
| 3 | Accessible keyboard observations formatted every historical timestamp again when one live candle changed. A focused 120-update/2,000-history-bar experiment took 231.9 ms without reuse and 5.6 ms with reuse. | `chart-observations.ts` caches labels by immutable bar object in a WeakMap. Corrected/replaced bars and provisional candle changes regenerate their labels. No rows, timestamps or accessible observations are removed. Memoized the existing completed-history key to avoid rebuilding it on pointer/drawing-only renders. |
| 4 | `RouteScreen.tsx` eagerly imported portfolio, paper, settings, allocation, operations and other secondary screens into the entry graph. The normal entry chunk was 410,606 bytes. | Converted those imports to existing `lazy`/`Suspense` patterns. Normal entry chunk is 245,504 bytes (40.2% smaller), gzip 112,318 → 75,065 bytes (33.2% smaller). Cold secondary routes can briefly show the existing loading fallback. Total emitted JS increased 0.4% from split/shared-module overhead; functionality was not removed. |
| 5, follow-up | `coinbase-microstructure.book()` materializes all levels; `market-depth.aggregateDepth()` performs exact fixed-point bucketing and sorts buckets synchronously before returning 12 displayed rows. A synthetic 50,000-level **single side** took 52.6–64.7 ms; 10,000 levels took 10.5–19.3 ms. This can occupy Electron main and delay IPC without appearing as a renderer long task. | Left unchanged. The benchmark establishes scaling risk, not that the user's real books contain 50,000 levels. Capture actual book size and main-process/IPC timing before considering a worker or exact incremental aggregation. Preserve every market event and exact arithmetic. |

The component counts use optional build-time counters at actual function entry, rather than persistent Fiber flags. They count function executions, not DevTools commit durations. Timing results below use normal minified builds, separate from the counter build.

## Visual, DOM and lifecycle audit

- CSS output remained **identical**: `index-BCeBMsJ5.css`, 171,368 bytes. No effects, colors, typography, wrappers, breakpoints or transitions were changed.
- The inherited `.status-rail` uses `backdrop-filter: blur(12px)`. The terminal override has a transparent background, so this remains a candidate for a GPU trace on the affected machine. No paint/compositing evidence justified deleting it.
- Overlay shadows are confined to drawers, dialogs and floating panels. Order-book row gradients encode depth; the benchmark displays a bounded number of rows. The loading gradient is static. Crew SVGs have opacity/blink animations and an animated small drop shadow, with reduced-motion overrides. No `will-change` proliferation or animated layout properties were found in the scanned renderer styles.
- The fixture document had 744 → 750 elements, 56 SVGs, 181 SVG child nodes and 7 canvases. The extra document elements are associated with the changed module preload graph; screenshots retain the same body layout. No large inline vector or wrapper bottleneck was established. Virtualization would add focus/accessibility complexity without evidence of a large rendered list in this fixture.
- Coin SVGs are 392–5,820 bytes and remain external image assets. The brand PNG is 128×128 / 7.7 kB. Older operations PNGs are 260×360 / roughly 87–129 kB and are not the terminal chart's load bottleneck. No assets were recompressed or visually altered.
- No component-owned `setInterval` or scroll event listener was found in `renderer/app`. Main owns feeds; React Query owns polling. Profile metadata and chart workspace have immutable/nonpolling policies; book, tape, live-candle and live status use one-second policies. All policies are unchanged.
- `chart-lifecycle.ts` owns creation, ResizeObserver, theme observation, fullscreen listeners and destruction. Teardown disconnects observers, removes listeners, releases link subscriptions and removes the chart. No missing cleanup was established in the examined paths.
- Trading canvases are tied to instrument/series identity. Live updates already use `series.update` when the prefix is unchanged, falling back to full `setData` on actual history changes. Indicators depend on completed-history/options keys. Signed extension evaluations remain bounded and ignore provisional bars.
- DOM reads in drawing projection and pointer capture remain candidates for detailed forced-layout stacks, but no alternating read/write loop was found. Measured layout totals were small; this pass does not claim a forced-reflow diagnosis.

## Reproducible measurements

Baseline: working tree based on `f0765e6`, including the user's existing edits, captured before frontend optimization. Local macOS arm64 / Electron 43.4.1, 1920×1080 content size, hidden window with background throttling disabled, isolated temporary database and disabled algorithm scheduler. The fixture supplies 2,000 completed bars, an enabled display extension, one changing live candle, and a deterministic one-second depth/trade feed. It does not read the operator's live database or credentials.

Each normal-build phase has three runs. Each run starts on settings, opens the terminal, repeats settings/terminal navigation 12 times, zooms the chart, measures a 30-second feed, switches to trades halfway through, performs 120 crosshair input samples and 60 wheel input samples, and captures responsive screenshots. Feed counts refer to the 30-second measurement, not later input/screenshot time. Values are medians across the three runs except the separately paired component counters.

| Measurement | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Renderer script time / 30-second feed | 0.811 s | 0.508 s | 37.3% less JavaScript execution |
| Renderer task time / feed | 1.424 s | 1.059 s | 25.6% reduction; includes instrumentation/scheduling work |
| Layout time / feed | 25.3 ms | 40.6 ms | Increased 15.3 ms total; no frame-time regression observed |
| Style recalculation / feed | 4.94 ms | 6.26 ms | Small absolute increase; do not claim a rendering/paint improvement |
| Shell element available after load begins | 59 ms | 53 ms | Small sample; excludes runtime creation and does not prove full startup improvement |
| First chart after settings | 369 ms | 366 ms | Essentially unchanged; not a fresh-process default-route measurement |
| Cached chart navigation p75 | 15 ms | 14 ms | Already within budget |
| Feed frame interval p95 | 9.3 ms | 9.3 ms | No observed improvement or regression |
| Feed frame intervals >34 ms | 0 | 0 | Every normal run |
| Crosshair round trip to two animation frames, p75 | 17 ms | 17 ms | Frame-paced input proxy, not standardized INP |
| Wheel round trip to two animation frames, p75 | 17 ms | 17 ms | Fixture scroll stayed within frame cadence |
| Wheel-phase JavaScript total | 30.3 ms | 18.3 ms | 39.5% less script work; input latency unchanged |
| GC heap after 12 navigation cycles | 25.95 MB | 25.30 MB | Similar retained memory; insufficient duration to rule out every leak |
| History queries / feed run | 1 | 1 | No extra history fetching |
| Live-candle queries / feed run | 31 | 31 | Freshness cadence unchanged |
| Book queries / feed run | 31 | 31 | No duplicated feed polling observed |
| Tape queries / feed run | 15 | 15 | Mounted only for the second half |
| Canvas removals / unchanged-extension evaluations / viewport drift | 0 / 0 / 0 px | 0 / 0 / 0 px | Every normal run |
| Renderer long tasks ≥50 ms during feed | 0 | 0 | Does not cover main-process work or startup |

Frame intervals reflect this machine's high-refresh display. No CPU/network throttle was applied. CDP task/script/layout/style counters separate JavaScript from layout/style work, but paint, raster, GPU compositing, actual exchange latency and process-wide startup were not measured. Those limits matter: the deterministic fixture did **not** reproduce severe user-reported scrolling or chart stutter, so this pass cannot claim those symptoms are fully resolved.

Raw runs, counter runs, bundle source lists and computed medians are in [frontend-performance-2026-10-08/](frontend-performance-2026-10-08/), especially [results.json](frontend-performance-2026-10-08/results.json). Before/after screenshots at 1920, 1440 and 1280 widths are in [screenshots](../design/screenshots/frontend-performance-2026-10-08/). Dynamic market timestamps/axis time differ between captures; geometry and styles were visually compared.

Run current normal-build measurements from the repository root:

```sh
pnpm build
pnpm --filter @coqui/desktop build
node apps/desktop/scripts/bundle-audit.mjs /tmp/coqui-bundle.json
COQUI_PERF_SECONDS=30 COQUI_PERF_AUDIT=1 COQUI_PERF_INTERACTIONS=1 COQUI_PERF_OUTPUT=/tmp/coqui-perf-screenshots pnpm --filter @coqui/desktop exec electron scripts/terminal-perf.mjs
```

Repeat three times without other benchmark/test jobs running. Compare against the saved baseline logs. For actual component execution counts:

```sh
pnpm --filter @coqui/desktop exec vite build --mode performance
COQUI_PERF_SECONDS=30 COQUI_PERF_AUDIT=1 COQUI_PERF_INTERACTIONS=1 pnpm --filter @coqui/desktop exec electron scripts/terminal-perf.mjs
pnpm --filter @coqui/desktop build
```

The optional performance mode injects counters and emits a readable build with source maps disabled. It is not the normal packaged build. The final normal output was checked to contain no `audit-hook.js`. Production timing comparisons must use normal builds in both phases.

## Files changed by this audit

| File | Purpose |
| --- | --- |
| `apps/desktop/src/renderer/app/AdvancedMarkets.tsx` | Isolate chart workspace from unrelated parent renders. |
| `apps/desktop/src/renderer/app/MarketChartTile.tsx` | Pass stable history to the extension hook. |
| `apps/desktop/src/renderer/app/use-chart-extension-series.ts` | Avoid repeated completed-history serialization. |
| `apps/desktop/src/renderer/app/TradingWorkstationChart.tsx` | Reuse keyboard labels and completed-history key. |
| `apps/desktop/src/renderer/app/chart-observations.ts` | Weak-reference cache of immutable accessible observations. |
| `apps/desktop/src/renderer/app/RouteScreen.tsx` | Defer secondary route modules using existing loading state. |
| `apps/desktop/vite.config.ts` / `scripts/renderer-audit-hook.js` | Opt-in execution counters only for the performance build. |
| `apps/desktop/scripts/terminal-perf.mjs` | CDP counters, frame/input samples, GC navigation memory and existing lifecycle guards. |
| `apps/desktop/scripts/bundle-audit.mjs` | Reproducible raw/gzip sizes and source attribution lists. |
| `tests/chart-observations.test.ts` | Completed-label reuse, corrected history, live updates, completion and timestamp semantics. |
| This report, measurement JSON/logs and screenshots | Baseline, results, limits and visual evidence. |

No algorithm, core, service, adapter, main-process, query-policy or CSS source was modified by this audit. Existing working-tree changes in those areas belong to the preceding work.

## Verification and remaining work

- `pnpm typecheck`: passed.
- `pnpm lint`: passed, including a final run after tooling repairs.
- `pnpm test`: **252 files / 1,642 tests passed**. The focused chart/route/depth tests also passed.
- `pnpm build` and `pnpm --filter @coqui/desktop build`: passed. The existing >500 kB warning remains for the deferred Ionic chunk.
- Existing Electron performance gate: useful shell 164 ms, interaction p75 8.4 ms, p95 8.5 ms. Its 250 ms synthetic blocking control measured p75 250.5 ms and failed the budget as required; the gate passed.
- Electron smoke gate passed, including terminal tabs and keyboard focus, product propagation, chart/depth/tape selection, native fullscreen and drawer focus trapping. Its fixtures exercise unavailable/failed provider states as well as interactions.
- Three production lifecycle guard runs passed. Responsive before/after screenshots were inspected; no visual redesign or layout regression was observed.

Next, capture a simultaneous renderer trace and Electron main CPU profile while the user's lag actually occurs. Record real depth size, IPC duration, scheduler overlap, candle/indicator configuration, portfolio row count and provider response times. Investigate exact depth aggregation and main-process contention first if delays occur before query promises resolve. If the UI frame is slow after responses resolve, inspect drawing projection, marker grouping and real-data lists. Only then consider worker isolation, event-preserving batching or virtualization. The inherited header blur needs paint/compositing evidence before a visual tradeoff is proposed.

Ionic (~1.07 MB raw) and Recharts (~357 kB raw) remain deferred dependencies. Replacing either would be a larger functional/design change than this evidence supports. Full startup, lower-powered hardware, other themes, GPU behavior and long-duration memory retention remain follow-up measurements.
