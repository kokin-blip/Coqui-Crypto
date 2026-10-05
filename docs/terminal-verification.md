# Trading terminal verification — 2026-10-03

Design: [Editable Figma specification](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs).
Implementation mappings and completed Figma handoff: [terminal-implementation.md](terminal-implementation.md).

## Final checks

- `pnpm verify`: passed type checking, lint, **232 test files / 1,487 tests**, and
  the workspace build. The production desktop Vite/preload build also passed.
- Production Electron smoke: **66 checks passed**, including typed book/tape IPC,
  connected balance display, isolated profiles, six terminal tabs, blocked/unknown
  proposals, product linking, depth/trades selection, native fullscreen, and
  evidence-drawer keyboard focus and restoration.
- Existing production performance harness: warm shell **686 ms** against 1,500 ms;
  interaction p75 **8.9 ms** against 200 ms. Its deliberate regression control
  exceeded the budget as required.
- Exact depth query benchmark: 1,000 / 10,000 / 50,000 levels per side took
  approximately **4 / 22 / 117 ms** in the built main-process module. These are
  synthetic stress inputs, not trading evidence.
- **13 production captures** passed clipping/overflow audits: six bottom tabs,
  depth, recent trades, 1440 drawer, 1280 and 960 layouts, light and high contrast.
  Desktop chart/footer proportions and responsive screenshots were inspected.

Screenshots are in `docs/design/screenshots/terminal-2026-10-03/`. The visual harness
uses an isolated temporary profile with the scheduler disabled, so book/tape
screens truthfully show offline/unavailable data. Public completed Coinbase
history is read through the production channel. Live-stream correctness was
verified with deterministic protocol tests; these captures do not prove a live
exchange connection. Smoke catalog/connected-account inputs are test fixtures
passed through production adapters/contracts, not renderer DOM substitutions.

## Findings and limitations

Baseline type checking and lint passed. Obsolete assertions for the former
Simple/Advanced composition and palette were updated. The native fullscreen test
exposed a pre-existing Electron permission callback signature error; it was fixed
with an origin- and renderer-scoped fullscreen exception, covered by security
tests. Other browser capabilities remain denied.

Concurrent acquisition work briefly produced test-mock typing errors during
verification. Those files were left untouched; the final full verification passed
after that work settled. Existing backend/research changes were preserved.

The Vite build retains a large-chunk warning for the existing Ionic command
popover. The performance gate passes; no unrelated dependency rewrite was made.

Figma's Starter tool quota initially prevented the last responsive corrections
and implementation refinements from being synced back. After access was upgraded,
these were completed and visually reviewed on **2026-10-04**. The existing file
now includes corrected spacing, catalog fallback, campaign source selection,
fullscreen, and exploratory performance states. Structural review confirmed
editable layers, 835 component instances, IBM Plex Sans, and no image fills.
Reviewed exports are in `docs/design/screenshots/figma-terminal-2026-10-04/`.
No application code changed in that follow-up, so the runtime checks above retain
their original verification date.


## Responsiveness and trading activity verification — 2026-10-04

- `pnpm verify`: **245 files / 1,568 tests passed**, with typecheck, lint and
  workspace build passing. The separate production desktop build passed.
- Baseline chart polling removed **308 canvases in 8 seconds**. After the fix,
  a full 60-second native workload removed **zero**, with one **55 ms long task**
  (below the 200 ms stall gate),
  **zero unchanged extension evaluations**, and **0 px viewport drift** after
  zooming a saved drawing. Cold chart navigation was **357 ms**; cached navigation
  p75 **14 ms** against the 200 ms budget. The final dev workload measured
  cold **417 ms**, cached p75 **30 ms**, zero canvas removals, zero unchanged
  extension evaluations, **0 px viewport drift**, and no long tasks.
  Candle-aligned request keys reused one production history request and two dev
  requests (initial StrictMode mounts) across twelve cached navigations.
- Existing production performance gate: warm useful shell **230 ms** against
  1,500 ms; interaction p75 **8.4 ms**. Its deliberate 250 ms control failed
  as intended. Native Electron smoke passed, including six tabs, linked security,
  fullscreen, keyboard navigation and evidence-drawer focus restoration.
- FIFO tests cover multiple purchases, partial/full closes, proportional fees,
  embedded friction, tiny decimal quantities, duplicate fills, imported basis,
  missing marks and unknown broker fees. Persisted-source tests cover parallel
  source/wallet isolation, broker inventory mismatch, exploratory campaign
  separation/deduplication, scoped pagination, same-timestamp cache invalidation and read-only shared evaluations.
- Thirteen ordinary production Terminal captures passed overflow/clipping audits
  at desktop, 1440, 1280 and 960 widths and in light/high-contrast themes.
  Filled-position fixture captures at 1920/1440/1280 were inspected for Buy/Sell
  markers, dashed pending action, entry/P&L overlay and scrolling compact tables.
  Runtime captures are in `/tmp/coqui-terminal-activity-review/` and
  `/tmp/coqui-terminal-filled-review/`. Fixtures are isolated, synthetic facts;
  they do not establish live exchange connectivity or paper-account reconciliation.
- Figma desktop and responsive activity screens were visually reviewed against
  the supplied terminal reference. They remain editable component instances,
  vectors and text; no flattened screenshot substitutes for the specification.
- Impeccable detector: no findings on changed Terminal UI targets.

The first full run found five outdated source-location/channel-registry checks
caused by this change; those were updated and the complete rerun passed. No
pre-existing test failure remains. The existing Ionic large-chunk build warning
remains. Required build generation refreshed study source fingerprints; strategy
implementation and live-execution authority were unchanged.
