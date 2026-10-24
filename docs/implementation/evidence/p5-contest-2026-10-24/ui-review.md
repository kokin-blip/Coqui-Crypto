# Scoped UI handoffs

The Impeccable skill required independent finish and documenter handoffs. Both used fresh agents with no inherited build history. Their scope was the existing Research subsection, not a design-system replacement, application release or financial review. No agent changed application files or Linear.

## Initial finish review

**disposition: fix**

- **persistence:** PRODUCT/DESIGN and all nine initial captures present; 19 smoke checks pass; detector empty.
- **fidelity:** typography, material, ground and evidence hierarchy match; responsive scrolling/stacking is an adaptation; generated metric semantics and wrapped percentage contradict the financial readability requirement.
- **ceiling:** inherited table/disclosure/help/focus/theme conventions used; financial labels/readability unmet.
- **material_fixes:** distinguish equity/receipt/return scopes; label money-weighted annual dated IRR (ACT/365), period TWR and annualized CAGR; give long numbers deliberate precision without splitting digits/percent sign.
- **keep:** incumbent terminal, synthetic/unavailable/none states, reserve-within-equity explanation and read-only controls.

## Material correction and verdict

One source correction batch added reviewed financial labels, an annual-period explanation, four-place string truncation with explicit ellipsis, exact stored value/method tooltip and intact numeric spans. Calculations were unchanged. Final screenshot capture added settled instant scrolling and a rate-detail cut for narrow/zoom views; final native checks increased to 22.

Reviewer verdict:

1. **Resolved — financial labels and periods:** distinct equity/receipt scopes, period TWR and Money-weighted annual IRR (ACT/365); visible short-period/full-year explanation.
2. **Resolved — numeric readability:** `24.4749…%` intact in desktop/narrow/zoom; exact values and methods retained.

**disposition: ship**. This scores those two fixes only. No full application, empirical research, merge or release approval is implied.

## Documenter

Compared P5 against incumbent CapitalReplayResults, CapitalMetricValue, MetricInfo, metric-grid, terminal tables, themes and route styles; inspected all twelve final screenshots and passing smoke evidence. P5 is an ordinary Operate/Read extension. No durable system change is warranted.

`apps/desktop/PRODUCT.md` and `apps/desktop/DESIGN.md` match HEAD. Pre-existing drift is preserved: DESIGN uses older compact prose formatting and no `.impeccable/design.json` exists in this checkout. No sidecar or drift repair was introduced. The documenter changed no files. Its handoff and the finish verdict apply only to the local, uncommitted P5 extension.
