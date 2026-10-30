# P7 prospective evidence UI documentation check

Date: 2026-10-28. Result: **ordinary extension of the incumbent terminal system; no system-file change required.**

This check follows Impeccable's documentation handoff for the completed read-only prospective evidence panel. The delegated write scope is this file only. `apps/desktop/PRODUCT.md`, `apps/desktop/DESIGN.md`, application code, any sidecars, roadmap records and tracker records are preserved.

## Evidence checked

- Pinned context: `apps/desktop/PRODUCT.md` and `apps/desktop/DESIGN.md`, resolved by `impeccable context --target apps/desktop/src/renderer/app/CapitalProspectiveEvidence.tsx`.
- Implementation: `CapitalProspectiveEvidence.tsx`, `Research.tsx`, and `styles/capital-prospective.css` under `apps/desktop/src/renderer/`.
- Incumbent implementation: renderer `styles/base.css`, `styles/terminal-routes.css`, relevant `styles/terminal.css` table/control rules, and `packages/ui-kit/src/theme.css`.
- Finished complete-section captures: [desktop dark](desktop-dark-full.png), [narrow light](narrow-light-full.png), and [high contrast at 200% zoom](contrast-zoom-full.png). These are the replacement captures scored by the final verdict.
- [Full finish review](finish-review-full.md), [fix-list verdict](finish-verdict.md), [supplied smoke evidence](smoke.json), and the supplied one-time [detector result](detector.json).

The supplied detector result is `[]`. The supplied smoke evidence records 11 passing checks and no renderer errors, with synthetic data, stubbed providers and disabled scheduling. These results were inspected and reused; this documentation check did not rerun the detector, launch the application or create captures.

## Comparison with the incumbent system

| Area | Finding |
| --- | --- |
| Typography and density | The panel inherits IBM Plex Sans, tabular numerals and the Research route's compact heading, body and table scales. It adds no font family or type scale. |
| Color and material | Controls use the existing `--coqui-text`, surface, border, muted-text and accent tokens. The panel retains flat surfaces, subtle dividers and the existing dark/light/high-contrast themes. It adds no palette primitives, shadows, gradients or imagery. |
| Shape and controls | Scoped selectors and pagination use the established compact framed control treatment, 4px corners, visible focus outline, hover surface and dashed disabled-button treatment. Labels remain visible and associated with native selectors. |
| Layout and responsive behavior | The panel remains in Research's existing evidence stack. Wide semantic tables use a focusable horizontal scroll region; narrative, pagination context and the visible scroll instruction wrap outside it. Provenance hashes wrap at narrow widths. |
| Evidence hierarchy | Explicit study selection precedes coverage and accessible reports. Final coverage/actions stay visibly sealed or unverified. Requested-period metrics display `Unavailable` when missing; last-acquired balances and action/cost totals have separate context. |
| Interaction vocabulary | Native selection, disclosures, table regions and pagination extend existing patterns. Source uses read channels and local selection/filter/page state; no lifecycle, order, withdrawal or other financial command is exposed by this panel. |

The finished captures support continuity with the pinned compact terminal world. The reviewed UI does not establish a replacement visual direction or a new reusable system primitive. Its study/report selection, sealed-outcome wording and requested-period metric context remain feature-specific behavior rather than new global design rules.

## System-file decision and pre-existing drift

**No change to `PRODUCT.md`, `DESIGN.md` or a design sidecar is required for this extension.** The product's evidence-first research purpose, explicit uncertainty, disabled live orders, theme support and keyboard-operable dense tables already cover the surface. Existing terminal tokens and components supply its visual vocabulary.

The existing `apps/desktop/DESIGN.md` is a short prose design record. It does not use the current Impeccable document playbook's YAML token frontmatter or canonical eight-section structure. No `.impeccable/design.json` sidecar was found in the repository or desktop app context; the repository's existing `.impeccable/review/` contains review images. These are pre-existing documentation-format/coverage gaps, not visual drift introduced by this panel. They were reported without migration, regeneration or repair. The pinned Figma authority link was retained as context; this check did not inspect or reconcile that remote file.

## Finish status and limits

[The finish verdict](finish-verdict.md) marks both material findings from the full review resolved: framed controls with a distinguishable disabled state, and pagination/missing-metric context outside the scroller. Its `disposition: ship` applies only to that fix list. This documentation check carries that bounded result forward; it is not a new general design audit or release approval.

The captures contain disposable synthetic evidence with 1970 study dates. Static images do not establish exact contrast ratios, screen-reader behavior, hover behavior or every loading/error/reviewed-report state. Source and supplied smoke evidence support only the behavior they cover. Financial calculations, statistical validity, qualification, owner approval, elapsed prospective evidence, installation/release status and surrounding Research panels remain outside this check.

The completed P0–P7 history is preserved. P5-H and P6-G/H remain pending, as do all unmet owner, elapsed-evidence and release gates. This handoff makes no claim that P7 is merged, released, enrolled or qualified.
