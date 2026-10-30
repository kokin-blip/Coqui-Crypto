# Prompt used

## Original brainstorm request

> I want to keep this Ui feature and its two tabs, but i'd rather have the main tab be something related to the algorithm. like its recent trades and recent gains and losses or stuff like that. help me brainstorm

## Scope selection and planning request

> Lets go with Algo Activity and Order Book. Make Algo Activity the default with the gains/losses summary and recent algorithm trades, keeping the same compact style. WE can also add performance somewhere small in the order book tab. I also like your tiny cumulative profit/loss chart idea. Develop a comprehensive plan to implement this. Use the UI kit from figma.

## Planning answers that changed or confirmed scope

- Trade scope: `All assets (Recommended)`.
- Time window: `7 days (Recommended)`.
- P/L chart: `1, with an option for 2` (closed P/L by default, optional total P/L).
- Recent trades: `Group by order (Recommended)`.
- Total P/L history and account attribution: `1, and make sure it shows which account / wallet its reffering to, add a filter to chosoe which wallet and such as well.`

## Implementation request (verbatim)

```markdown
PLEASE IMPLEMENT THIS PLAN:
# Algorithm Activity panel with compact performance tracking

## Summary

Replace the existing **Order Book / Recent Trades** panel with exactly two tabs:

- **Algo Activity** — default; gains/losses summary, cumulative P/L chart, and recent algorithm trades.
- **Order Book** — existing market depth, plus a small algorithm-performance strip.

Preserve the compact terminal layout and use the existing [Coqui Figma UI kit](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs).

Confirmed defaults: **all assets**, **7D**, **closed P/L**, trades **grouped by order**, and explicit **source/account/wallet filters**. Total P/L is an optional chart mode using existing recorded valuations.

## Interface and interactions

### Shared context and filters

- Reuse the terminal’s selected paper source and wallet state. Changing either here updates the existing terminal controls, positions, and algorithm views.
- Display the source and account/wallet name beside the results. Use existing nicknames, with a masked account identifier where needed to distinguish accounts.
- Offer only accounts attributable to the selected source. Combined simulations display **Combined simulation** and do not imply individual wallet attribution.
- Default to **All assets**, with a **Selected market** option following the main chart’s instrument.
- Provide **Today / 7D / 30D / All** controls. Today follows the app’s local timezone; 7D and 30D are rolling windows.
- Preserve filters while switching tabs. Fresh workspace mounts start on Algo Activity with the confirmed defaults.

### Algo Activity layout

Keep the following order within the existing panel:

1. **Compact controls and scope label.** Source/account selection, asset scope, and time window; wrap controls within the panel at narrow widths.
2. **Four small metrics in a two-column grid:** realized net P/L for the selected window, open P/L now, winning/losing exits, and executed-order count. Keep labels explicit about the different time bases.
3. **Tiny cumulative P/L chart**, approximately 80px tall, with **Closed / Total** controls, a zero reference, and an inspectable timestamp/value.
4. **Recent trades**, using approximately 28–32px rows and internal scrolling.
5. **Refresh/evidence timestamp and status**, distinguishing paper activity from market-feed connectivity.

Recent trade rows show **asset and side**, **latest execution time**, and **realized P/L or execution status**. Clicking the asset selects that instrument in the main chart. A separate disclosure expands quantity, weighted average execution price, fees, fill status, individual fills, account attribution, and any linked recorded decision reason.

Only orders with recorded fills appear. Pending proposals remain in their existing terminal view. Buying does not create realized profit; buy rows show their recorded execution status.

Load 20 grouped orders initially and provide **Older trades** and **Latest trades** controls. Retain expanded rows and reading position during refresh.

### Order Book layout

- Preserve the market selector, price aggregation, bid/ask rows, midpoint, depth shading, and existing feed states.
- Add a compact performance strip above the existing footer: **realized P/L · open P/L**, accompanied by the selected account/source, asset scope, and period.
- Reuse the same performance response as Algo Activity. Make the strip keyboard actionable to return to that tab with filters intact.
- Keep Coinbase connectivity and timestamps separate from algorithm-performance freshness.
- Remove the public Recent Trades tab from this panel; preserve its underlying channel wherever still used.

## Data, calculations, and interfaces

### Read projections

Extend the existing trading-activity pipeline rather than calculating financial results in React.

- Add `trading.activity.overview`: selected source, wallet/account, asset scope, period, and timezone in; scoped metrics, chart series, latest grouped orders, coverage, attribution, and timestamps out.
- Add cursor-paginated `trading.activity.orders` for older grouped executions and a scoped order-detail read for fill expansion.
- Extend `trading.activity.scopes` with the supported account/wallet choices for each source, avoiding invalid source/account combinations.
- Reuse the existing storage readers and FIFO position projection behind these reads. Leave existing summary/trail contracts compatible.
- No database migration, new valuation recorder, or background collection job is expected.

### Financial rules

- Replay complete available fill history before applying the display window so earlier purchases retain their correct cost basis.
- Retain decimal arithmetic, fee-inclusive FIFO basis, and existing spread/slippage treatment. Convert to numeric chart coordinates only after financial calculations.
- Realized net P/L sums closing-fill outcomes in the selected window. Open P/L represents current remaining holdings for the selected asset/account scope.
- Group fills by source, account, instrument, and recorded order identity. A fill without an order ID remains its own expandable execution.
- For orders crossing the window boundary, row totals and outcomes reflect in-window fills; expansion distinguishes those from lifetime order totals.
- Count winning/losing **sell orders** from their aggregate in-window realized P/L. Label these as exit outcomes rather than completed round trips; show breakeven and unknown outcomes in the detail.
- Preserve partial-fill and cancellation states from recorded evidence. Never infer a completed order from a fill alone.
- Missing fees, unknown opening basis, balance mismatches, or incomplete history keep affected totals unavailable. Known subtotals may appear only with an explicit partial label.
- Read latest executions independently of any historical processing cap, so incomplete cost-basis history cannot silently make the recent-trades list outdated.

### Cumulative chart

**Closed mode — default**

- Start at zero at the selected window boundary and accumulate net realized P/L from closing fills.
- The final value must equal the realized-summary metric.
- Aggregate simultaneous timestamps deterministically. A confirmed period without closes can show a flat zero line; missing history cannot.

**Total mode — optional**

- Use existing source-specific position valuations and attributable fill history.
- Calculate the change in realized plus unrealized P/L from the first valid recorded valuation within the window; display that effective starting timestamp.
- Require at least two valid observations. Show an explanatory unavailable state when account attribution, basis, valuations, or opening/cash-flow evidence is insufficient.
- Never substitute whole-account equity for algorithm P/L when unrelated holdings or funding changes cannot be separated.
- Preserve missing intervals as gaps. Do not reconstruct old valuations from current prices or start new recording.
- Support each source according to its evidence: ledger valuation records, exploratory campaign observations, and parallel Coqui/Alpaca account marks. Unsupported wallet/asset combinations remain explicitly unavailable.

Bound each returned chart to 256 observations, preserving endpoints, extrema, and gaps. Reuse existing chart lifecycle utilities and installed charting dependencies for a small dedicated chart; avoid the full-size performance chart’s toolbar and height.

### Refresh and isolation

- Query the overview once in the parent and share it between tabs.
- Use centralized five-second foreground refresh with two-second stale time, matching the existing activity summary cadence. Cache historical calculations by source/account and database revision.
- Older pages and expanded details load on demand; tab switching must not duplicate performance polling.
- Include every filter in query/cache identity. Clear pagination and detail selection when scope changes, cancel superseded reads, and preserve the existing profile-reset isolation.
- Keep market-depth refresh independent.

## Figma styling and verification

Use the inspected Figma components: **Panel `3:64`**, **Tab `3:30`**, **Dropdown `3:56`**, **Badge `3:46`**, **Table Header/Row `3:70` / `3:72`**, and **Book Row `3:74`**.

Compose existing `CoquiComponents`, `TerminalTabs`, financial formatters, and theme tokens. Extend primitives only where necessary. Preserve IBM Plex Sans, tabular numerals, charcoal borders, small radii, restrained green/red outcomes, and the current 340px desktop panel width. Avoid large metric cards or decorative chart fills.

Implementation sequence:

1. Add and verify financial projections and typed reads.
2. Integrate shared context, filters, grouped trades, and details.
3. Add both chart modes and the Order Book performance strip.
4. Verify against Figma and the existing terminal at desktop and stacked widths.

Required checks:

- **Financial:** fee allocation, FIFO entries before the window, partial closes, duplicate fills, mixed-profit order fills, unknown fees/basis, missing valuations, and funding/attribution exclusions.
- **Isolation:** all four paper sources, account/wallet switching, combined simulations, asset changes, profile changes, equal-time pagination, late responses, and detached-writer updates.
- **Consistency:** summary/chart endpoint agreement, Order Book strip agreement, grouped-row totals, and range-boundary behavior.
- **UI:** default tab, keyboard tabs and filters, expandable fills, chart keyboard inspection, older/latest navigation, loading/empty/error/stale/partial states, and unavailable Total mode.
- **Visual/performance:** 1920, 1440, 1280 and narrow stacked layouts; 200% zoom; light/dark/high-contrast themes; bounded rendering and query counts. Confirm bids, asks, midpoint, and aggregation still work.
- Run focused suites, repository typecheck/lint/tests/build, and the applicable terminal smoke/performance checks. Record source and screenshots used for comparison.

## Delivery and boundaries

Preserve existing unrelated working-tree changes. This feature adds read-only presentation; strategy behavior, execution permissions, and valuation-collection cadence remain unchanged.

Update [COQ-33](https://linear.app/coqui-crypto/issue/COQ-33) during implementation with this selected scope, both exact user prompts, relevant follow-up choices, verification, and commit/PR evidence. Keep review and release gates open until satisfied; completion comments end **Completed by: kokin**.

This planning pass made no repository or Linear changes. Synchronizing the revised plan to COQ-33 remains pending.
```
