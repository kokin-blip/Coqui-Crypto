# Advanced workspace fidelity QA — 2026-08-30

## Scope

This review covers the Advanced workspace shell and the Overview Research Grid at 1536 × 1024, plus compact density, 200% zoom, light, high-contrast, stale-data, negative-evidence, and major-route captures. Simple mode is included as a regression check.

## Visual comparison

- Reference: the owner-supplied Research Grid mockup.
- Implementation: `docs/design/screenshots/review-2026-08-30-advanced-fidelity/research-grid-dark.png`.
- Side-by-side artifact: `docs/design/qa/advanced-comparison.png`.

The implementation now matches the reference's near-black green canvas, compact 164 px navigation, full-width selected route, two-level operational header, bordered status modules, three-column Overview hierarchy, fixed panel headers, compact tables, and emerald/amber/coral status vocabulary.

The implementation intentionally differs where the reference contains illustrative evidence. Coqui continues to show verified empty states for equity history, leader selection, strategy comparison, activity, proposals, and provenance. Chart rendering and indicators remain outside this pass.

## Clipping and responsive verification

- Validation dots are non-shrinking and live inside padded semantic containers.
- Text-bearing panel bodies use natural height, safe wrapping, and `min-width: 0`.
- Strategy comparison preserves its table chrome and renders empty evidence as a table row.
- Portfolio and Paper subroutes are available through persistent route-local tabs.
- The descendant-bounds audit checks clipping ancestors in addition to scroll bounds and includes markers, icons, and status labels.
- The 200% zoom capture preserves semantic panel order without horizontal page scrolling or overlapping text.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: populated financial-chart fidelity remains a later, explicitly deferred pass.

## Result

final result: passed
