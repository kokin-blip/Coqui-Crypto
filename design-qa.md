# Dual-mode UI design QA

Date: 2026-08-29  
Viewport: 1536 × 1024 CSS pixels  
Reference set: `docs/design/dual-mode-reference/`  
Implementation set: `docs/design/screenshots/review-2026-08-28-dual-mode/`

## Blocking comparison

- Advanced source and implementation were compared side-by-side in `docs/design/qa/advanced-comparison.png`.
- Simple source and implementation were compared side-by-side in `docs/design/qa/simple-comparison.png`.
- The canonical coquí mark is the exact owner-selected bitmap. Its SHA-256 is locked by `tests/icon-assets.test.ts`; packaging refuses a different source image.

## Results

### P0 — release blocking

None.

### P1 — major hierarchy or interaction defects

None.

- Advanced preserves the source hierarchy: persistent labeled navigation, compact operating status, dominant evidence chart, linked operational context, and a persistent evidence inspector.
- Simple preserves the route and status context while removing the inspector and revealing secondary evidence progressively.
- Both modes expose profile, paper policy, freshness, reconciliation, risk permission, leading-strategy validation, and the blocking reason in the first viewport.

### P2 — material visual or accessibility defects

None after correction.

- The formerly sparse Performance and Activity empty states now retain the intended workstation structure without inventing observations.
- At 200% zoom the navigation collapses to icons with accessible names; content remains readable without horizontal page scrolling.
- Light, dark, compact, high-contrast, reduced-motion, no-motion, stale/offline, negative-evidence, and unavailable-data states use semantic tokens rather than feature-owned colors.
- Financial charts remain primary. Allocation rings are optional companion views and include textual summaries and linked filtering.

### P3 — intentional differences and follow-up evidence

- Reference mockups contain illustrative market curves and strategy rows. Production screenshots show honest unavailable states when the local profile lacks immutable observations; no decorative financial data was introduced to mimic the reference.
- The Advanced reference includes trading-terminal controls that Coqui intentionally rejects. The implementation contains no buy/sell, order-book, leverage, transfer, or live-execution surface.
- Windows artifacts cross-build locally, but packaged runtime verification remains open for an authorized Windows runner.
- The refreshed screenshot set still requires owner review before visual approval is recorded in the release plan.

## Verification evidence

- Typecheck and lint: passed on Node 24.15.0.
- Tests: 154 files, 1,070 tests passed.
- Electron security smoke: passed; renderer sandbox and restrictive CSP retained.
- Performance: warm useful shell 152.0 ms; interaction p75 8.4 ms.
- Production dependency audit: no known vulnerabilities.
- macOS arm64 package and packaged smoke: passed, migration 51 applied under asar.
- Windows x64 installer and zip: cross-build passed; runtime verification not claimed.
- `git diff --check`: passed.

Final result: passed. Owner screenshot approval and Windows runtime evidence remain external release gates.
