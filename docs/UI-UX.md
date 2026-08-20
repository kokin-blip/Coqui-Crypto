# UI/UX and motion brief

**Owner phase:** P5 — Shell and new UI  
**Priority order:** correctness → usability → responsiveness → visual energy

Coqui should feel like a focused, vibrant financial cockpit, not a casino and
not a static admin panel. Motion exists to explain state changes, preserve
spatial context, confirm an action, or direct attention to a new risk. It must
never imply market activity that did not occur or compete with a warning.

## 0. Visual authorship and library policy

The interface must look purpose-built for Coqui's decisions and evidence, not
assembled from a generic dashboard prompt or a fashionable component demo. This
subjective goal is enforced through concrete review rules:

- Begin with the user's task and the real data shape. Produce low-fidelity
  wireframes for the scoreboard, portfolio, and paper-order review before visual
  styling or component selection. Each region must answer a named user question.
- Establish one visual grammar in `ui-kit`: typography, spacing, density,
  borders, radii, elevation, color, icons, and motion. Feature screens may not
  introduce local substitutes for those decisions.
- Use hierarchy, alignment, dividers, and whitespace before putting every value
  in a rounded card. Avoid the generic SaaS/AI-template combination of nested
  card grids, excessive pills, glass panels, large gradients, ambient glows,
  decorative charts, and oversized empty space.
- Prefer domain-specific tables and comparison layouts over interchangeable
  dashboard tiles. Financial numbers align on the decimal, use tabular numerals,
  keep units visible, and expose provenance without relying on hover.
- Use one locally bundled text family and one icon family after license review.
  Unfamiliar actions keep a text label; icons are not decorative filler.
- Write concise, specific interface copy. Do not use generic slogans, synthetic
  enthusiasm, fake conversational personality, or vague labels such as
  "Optimize" when the action has a precise financial meaning.
- Create loading, empty, stale, partial, error, blocked, and success states from
  actual Coqui scenarios. Do not use stock illustrations or generic generated
  copy as a substitute for explaining the next safe action.
- Review static screenshots together at low fidelity, after token application,
  and after the first production-build implementation. The review set includes
  light, dark, high-contrast, compact density, 200% zoom, stale data, negative
  evidence, and a blocked paper action. User approval is required before the
  visual language is propagated to every screen.

The supplied
[Awesome CSS Frameworks and UI Libraries catalogue](https://github.com/gabrielizalo/Awesome-CSS-Frameworks-and-UI-Libraries)
is a discovery source, not a dependency or a license grant for the projects it
links. Before adopting code or assets from any entry, verify that project's own
license, maintenance status, React 19 compatibility, bundle impact, CSP behavior,
accessibility record, and transitive dependencies.

Coqui will not mix several styled component packs. Tailwind remains the styling
engine and Coqui owns the visual tokens. Phase 5 starts with a small primitive
spike rather than a wholesale theme installation:

| Candidate | Use in the spike | Decision posture |
|---|---|---|
| [Base UI](https://base-ui.com/react/overview/about) | Unstyled dialog, popover, tooltip, menu, select/combobox, tabs, field, and toast behavior | **Preferred candidate** — React-compatible, headless, composable, Tailwind-compatible, and accessibility-focused |
| [React Aria Components](https://react-spectrum.adobe.com/react-aria/getting-started.html) | Same interaction set, plus complex collection and form behavior | **Fallback** if its tested keyboard, internationalization, or collection behavior materially exceeds Base UI |
| [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) | Compatibility fallback for any interaction the first two cannot meet safely | **Fallback**, not a second simultaneous primitive layer |
| Blueprint, Fluent, and Adobe Spectrum | Study dense desktop hierarchy, motion, keyboard, and status patterns | **Reference only**; do not import their recognizable full visual themes |
| shadcn/ui, daisyUI, Flowbite, Preline, MUI, Ant Design, Chakra, and similar styled kits | Compare coverage and implementation ideas | **Do not adopt wholesale**; their default visual grammar would replace Coqui's and recreate a template look |

The spike implements a representative settings form, dense scoreboard table,
menu/tooltip, and destructive paper-action dialog inside the Electron/Vite/Tailwind
stack. It must test keyboard traversal, focus return, 200% zoom, high contrast,
reduced motion, portaled overlays under the CSP, production bundle cost, and
renderer performance. Select exactly one primitive layer, pin it under the
dependency policy, and record the decision in an ADR. If none passes, implement
the small required set from native elements and WAI-ARIA patterns instead.

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

### 3.1 Buttons and action responsiveness

Every interactive action uses an explicit visual state model:
`idle → pressed → pending → succeeded | failed | blocked | unknown`. Components
may omit states that cannot occur, but they may not collapse pending, blocked, or
unknown into a generic disabled appearance.

- Hover, focus, keyboard activation, and pointer press receive visible feedback
  within the next rendered frame. Press feedback uses the `motion-fast` token and
  compositor-safe color/opacity/transform changes without moving adjacent content.
- Buttons reserve enough inline space for their pending treatment. Replacing a
  label with a spinner must not change button width, move nearby controls, or
  cause focus loss. Keep the action label available to assistive technology.
- A fast operation keeps the immediate pressed acknowledgement and avoids a
  spinner flash. Longer work exposes a stable pending label such as
  "Refreshing prices" or "Preparing preview", not an indefinite unlabeled
  loader. Research jobs show durable progress/status outside the initiating button.
- Prevent duplicate activation while one non-idempotent command is pending.
  Disabling repeat submission must not trap focus, hide the action, or imply that
  unrelated parts of the screen are unavailable.
- Optimistic updates are allowed only for easily reversible presentation state,
  such as marking an alert read. Portfolio mutations, credential changes, paper
  orders, kill-switch changes, exports, and destructive actions render success
  only after the service confirms it.
- Financial commands distinguish confirmed failure from an ambiguous `unknown`
  outcome. Never animate an assumed fill, balance, position, or success checkmark
  while the command result is pending or unknown.
- Success acknowledgement is brief and local, then settles into the new durable
  state. Failure and blocked states persist until understood or dismissed and
  include a safe reason plus a concrete next action. Toasts may supplement but
  never replace inline action status.
- Keyboard and pointer activation produce equivalent state and timing. Escape or
  Cancel remains available where cancellation is real; the UI never promise-cancels
  work that the service can no longer stop.
- Reduced/no-motion mode removes scale and movement while preserving immediate
  border, fill, icon, and text feedback. Forced-colors mode preserves every state
  without depending on shadows or translucent fills.

The production performance harness records input-to-pressed-feedback and complete
Interaction to Next Paint for representative buttons, menus, tabs, table actions,
paper previews, and dialogs. Pressed feedback must appear within one animation
frame when the renderer is healthy; the existing p75 INP ≤200 ms budget remains
the end-to-end gate. A test introduces main-thread pressure and fails if action
feedback freezes, queues duplicate commands, or visually reports an unconfirmed
financial outcome.

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
8. A heuristic review covers visibility of system status, user control, error
   prevention, recognition over recall, consistency, and task-focused minimalism.
9. The screenshot review set in §0 is approved, has no unreviewed component-pack
   defaults, and shows a coherent Coqui-specific visual grammar across the three
   prototype workflows.
10. Action-state tests cover pointer and keyboard activation, pending de-duplication,
    stable layout/focus, confirmed success, safe failure, blocked and unknown
    outcomes, plus reduced-motion and forced-colors rendering. Financial actions
    have no optimistic-success path.

## 8. Research basis

- The supplied [Awesome CSS Frameworks and UI Libraries
  catalogue](https://github.com/gabrielizalo/Awesome-CSS-Frameworks-and-UI-Libraries)
  is the discovery index for Phase 5 screening. Its React list includes headless,
  styled, desktop-dense, and unmaintained options, so each linked project is
  evaluated independently rather than inherited as a package set.
- [Nielsen Norman Group's usability
  heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) ground
  the task review in visible status, user control, error prevention, recognition
  over recall, consistency, and focused rather than ornamental minimalism.
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) supplies the
  semantic and keyboard contracts for custom widgets. A component library helps
  implement them but does not replace application-level accessibility testing.
- [Base UI's accessibility guidance](https://base-ui.com/react/overview/accessibility)
  and [React Aria's component model](https://react-spectrum.adobe.com/react-aria/getting-started.html)
  motivate the headless-primitives-first spike: behavior and focus management
  can be reused while Coqui retains complete control of its visual identity.

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
