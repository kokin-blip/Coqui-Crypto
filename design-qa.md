# Mockup-fidelity Advanced workspace design QA

Date: 2026-08-29
Viewport: 1536 × 1024 CSS pixels
Reference: owner-supplied Advanced Research Grid mockup
Implementation: `docs/design/screenshots/review-2026-08-29-research-grid/research-grid-dark.png`

## Blocking comparison

- The reference and latest production-renderer capture were opened and compared at the same viewport and interaction state.
- The comparison covered palette, sidebar proportions, status modules, primary grid ratios, border hierarchy, text containment, and the first-viewport evidence order.
- The visual harness used an isolated migrated profile and did not seed illustrative financial values.

## Results

### P0 — release blocking

None.

### P1 — major visual or hierarchy defects

None after correction.

- Advanced now uses the reference's black-green canvas, bright emerald selection state, crisp green borders, compact panel radii, and minimal elevation.
- The sidebar is 164 px wide with the exact owner-selected frog, a lowercase `coqui` wordmark, evenly aligned navigation rows, and a restrained paper-safety footer.
- The two-level operating header remains intact. Primary facts are boxed; Coinbase, kill-switch, jobs, reconciliation, costs, risk stage, and command access remain visible in the secondary row.
- The Research Grid uses the requested 58/18/24 chart, Evidence Stack, and Strategy Detail proportions.

### P2 — material accessibility or responsive defects

None after correction.

- Strategy and activity empty states have explicit padded bodies and no clipped baselines.
- The screenshot harness audits important text scroll bounds before every capture and fails on clipping beyond Chromium's two-pixel variable-font glyph overhang.
- Research Grid, Chart Focus, Evidence Review, Simple, light, high contrast, compact, and 200% captures completed without clipping failures.
- Keyboard navigation, focus indicators, reduced/no motion, non-color statuses, and the existing responsive stack order remain intact.

### P3 — intentional differences

- The reference contains illustrative charts, strategies, provenance, and activity. Production captures retain honest unavailable states until immutable evidence exists.
- The existing route heading and second operating row remain by owner preference, so the chart begins lower than in the reference.
- No TradingView data, remote widget, renderer networking, new execution path, or financial contract change was introduced.
- Windows artifacts cross-build locally; packaged Windows runtime verification remains external.

## Verification evidence

- Typecheck and lint: passed on Node 24.
- Tests: 159 files, 1,085 tests passed.
- Electron security smoke: 37 checks passed; schema 52, renderer sandbox, and restrictive CSP retained.
- Performance: warm useful shell 173.0 ms; interaction p75 8.7 ms.
- Production dependency audit: no known vulnerabilities.
- macOS arm64 package and packaged smoke: passed.
- Windows x64 installer and zip: cross-build passed; runtime verification not claimed.
- Exact frog source SHA-256 remains `55dab8864e0463256ffec43de29e4c27da6f820f77737b58c59fbac855c3691a`.
- `git diff --check`: passed.

Final result: passed. Owner screenshot approval and Windows runtime evidence remain external release gates.
