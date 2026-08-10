# UI/UX and motion brief

**Owner phase:** P5 — Shell and new UI  
**Priority order:** correctness → usability → responsiveness → visual energy

Coqui should feel like a focused, vibrant financial cockpit, not a casino and
not a static admin panel. Motion exists to explain state changes, preserve
spatial context, confirm an action, or direct attention to a new risk. It must
never imply market activity that did not occur or compete with a warning.

## 1. Product experience

- Use a calm neutral canvas with restrained luminous accents. Reserve strong
  color and motion for selection, confirmation, staleness, risk-stage changes,
  and newly arrived data.
- Keep decision-critical state continuously visible: data timestamp and
  staleness, paper/off/live mode, kill-switch state, active wallet, cost model,
  and evidence status.
- Put the answer before the decoration. A user should understand what changed,
  why it changed, the data behind it, and whether an action is possible without
  opening another screen.
- Never communicate profit/loss, risk, execution state, or validation outcome
  through red/green color alone. Pair color with sign, label, icon, and shape.
- Use tabular numerals and stable column widths for changing financial values.
  Do not count-up or roll digits for balances, P&L, prices, costs, or risk.
- Dense information is acceptable; ambiguous hierarchy is not. Offer compact
  and comfortable density tokens rather than shrinking isolated controls.

## 2. Information architecture

The strategy scoreboard remains the first screen and establishes the design
language for the rest of the application.

1. **Global status rail:** wallet, mode, kill switch, market-data freshness,
   background-job state, and last successful reconciliation.
2. **Decision summary:** current leader, readiness, risk stage, and plain-language
   reason to act or stand down.
3. **Comparable scoreboard:** hold plus active tracks with after-cost return,
   drawdown, Sortino, DSR, trial count, sample length, and provenance.
4. **Evidence view:** equity chart, confidence context, walk-forward result,
   negative findings, and immutable dataset/study references.
5. **Action area:** paper-only preview and guardrail explanations. Destructive or
   financial actions use a review step showing asset, side, notional, estimated
   cost, risk effect, and mode before confirmation.

Portfolio, allocation, tax, markets, paper, and settings reuse the same status,
table, provenance, empty-state, and error patterns. Navigation and keyboard
focus remain stable while data refreshes.

## 3. Motion language

Use three duration tokens based on the Windows/Fluent platform scale:

| Token | Duration | Use |
|---|---:|---|
| `motion-fast` | 83 ms | press, hover, focus, tiny indicator changes |
| `motion-standard` | 167 ms | menus, tooltips, row selection, local feedback |
| `motion-panel` | 250 ms | drawers, dialogs, route/content transitions |

Rules:

- Default to CSS transitions or the Web Animations API. Add a React animation
  dependency only after a measured prototype proves native motion insufficient
  and its bundle/runtime cost is recorded.
- Animate compositor-friendly `transform` and `opacity`. Avoid animating layout
  geometry (`width`, `height`, `top`, `left`) or paint-heavy effects in recurring
  interactions. Never use broad `transition: all`.
- Entering content starts promptly and eases to rest; exiting content gets out
  of the way. Use shared easing tokens, not bespoke springs per component.
- Motion stays local to the element or region that changed. Do not animate the
  whole dashboard because one quote, order, or risk value changed.
- A new quote or fill may receive one short opacity/background acknowledgement;
  it must not flash, bounce, translate the row, or restart continuously.
- Charts may animate interaction affordances such as selection and crosshair.
  Do not tween historical bars, performance curves, or backtest results: that
  makes exact financial data temporarily false.
- Skeletons are for initial structure only. Background refresh preserves the
  existing screen and shows a subtle freshness indicator instead of blanking or
  reshuffling content.
- No parallax, ambient particles, auto-scrolling tickers, looping glows, or
  attention-seeking motion around P&L. The mascot remains excluded by ADR-0004.

## 4. Reduced motion and accessibility

- Target WCAG 2.2 AA for renderer workflows.
- The static state is the default; enable nonessential motion only under
  `prefers-reduced-motion: no-preference`. Also provide an in-app **No motion**
  setting that can be more restrictive than the operating-system preference.
- Reduced/no-motion mode replaces movement with immediate state changes or a
  short opacity change. It preserves all information and confirmations.
- No auto-starting nonessential motion lasts longer than five seconds. Nothing
  flashes three times per second.
- All workflows are keyboard operable with logical focus order, visible focus,
  and no focus loss during query refresh or virtualized-list updates.
- Pointer targets are at least 24 × 24 CSS pixels or have the equivalent required
  spacing; primary and destructive actions should be larger.
- Dynamic financial changes use accessible status text/ARIA announcements only
  when the change is actionable. Do not announce every market tick.

## 5. Responsiveness and rendering budget

These are Phase 5 acceptance targets on the documented reference machine and a
production build, captured in a committed performance report:

- Interaction to Next Paint at the 75th percentile is **≤ 200 ms** across the
  scoreboard, portfolio table, chart controls, settings, and paper preview.
- Normal interaction and motion target 60 Hz. A performance trace must show no
  recurring layout thrashing or long renderer work caused by animation.
- The first useful shell appears within **1.5 seconds** on a warm start. Record
  the machine and dataset; compare future builds to the same baseline.
- Idle screens do not poll or animate independently. TanStack Query owns refresh
  cadence, deduplication, focus behavior, and cancellation.
- Research, backtests, reconciliation, CSV parsing, and other CPU-heavy work stay
  outside the main and renderer threads. Never use synchronous IPC or blocking
  I/O in an interaction path.
- Virtualize long tables and logs; keep row identity stable so a refresh does not
  remount or reanimate unchanged rows.
- Batch high-frequency visual updates to an animation frame and collapse obsolete
  intermediate states. Daily-bar screens should normally update far less often.
- Initialize chart series with `setData`, then use Lightweight Charts `update`
  for the newest bar. Do not replace the full series for each update.
- Bundle fonts and visual assets locally; no renderer CDN or network dependency.

Performance is measured, not inferred from visual smoothness. Phase 5 records
startup, interaction, animation-frame, renderer CPU, and heap traces before and
after optimization. Regressions beyond the agreed baseline fail the phase gate.

## 6. UI-kit deliverables

Before feature screens, `packages/ui-kit` provides:

- semantic color, typography, spacing, radius, elevation, density, and motion
  tokens with light/dark/high-contrast-safe combinations;
- buttons, inputs, tabs, tooltip/popover/dialog, toast/status, table, card,
  skeleton, empty/error state, provenance badge, risk badge, and freshness badge;
- a single chart wrapper that owns resize, theme, cleanup, incremental updates,
  crosshair synchronization, and reduced-motion behavior;
- accessible keyboard/focus behavior and examples for every interactive primitive;
- a motion test page showing default and no-motion modes side by side.

Feature code composes these primitives. It does not invent colors, easing,
durations, focus rings, loading treatments, or financial-number formatting.

## 7. Phase 5 verification

Phase 5 is not complete until:

1. The scoreboard passes task-based review: identify the leader, its evidence,
   the freshest data time, current risk stage, and why trading is blocked without
   documentation or hidden hover content.
2. Keyboard-only and 200% zoom workflows pass for every screen.
3. Automated tests prove reduced-motion mode suppresses nonessential motion and
   essential state remains visible without color.
4. Performance traces meet the budgets in §5 with representative chart and table
   datasets; a deliberate renderer-blocking regression fails the performance test.
5. Charts use incremental updates and remain responsive while panning, zooming,
   changing range, and receiving a refresh.
6. Loading, empty, stale, partial, error, and recovery states are designed and
   tested—not left as incidental component behavior.
7. Every displayed financial or research figure carries provenance as required
   by `ARCHITECTURE.md` §9.

## 8. Research basis

- [Microsoft Fluent 2 motion](https://fluent2.microsoft.design/motion): motion
  should be functional, quick, consistent, local to the focused element, and
  available in a no-motion mode.
- [Windows timing and easing](https://learn.microsoft.com/windows/apps/design/motion/timing-and-easing):
  platform duration tokens of 83/167/250 ms and consistent enter/exit easing.
- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance):
  profile repeatedly; avoid blocking main/renderer threads and synchronous IPC;
  offload sustained CPU work.
- [Chrome INP guidance](https://web.dev/articles/optimize-inp): responsive
  interactions target 200 ms or less and avoid layout thrashing/oversized DOMs.
- [Chrome animation performance](https://web.dev/articles/animations-and-performance):
  transform/opacity can stay on the compositor; layout and paint work consume the
  main thread.
- [W3C reduced-motion technique](https://www.w3.org/WAI/WCAG21/Techniques/css/C39)
  and [WCAG 2.2](https://www.w3.org/TR/WCAG22/): honor motion preferences,
  keyboard/focus behavior, contrast, and target-size requirements.
- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs/5.0):
  update the latest bar incrementally rather than replacing the entire series.
