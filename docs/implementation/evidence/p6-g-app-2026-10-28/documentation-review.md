# P6-G app integration: design documentation review

Date: 2026-10-28. Role: shipped `impeccable_documenter`.

**Result:** the finished P6-G panel is an ordinary extension of the incumbent Operate terminal. Preserve `apps/desktop/PRODUCT.md` and `apps/desktop/DESIGN.md` unchanged. No `.impeccable/design.json` exists at the repository or desktop-app root; this pass does not create one. The only file written by this pass is this review.

## Prompt used

> Ok continue building P6-G’s app integration and the remaining unblocked work. Preserve completed work and the full P0–P7 scope, keep unmet evidence gates pending, and update the phase tracker.

## Authority and boundary

Read the installed `agents/impeccable_documenter.toml` and the complete `reference/document.md` under the Impeccable 4.3.1 skill. The supplied direction is an ordinary Operate extension: dense neutral data, compact controls, a named keyboard-operable scroll area, explicit pending/unavailable/unknown states, and distinct objective, proposal, order, settlement, and reserve actions. There is no new visual world, approved system change, or separate comp to carbonize. The documenter's ordinary-extension instruction applies: preserve the incumbent system and report existing drift without repairing it.

The Figma URL in the incumbent files was treated as an authority pointer, not inspected or claimed as a pixel-comparison source. This review compares the finished local implementation with the supplied product/design files and captured terminal evidence.

## Evidence checked

- Incumbent contract: `apps/desktop/PRODUCT.md` and `apps/desktop/DESIGN.md`; both have no local diff.
- Finished surface: `apps/desktop/src/renderer/app/PaperReserveSale.tsx`, its `styles/paper-reserve-sale.css`, and the integration in `PaperProfitReserves.tsx`.
- Inherited treatment: `styles/base.css`, the reserve/terminal rules in `styles/terminal.css`, and `packages/ui-kit/src/theme.css` for type, density, neutral surfaces, borders, accents, focus, and theme behavior. The checked legacy density/radius values also exist in `HEAD`.
- Nine final scoped captures in `ui/`: `desktop-dark.png`, `desktop-dark-consequence.png`, `desktop-dark-validation.png`; `narrow-light.png`, `narrow-light-consequence.png`, `narrow-light-validation.png`; `contrast-zoom.png`, `contrast-zoom-consequence.png`, `contrast-zoom-validation.png`. All nine were visually inspected. The consequence captures are naturally scrolled views, not full-page captures.
- `finish-review.md`, `finish-verdict.md`, and `ui/smoke.json`. The final smoke packet identifies synthetic data, no account access, a disabled scheduler, 18 passing checks, no renderer errors, and zero order/reserve/lifecycle side effects. These are recorded packet results, not tests rerun by this documenter.

## Finished-build comparison

| Incumbent commitment | Finished evidence | Finding |
| --- | --- | --- |
| Near-black neutrals, restrained accent, flat terminal material | New styles reuse the existing border, accent, muted-text and surface tokens; dark captures retain the neutral field. Light and high-contrast captures follow existing theme tokens. | Preserved; no new palette or decorative material. |
| IBM Plex Sans, compact controls, tabular figures, small corners | Typography and controls inherit the terminal/base rules; sale inputs have a 32px minimum, inherited reserve buttons use 32px minimum and 4px corners, and table figures use tabular numerals. | Preserved; no independent type ramp or card system. |
| Responsive panels and scrollable dense financial tables | Existing auto-fit objective fields adapt from five columns to two in the supplied narrower/zoomed views. Candidate overflow stays inside a focusable, explicitly named region with table caption and row/column headers. | Preserved; clipped trailing table columns remain available through intentional horizontal scrolling. |
| Evidence-first uncertainty, keyboard use, explicit status labels | Default-collapsed native disclosure, visible readiness/gate explanations, loading/unavailable notices, command status announcements, expiry/unknown handling, and visible focus treatment appear in source/captures. | Preserved; unpictured lifecycle states were checked in source only. |
| Missing/stale figures never become fabricated zero balances | Display-only decimal formatting keeps `Unavailable`; two-decimal USD and up-to-eight-decimal quantity displays mark rounding with `≈`, while labeled exact native amounts remain in disclosures. | Preserved; precision is made reviewable without changing calculations. |

Both scored material fixes are resolved in `finish-verdict.md` and supported by the amended source and final captures: bounded amounts retain exact disclosures, and touched invalid objective fields receive schema-associated `aria-invalid`/`aria-describedby` feedback with eligible-holding recovery. Neither fix creates a new reusable visual-system rule. The optional modeling flow, proposal preparation, paper-order confirmation, settlement reassessment, and independent reserve allocation retain their distinct purposes.

## Five-line system summary

1. Palette: existing dark neutral surfaces/charcoal dividers and restrained Coqui accent; light and contrast modes inherit the established theme tokens.
2. Type ramp: inherited IBM Plex Sans at the terminal's compact 12–14px scale, modest heading emphasis, and tabular financial numerals.
3. Density and shape: compact terminal controls, small 4px control corners, inherited responsive field grid, and bounded dense-table overflow.
4. Existing depth guardrail: avoid decorative gradients, shadows, and oversized cards; the new surface adds none.
5. Existing evidence guardrail: missing or stale amounts stay explicit; financial state and action status remain legible in text.

## Existing drift left untouched

The incumbent `DESIGN.md` is a concise legacy document without the current reference's canonical section/token-frontmatter structure, and no design sidecar is present. Its 28–32px control and 4–6px radius summary does not cover every existing global value: `base.css` already sets a 36px control minimum, while the UI kit already defines medium/large radius tokens at 7px. Those inherited values are not new P6-G decisions, and this panel uses its own 32px minimum and inherited 4px control corners. These gaps are reported, not normalized into new guidance or repaired. No craft-floor refusal or defect was promoted into a system token or rule.

## Scope of completion

System preservation is complete for this local ordinary extension. The finish verdict's `ship` disposition covers its two scored fixes only. It provides no owner, economic, qualification, connected-account, merged/released, or release approval. Unmet evidence gates and the full P0–P7 scope remain pending as applicable; this documentation pass changes none of them. The parent task owns the phase-tracker and corresponding Linear progress update, including this evidence.
