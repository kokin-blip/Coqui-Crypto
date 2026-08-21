# Headless primitive-layer spike — 2026-08-21

## Outcome

Select **Base UI (`@base-ui/react` 1.7.0)** as the single headless primitive
layer. It is the only candidate that renders portaled overlays under Coqui's
production CSP without additional machinery.

`docs/UI-UX.md` §0 named Base UI the preferred candidate and Radix and React
Aria Components as fallbacks. The measurement agrees with the preference, but not
for the reason the brief anticipated: Base UI is neither the smallest nor the
most feature-complete. It wins on CSP.

## Candidates as built

Each candidate implemented the same surface — a destructive dialog with a
backdrop and a close action, a tooltip, and a select/popover — then was built to
a production bundle by Vite 8 with esbuild minification, targeting ES2022.

| | Base UI | Radix | React Aria |
|---|---|---|---|
| package | `@base-ui/react` 1.7.0 | `@radix-ui/react-*` 1.1–1.2 | `react-aria-components` 1.20.0 |
| bundle, raw | 130.41 kB | 55.68 kB | 182.45 kB |
| **bundle, gzip** | **44.79 kB** | **18.10 kB** | **58.95 kB** |
| shared `floating-ui` chunk | 22.55 kB raw / 8.81 kB gzip, shared | | |
| **`<style>` injection sites** | **0** | **1** | **2** |
| works under `style-src 'self'` | **yes** | only with a nonce | only with a nonce |

## The CSP finding

`apps/desktop/src/main/security.ts` sets `style-src 'self'` with no
`'unsafe-inline'`. React's `style={{…}}` prop is unaffected — it writes through
CSSOM, which CSP does not govern — so positioning is safe in all three. The
pressure point is libraries that inject a **`<style>` element** at runtime.

Static analysis of the production bundles found the exact sites:

- **Base UI — none.** No `createElement('style')`, no `insertRule`, no
  `adoptedStyleSheets`.
- **Radix — one**, inside `react-remove-scroll`'s scroll-lock:
  `document.createElement("style")`, with `nonce` support read from
  `__webpack_nonce__`.
- **React Aria — two**: a scroll-lock rule and an `@layer` block setting
  `overscroll-behavior`. Both read a nonce before injecting.

Both fallbacks are therefore usable *only* if Coqui supplies a CSP nonce. That is
not a small addition. A nonce must be unique per document load, which means the
renderer HTML can no longer be a static file — it has to be generated at load
time, or the CSP has to move entirely to the header path with the nonce
threaded into the markup. The packaged renderer loads from `file://`. Taking on
runtime HTML generation so that a component library can write CSS at runtime is
a poor trade when a candidate exists that never needs to.

Choosing Radix or React Aria would mean either building that machinery or
relaxing `style-src` to `'unsafe-inline'`. Relaxing it is the worse option: it
weakens a real control for a cosmetic dependency.

## Limitation

**This finding is static, not runtime.** An Electron harness that opened each
overlay under the production CSP and counted `securitypolicyviolation` events
hung on the click loop and was abandoned rather than reported as a pass. The
conclusion rests on locating the injection sites in the shipped bundles, which
establishes that the code paths exist but not that they fire on every overlay.

The direction of the error is safe: Base UI has zero sites, so no runtime path
can inject a style element it does not contain. For the two fallbacks the count
could in principle be lower in practice than the bundle implies. Since neither is
being adopted, that does not change the decision.

If Base UI is ever reconsidered, re-run the runtime harness first.

## Corrections to the brief

`docs/UI-UX.md` §0 links Base UI as `base-ui.com` and the ecosystem previously
published `@base-ui-components/react`. That package is **deprecated and renamed**
to `@base-ui/react`; its last release under the old name was `1.0.0-rc.0`, which
makes the old name look like an unstable project. The current package is
**1.7.0 stable**. Installing the old name would have pinned a release candidate.

## What was not adopted

No styled kit. shadcn/ui, daisyUI, Flowbite, Preline, MUI, Ant Design and Chakra
were excluded by §0 before measurement — their default visual grammar would
replace Coqui's own. Blueprint, Fluent and Spectrum remain reference-only for
dense desktop patterns.

## Follow-up

- Pin `@base-ui/react` exactly under `docs/dependency-policy.md`.
- Base UI does not cover every interaction. Anything it lacks is built from
  native elements and WAI-ARIA patterns in `ui-kit`, **not** by adding a second
  primitive layer — §0 permits at most one.
- Re-measure the bundle once real screens exist; 44.79 kB gzip is the floor for
  the primitives alone, not the renderer budget.
