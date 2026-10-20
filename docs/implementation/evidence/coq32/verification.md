# COQ-32 verification — 2026-10-20

Environment: macOS arm64, Electron 43.4.1, local production build. Isolated fixtures only. No real-profile trades or provider operation were certified.

| Check | Result |
| --- | --- |
| `pnpm verify` | Passed: typecheck, lint, 274 files / 1,833 tests, and source-manifest/TypeScript build. Final test duration 156.23 seconds. |
| Focused journal/paper/component regression |50 tests across 5 files passed, including the new delayed-fill case. |
| Desktop production build |Passed. Existing large Ionic bundle warning remains. |
| Existing native desktop smoke |ALL PASS. |
| Crew Journal Electron fixture |30 checks passed. |
| Existing interaction performance |Shell 201.0ms; interaction p75=8.5ms versus 200ms budget; deliberate 250ms control measured 250.5ms and breached budget as required. |
| Journal IPC → painted frame |p75=8.5ms versus 200ms budget; 30 samples. |
| Journal uncached summaries |p95=22.64ms versus 100ms target; 20 reads, 5,000 events / 500 groups. |
| Journal uncached group |p95=5.82ms; 20 reads. |
| Journal cached summaries |p95=0.040ms; 30 reads. |
| Finite sustained-update retained heap |Baseline 19,532,636 bytes; peak 20,800,528 bytes; increase 1,267,892 bytes (1.21MiB) after garbage collection. |
| Rendering and client cache bounds |Native pagination reaches 200 entries and disables further loading; Jump restores 50. Four further 60-event batches keep 50 rendered entries. Summary cache is capped 20; inactive journal query cache retention is 0ms. |
| Polling and isolation |Background, collapse and navigation checks pass. Delayed old-profile result cannot populate the new profile. Viewing produces no wallet evaluations or paper fills. |
| Themes/layout |Dark, light, high contrast, 1280-width and 200% zoom pass without horizontal overflow. Reduced motion set to none. |
| UI review |One P2 Jump/Resume scroll/focus finding resolved. Reviewer disposition ship at verdict-pass scope. |
| Design documentation |Incumbent component/token comparison complete; no system replacement or design-file changes required. |

The heap sample is four bounded update batches, not a production-duration soak. Human VoiceOver, owner/code review, real-profile review and release approval remain open. Neither automated UI checks nor the reviewer verdict closes those gates.

Files: [native results](electron-checks.json), [read benchmark](read-performance.json), [UI review](ui-review.md), [design comparison](design-documentation.md), [dark](crew-journal-dark.png), [light](crew-journal-light.png), [contrast](crew-journal-contrast.png), [200% zoom](crew-journal-zoom.png), [placement](crew-journal-placement.png).

Reproduce after `pnpm build` and `pnpm --filter @coqui/desktop build`:

```sh
pnpm verify
pnpm --filter @coqui/desktop exec electron scripts/crew-journal-smoke.mjs
node apps/desktop/scripts/crew-journal-benchmark.mjs
pnpm --filter @coqui/desktop exec electron scripts/smoke.mjs
pnpm --filter @coqui/desktop exec electron scripts/perf.mjs
```

These checks do not publish, merge, release, open a study holdout or activate a live execution mode.
