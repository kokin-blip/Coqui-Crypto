# Advanced Overview Research Grid design QA

Date: 2026-08-29
Viewport: 1536 × 1024 CSS pixels
Reference: `docs/design/dual-mode-reference/advanced-workstation.png`
Implementation set: `docs/design/screenshots/review-2026-08-29-research-grid/`

## Blocking comparison

- The default Advanced Overview was compared with the approved workstation hierarchy at a matching viewport.
- The rebuilt first viewport contains the persistent navigation and status header, dominant verified chart, Evidence Stack, optional Strategy Detail, and the start of the comparison/activity row.
- The exact owner-selected coquí bitmap remains hash-locked by `tests/icon-assets.test.ts`: `55dab8864e0463256ffec43de29e4c27da6f820f77737b58c59fbac855c3691a`.
- The restrained dot field remains a navigation accent and does not compete with financial evidence.

## Results

### P0 — release blocking

None.

### P1 — major hierarchy or interaction defects

None after correction.

- `research_grid` is the Advanced default. `chart_focus`, `evidence_review`, and custom visibility choices preserve the mandatory chart and Evidence Stack.
- Strategy selection is ephemeral and linked to the detail inspector without issuing a financial query.
- Simple mode retains its existing decision-first composition and progressive disclosure.
- At constrained widths the same evidence order stacks; no panel is replaced with decorative content.

### P2 — material visual or accessibility defects

None after correction.

- Chart observations support keyboard Left/Right inspection, a live text legend, accessible summary, fullscreen, and a validated native PNG-save flow.
- Dark, light, high-contrast, compact, Simple, Advanced, and 200% captures use shared semantic tokens and non-color status labels.
- Empty charts and strategy areas clearly state why verified evidence is unavailable.
- The four-metric health strip remains below the comparison/proposal area, and negative findings remain last.

### P3 — intentional differences and external evidence

- The reference contains illustrative curves and strategy rows. Production captures use an isolated migrated profile and never fabricate immutable financial evidence.
- Coqui continues using the installed Lightweight Charts renderer with completed Coinbase observations. No TradingView data, remote widget, iframe, script, or renderer network path was added.
- Display indicators are informational only, default off except volume, and cannot enter research, risk, storage, OMS, or execution.
- Windows zip and installer cross-build locally; packaged runtime verification remains open for an authorized Windows runner.
- This implementation QA passed. Owner approval of the refreshed screenshot set remains an external release gate.

## Verification evidence

- Typecheck and lint: passed on Node 24.
- Tests: 158 files, 1,082 tests passed.
- Electron security smoke: passed; renderer sandbox and restrictive CSP retained.
- Performance: warm useful shell 167.0 ms; interaction p75 9.0 ms.
- Production dependency audit: no known vulnerabilities.
- macOS arm64 package and packaged smoke: passed with migration 52 under asar.
- Windows x64 installer and zip: cross-build passed; runtime verification not claimed.
- `git diff --check`: passed.

Final implementation result: passed. Owner screenshot approval and Windows runtime evidence remain external release gates.
