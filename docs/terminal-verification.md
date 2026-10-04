# Trading terminal verification — 2026-10-03

Design: [Editable Figma specification](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs).
Implementation mappings and remaining Figma polish: [terminal-implementation.md](terminal-implementation.md).

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

Figma's Starter page/tool quotas prevented the last responsive spacing corrections
and implementation refinements from being synced back. The editable specification
and reusable library are saved; the precise outstanding items are recorded in the
implementation handoff.
