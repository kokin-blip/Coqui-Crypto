disposition: fix

## Material actionable findings

1. **P2 — Give the selection and pagination controls the terminal's visible affordances and disabled state.** In all three captures, the study and capital selectors read as inline prose with a caret, and “Previous cells” and “Next cells” read as adjacent plain text. On page 1, disabled Previous has the same visible treatment as enabled Next. The component supplies no control class at lines 20, 33, 48, and 51 of `apps/desktop/src/renderer/app/CapitalProspectiveEvidence.tsx`; the shared route styling supplies dimensions but does not supply these controls' full appearance. Apply the existing compact terminal control treatment within `.capital-prospective`, including a framed selection field, distinct enabled/disabled pagination, hover, and the inherited visible focus ring. Keep the 4–6px radii, compact scale, and labels.
2. **P2 — Keep pagination context outside the horizontal table scroller.** In `narrow-light-full.png` and `contrast-zoom-full.png`, the wide modeled-cells table's centered caption is clipped to “Independently simulated capital and cost c…”. Its “page 1 of 9” and missing-metrics note are outside the initial horizontal view, while the Previous/Next controls below remain visible. Move the page indicator and missing-metrics context into a wrapping, left-aligned block outside the scroller, or provide equivalent persistent context beside pagination. Include a visible instruction that additional columns can be scrolled; the current instruction is available only through the region's accessible name. Preserve the semantic table caption and focusable scroll region.

## Craft and quality-bar checks

| Check | Result |
| --- | --- |
| TYPE | Matches the pinned compact IBM Plex terminal world; no decorative display typography or oversized metrics. |
| MATERIAL | Matches the flat software surface: restrained dividers and one panel boundary, without simulated physical material, gradients, or decorative shadows. |
| GROUND | Dark, light, and contrast captures remain within the incumbent semantic themes. No replacement visual world is introduced. |
| Hierarchy | Study identity and runtime limitation precede source coverage; the assessment precedes cell filtering and evidence; calculation and scope provenance remain disclosed below. |
| Evidence language | Sealed final outcomes/actions, unverified collector health, changed runtime identity, and insufficient assessment are explicit in text. The displayed full-period metrics remain “Unavailable”; modeled reserves/receipts and actual paper actions have separate labels. |
| Responsive composition | Narrative text and expanded provenance remain within the panel at narrow width and 200% zoom. The dense table retains horizontal scrolling. The clipped pagination context is finding 2. |
| States and interaction | Source provides loading/error notices, empty-state copy, explicit study/report selection, labeled native selectors, disclosures, focusable scroll regions, and disabled pagination semantics. The visible disabled treatment needs finding 1. |
| Craft floor | No kicker, decorative icon substitution, hero-metric template, nested card scaffold, or unsupported imagery appears. The principal remaining craft gap is the unfinished control treatment. |

## Evidence and scope limitations

- Reviewed the complete target-section captures `desktop-dark-full.png` (1440px viewport), `narrow-light-full.png` (640px viewport), and `contrast-zoom-full.png` (1280px viewport at 200%, approximately 640 CSS px). Each includes the section heading, full vertical table extent, pagination, and expanded calculation/scope provenance. No required capture is blank, malformed, or vertically incomplete; **recapture is not the disposition**.
- Inspected `CapitalProspectiveEvidence.tsx`, its Research placement, relevant inherited styles, `apps/desktop/PRODUCT.md`, `apps/desktop/DESIGN.md`, and the supplied craft floor. This is a code-led extension of the pinned world; there is no approved comp to reproduce.
- Reused the supplied one-time detector result (`detector.json`: `[]`) and `smoke.json` (all 11 named checks passed; no renderer errors). No second detector, browser session, new capture, or application/source edit was performed for this review.
- The screenshots use disposable synthetic evidence with 1970 study dates, stubbed providers, and disabled scheduling. Unavailable metrics and sealed outcomes are intentional states. The review does not validate financial calculations, statistical claims, research qualification, elapsed prospective evidence, owner approval, release readiness, or P5-H/P6-G/H completion.
- Static captures do not establish hover behavior, exact contrast ratios, assistive-technology behavior, or every loading/error/reviewed-report state. Source and smoke evidence support the interaction assessment only to their stated extent. The surrounding fixed shell and other Research panels are outside this component review.

## Verdict

**Fix the two UI findings in one scoped batch, then return the same three capture paths for a verdict pass on those fixes.** Preserve the source-quality-first reading order, explicit sealed and unavailable states, independently simulated small-capital rows, read-only contract, and full provenance. No rebuild is required.
