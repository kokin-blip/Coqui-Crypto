# P5–P9 authoritative baseline verification

Captured before the additive continuation work on 2026-08-24.

## Repository identity

- Branch: `p5-shell-and-ui`
- Fetched head: `d25101f0bb7d783e7700eb128553f954289f366f`
- Relationship to `main`: 42 commits ahead
- Handoff diff: 183 files, 27,237 additions, 311 deletions
- Workspace state before checkout: empty initialized repository; no files or user changes

The branch was fetched and checked out directly. `main` was not checked out and no completed P5–P9 work was reset or replaced.

## Authoritative environment

- Node.js 24 is required by `package.json` and is the only release-verification environment.
- pnpm is pinned to 11.9.0.
- The Node 22 warning observed during inspection is not an accepted release result.
- A source alias for `@coqui/ui-kit` is present in `tsconfig.check.json`, so a pristine clone can typecheck before package build artifacts exist.

## Fetched-head gates

- Typecheck: passed
- Lint: passed
- Tests: 140 files / 1,013 tests passed
- Production build: passed
- Electron smoke: 28 passed
- Packaged smoke: 8 passed
- Production dependency audit: no high-severity advisory
- Warm useful shell: 215 ms, within the 1.5 s limit
- Interaction p75: 8.6 ms, within the 200 ms limit
- Sensitivity control: the injected 250 ms interaction breached the limit as expected
- `git diff --check`: passed

These are baseline measurements, not the final continuation counts. Final counts are recorded only after the additive working tree passes the same Node 24 gates.

## Additive continuation result

After the routed shell, profile boundary, paper execution service, performance evidence, Activity/Research surfaces, visual modes, and migration 48 were integrated, the Node 24 gates produced:

- Typecheck before build: passed
- Lint and architectural rules: passed
- Tests: 146 files / 1,039 tests passed
- Production build: passed
- Electron smoke: 35 checks passed through the production profile controller
- Performance: 171 ms warm useful shell; 8.6 ms interaction p75
- Sensitivity control: 250.4 ms and correctly over budget
- macOS arm64 package: built and ad-hoc signed
- Packaged smoke: 8 checks passed; `node:sqlite` opened schema 48 under asar
- Production dependency audit: no known vulnerabilities
- Peer dependency check: clean
- `git diff --check`: passed

Windows x64 packaging remains covered by the repository CI definition and cannot be executed on this macOS host.

## Visual capture

The production-build stacked-shell baseline is preserved at [stacked-shell-dark.png](./design/screenshots/baseline/stacked-shell-dark.png). It documents the pre-route layout; it is not a target design.

## Owner-dependent exits

Fixtures and documentation cannot close these:

1. Verification with a real Coinbase key whose permissions are View-only.
2. A registered per-trade net-edge estimate for the shipped strategy.

The final screenshot review set was owner-approved on 2026-08-24.

The negative TrendVol replacement result remains authoritative and visible. It is not an owner gate and cannot be reinterpreted as validation.
