# ADR-0005 — Base UI as the single headless primitive layer

**Status:** ACCEPTED
**Date:** 2026-08-21

## Decision

Use **`@base-ui/react`** as the one headless primitive layer for the renderer.
Pin it exactly. Tailwind remains the styling engine and Coqui owns every visual
token; the primitive layer supplies behaviour only — dialog, popover, tooltip,
menu, select/combobox, tabs, field, toast.

`docs/UI-UX.md` §0 permits **at most one** such layer. Radix and React Aria
Components are not adopted, and adding either later as a second layer is a
violation of that rule rather than a convenience. Any interaction Base UI does
not cover is built in `packages/ui-kit` from native elements and WAI-ARIA
patterns.

No styled component kit is adopted in any form.

## Evidence

Each candidate implemented the same dialog, tooltip and select surface and was
built to a production bundle.

| | Base UI | Radix | React Aria |
|---|---|---|---|
| gzip bundle | 44.79 kB | 18.10 kB | 58.95 kB |
| `<style>` injection sites | **0** | 1 | 2 |
| runs under `style-src 'self'` | **yes** | nonce required | nonce required |

The deciding constraint is the Content Security Policy in
`apps/desktop/src/main/security.ts`, which sets `style-src 'self'` with no
`'unsafe-inline'`. React's `style` prop writes through CSSOM and is unaffected,
so overlay positioning is safe everywhere. Runtime **`<style>` element injection**
is not: Radix injects one for scroll-lock, React Aria injects two, and both then
require a per-load CSP nonce.

Supplying a nonce would mean the packaged `file://` renderer could no longer ship
a static HTML document — it would have to be generated per load. Base UI needs
none of that. Radix is the smallest bundle by a wide margin and still loses,
because 27 kB of savings does not justify runtime HTML generation or relaxing
`style-src` to `'unsafe-inline'`.

See `docs/studies/ui-primitive-spike-2026-08-21.md`, including its stated
limitation: the injection sites were located by static analysis of the shipped
bundles after the runtime Electron harness hung. Base UI's count is zero, so no
runtime path can inject what the bundle does not contain.

## Reason

The CSP is a real security control that the predecessor did not have at all (see
the 2026-08-20 correction in `docs/MIGRATION.md` §1). Having just written it,
weakening it in the same phase to accommodate a component library would be
choosing convenience over the control — and `style-src 'unsafe-inline'` is not a
narrow concession, it re-permits every inline style in the document.

Choosing on CSP compatibility rather than bundle size or API surface also keeps
the decision durable: bundle sizes move every release, but a library that never
writes CSS at runtime stays compatible.

## Corrections this ADR records

`docs/UI-UX.md` §0 was written against the `@base-ui-components/react` package,
which is **deprecated and renamed** to `@base-ui/react`. The final release under
the old name is `1.0.0-rc.0`, so following the brief literally would have pinned
a release candidate. The adopted package is 1.7.0 stable.

## Revisit when

- Base UI ships a breaking major, or stops covering an interaction Coqui needs
  and the WAI-ARIA fallback proves unreasonable.
- The renderer performance budget in `docs/UI-UX.md` §5 fails and profiling
  attributes it to the primitive layer rather than to Coqui's own components.

A packaged-build CSP failure reopens this ADR. It does not justify adding a
second primitive layer.
