# P6 UI documentation check

Date: 2026-10-24. Mode: Operate. Disposition: ordinary-extension persistence passes; system documents unchanged.

## Scope and authority

This is a code-led extension of the existing Allocation terminal. It does not establish a new visual world or approve a design-system change. The shipped `agents/impeccable_documenter.toml` and `reference/document.md` were read. Their ordinary-extension rule applies: preserve incumbent system documents and report inherited drift without repairing it unasked.

The durable authority remains `apps/desktop/PRODUCT.md` and `apps/desktop/DESIGN.md`, with the P6 implementation plan defining this surface's requirements. The existing Figma reference was read as a reference in those documents; no fresh Figma fidelity comparison was performed. No concept comp, concept-roll persistence gate, new design tokens, or sidecar generation is required for this extension.

## Final artifact and evidence checked

Source and system files:

- `apps/desktop/PRODUCT.md`
- `apps/desktop/DESIGN.md`
- `apps/desktop/src/renderer/app/PaperProfitReserves.tsx`
- `apps/desktop/src/renderer/app/Allocation.tsx`
- `apps/desktop/src/renderer/styles/terminal.css`
- `apps/desktop/src/renderer/styles/base.css`
- `apps/desktop/src/renderer/styles/data-visualization.css`
- `packages/ui-kit/src/theme.css`
- `docs/implementation/small-portfolio-p6-implementation-plan-2026-10-24.md`

Review and verification records:

- `docs/implementation/evidence/p6-paper-2026-10-24/ui/finish-review.md`
- `docs/implementation/evidence/p6-paper-2026-10-24/ui/finish-verdict.md`
- `docs/implementation/evidence/p6-paper-2026-10-24/ui/smoke.json`

All six final screenshots were visually inspected:

| File in this directory | Observed evidence |
| --- | --- |
| `desktop-dark.png` | Default-off simulation identity, tracking/cut/expiry copy, flat financial metric cells, operational policy and separate action controls. |
| `desktop-dark-policy.png` | Bounded available actions; dashed disabled allocation/release; readable cap labels, unavailable floor, trade-plan recovery, separate release, and provenance disclosure. |
| `narrow-light.png` | Existing light theme; wrapped identity/provenance text and single-column financial metric cells. |
| `narrow-light-policy.png` | Two-column labeled policy fields, wrapped action row, readable consequence timestamp and unavailable metrics. |
| `contrast-zoom.png` | High-contrast theme at the packet's 200% zoom; wrapped status/evidence copy and single-column financial cells. |
| `contrast-zoom-policy.png` | High-contrast, enlarged policy labels/inputs with two-column reflow and readable explanatory copy. |

These are scrolled section captures, not full-page or all-state coverage. The narrow and zoom policy images do not show the entire consequence/release section. Setup is evidenced by the source and supplied keyboard smoke record rather than a separate setup screenshot. This pass read `smoke.json`; it did not rerun the application, exercise financial commands, or independently reproduce its assertions.

## Comparison with the incumbent system

The final component is placed after the existing feasibility and preview-reserve sections in `Allocation.tsx`. It reuses the incumbent metric grid, capital-value availability/help, channel notices, commands, field grid, wrapping action row, and provenance disclosure. It inherits IBM Plex Sans and tabular numerals from the base layer. No display font, imagery, decorative material, shadow, gradient, or new palette was added by the P6 scope.

The P6 action rules are scoped under `.paper-profit-reserves`. They use existing surface, border, text, muted-text and focus tokens, 4px button corners and a 32px minimum button height. Enabled hover and dashed disabled borders make availability readable without relying on color alone. Information buttons keep their inherited sizing. Light and high-contrast appearances come from the existing theme tokens; enlarged/reflowed captures are accessibility adaptations of the same terminal.

The final code keeps book creation, disarming policy save, authorization, local observation refresh, allocation review/confirmation, reviewed release and manual Resume as separate actions. It labels the book as simulation, leaves missing floor/consequence values unavailable, identifies the two supported missing-evidence reasons with recovery steps, retains H on release, and keeps sale preparation/connected verification pending. These are surface findings, not proof of backend authority or acceptance of any operational gate.

## Finish-review boundary

`finish-review.md` scored two material fixes: action/disabled-state affordance and unavailable cap/recovery wording. `finish-verdict.md` records both as resolved and returns `disposition: ship` only for that fix batch. The final source and desktop policy image support those resolutions; the remaining images support theme/reflow continuity within their visible sections. This documentation check does not broaden that verdict into whole-surface, strategy, release, sale, connected-paper, live-trading or payout approval.

## Five-line system summary

1. Palette: inherited near-black/charcoal neutral surfaces, restrained green financial identity, and existing light/high-contrast token substitutions.
2. Typography: inherited IBM Plex Sans, compact terminal hierarchy, muted 11–12px labels/notes, 18px bold metric values and tabular numerals; browser zoom remains an accessibility setting.
3. Layout: flat metric cells, labeled auto-fit field grids, wrapping actions and prose, with narrow/zoom reflow from the incumbent layers.
4. Material: subtle borders and 4px scoped field/action corners; no P6 decorative depth or competing visual voice.
5. Preserved rules: explicit availability/provenance, disarmed saves, distinct review/release/Resume, and simulation-only authority boundaries.

## Persistence verdict and inherited drift

No changes to `apps/desktop/PRODUCT.md` or `apps/desktop/DESIGN.md` are warranted for this ordinary extension; both were inspected and their working-tree diffs were empty. Root `.impeccable/design.json` and app-local `apps/desktop/.impeccable/design.json` remain absent. No system document or sidecar was created or rewritten.

Pre-existing differences remain descriptive caveats, not new rules: the terse incumbent `DESIGN.md` has no token frontmatter/sidecar; its 28–32px control and 4–6px corner shorthand does not enumerate the existing base 36px input minimum or shared 7px metric-grid radius. The shared theme also contains overlay shadow tokens outside this flat P6 surface. None was repaired or canonized because the authorized work preserves the incumbent system. No additional application edits were made by this pass.

## Prompt used

> Ok move onto building P6 using the saved plan. Preserve P0–P4 and P5-A–G, keep P5-H pending and the full P0–P7 scope intact, and keep the phase tracker updated.
