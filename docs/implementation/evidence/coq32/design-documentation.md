# COQ-32 incumbent design comparison

Date: 2026-10-20. Scope: local Crew Journal implementation, ordinary extension of the existing Coqui terminal. This records the Impeccable documenter handoff after the finish-review verdict; it does not establish a new visual system or release approval.

## Authority and evidence checked

- Read `apps/desktop/PRODUCT.md`, `apps/desktop/DESIGN.md`, and `docs/UI-UX.md`. The existing Figma specification remains the visual authority. The inherited direction is compact terminal typography, neutral surfaces, subtle dividers, restrained status colors, readable recorded evidence, and the existing crew portraits.
- Read `OperationsJournal.tsx`, `CoquiComponents.tsx`, `JournalDecisionEvidence.tsx`, `DecisionEvidencePanel.tsx`, `use-operations-journal.ts`, `RouteScreen.tsx`, `styles/operations-journal.css`, relevant incumbent terminal/base styles, and `packages/ui-kit/src/theme.css`.
- Opened every supplied capture: [dark](crew-journal-dark.png), [light](crew-journal-light.png), [high contrast](crew-journal-contrast.png), [200% zoom](crew-journal-zoom.png), and [placement](crew-journal-placement.png). Each shows the named surface without blank or unloaded regions. These are scoped journal/placement captures, not full-page release screenshots.
- Read [Electron checks](electron-checks.json): fixture-only results record no horizontal overflow at journal widths of 1414px, 1254px, and 626px; placement, readable six-worker messages, expansion, filtering, polling/focus retention, pause/resume, history bounds, profile isolation, and Jump to latest checks pass. Recorded journal IPC-to-painted-frame p75 is approximately 8.5ms on this fixture. This is not a production or human accessibility sign-off.
- Read the [exact prompt record](../../crew-journal-prompts.md), including the selected grouped handoffs and follow-up: “MAKE SURE YOU USE THE FIGMA UI COMPONENTS AND SUCHa”.

## Finished build compared with the incumbent

| Incumbent expectation | Observed extension |
| --- | --- |
| IBM Plex Sans, compact 12–14px terminal typography | Inherits bundled IBM Plex Sans. Journal body/headings use 13px; metadata and technical details use 12px. Readable prose has a 75ch maximum. No font replacement. |
| Neutral, flat terminal surfaces and subtle dividers | Journal composes the existing terminal panel/header and toolbar. Uses shared `--coqui-surface-*`, text, border, warning, positive, and negative tokens; no local palette, gradients, or decorative shadows. |
| Compact controls and slightly rounded forms | Buttons/selects use 32px minimum height and 4px radii, badges 24px minimum, consistent with the terminal. Coarse-pointer controls increase to 44px. |
| Existing six-worker identity | Reuses `CrewRobot` SVG portraits beside worker names. Text, timestamps, source labels, and recorded status remain authoritative. |
| Evidence-first hierarchy | Group labels, times, source, and explicit status precede chronological worker sentences. Native expandable technical details expose recorded identities/facts; linked decisions reuse the incumbent decision-detail panel. |
| Preserve Operations composition | `RouteScreen` places Operations floor → Crew Journal → Decision and execution feed → Alerts. Placement and journal/feed captures support the intended relationship. |
| Responsive, keyboard-operable dense content | Controls wrap, long evidence wraps, narrow evidence rows stack, and the 420px journal viewport can expand. Existing focus tokens apply. Jump and Resume explicitly reset the journal scroll position and focus its stable labeled region. |

The implementation agent inspected the official Figma design contexts and screenshots for file `oYzyZ6Spywty2LQ6CT3EBs`: Panel `3:64`, Header `3:66`, Button `3:37`, Dropdown `3:56`, and Badge `3:46`. `CoquiComponents.tsx` implements these as semantic React/native-element wrappers and retains the node references. No Code Connect mappings were available; node references and semantic implementations must not be described as generated Code Connect bindings. This documenter checked the wrappers, styles, rendered captures, and fixture evidence; it did not independently repeat the remote Figma inspection.

## Documentation disposition

No design-system update is required for this ordinary extension. Preserve `apps/desktop/PRODUCT.md`, `apps/desktop/DESIGN.md`, shared tokens, and existing design assets. The journal is a feature composition using incumbent primitives; its local group/list/detail layout does not require a new global token or identity rule.

Pre-existing documentation gaps remain: `apps/desktop/DESIGN.md` is a concise prose description rather than the token-bearing frontmatter/canonical-section format in the current Impeccable document reference; no `.impeccable/design.json` exists at the repository or desktop-app root. Those gaps were observed, not repaired. The existing theme also carries general 6–7px radius tokens while terminal components use established 4px rules; this journal follows the terminal implementation rather than changing either source.

The supplied finish-review handoff reports the Jump/Resume correction resolved and disposition **ship** at the reviewed scope. This comparison introduces no additional visual correction. Human VoiceOver verification and any outstanding repository review/release gates remain separate. Only this evidence note was written by the documenter.
