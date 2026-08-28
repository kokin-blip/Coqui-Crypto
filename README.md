# Coqui Crypto

Coqui Crypto is an evidence-first crypto research and paper-trading workstation. It combines immutable research provenance, real-portfolio read models, exact-decimal paper accounting, risk controls, and a secure Electron desktop shell.

Coqui is not a live-trading application. `liveExecutionPermitted` is a contract-level literal `false`; there is no live venue, leverage, derivatives, transfer, withdrawal, or real-order path.

## Current status

The active implementation continues from `p5-shell-and-ui` at the P5–P9 baseline. It includes a routed desktop shell, active-profile isolation, research and risk evidence surfaces, Coinbase read-only infrastructure, scheduler/recovery/reconciliation, and an authoritative paper-execution service.

Paper proposals are system-generated rebalances only:

- `off` keeps the profile read-only.
- `review_required` stages a proposal for human approval and is the default.
- `unattended` requires explicit profile-policy confirmation and still runs the identical fresh gate chain.

Every submission reruns profitability, verified-evidence, risk, paper-permission, and kill-switch checks. A review is bound to a proposal hash and revision. Orders, state events, fills, ledger legs, and balances commit in one storage transaction. Ambiguous interruption produces `unknown`, disables automatic retry, and requires reconciliation.

Backtests and paper results are evidence, not proof of future profitability. The shipped TrendVol replacement study was negative and the strategy remains unvalidated.

## Requirements

- Node.js 24 or newer
- pnpm 11.9.0 (pinned in `package.json`)
- macOS, Windows, or Linux for the Electron shell

## Setup

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm --filter @coqui/desktop start
```

The root typecheck works in a pristine clone before build output exists.

## Verification

Run the release-relevant gates under Node 24:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke
pnpm perf
pnpm audit --prod --audit-level high
git diff --check
```

Packaging is available with `pnpm package`. Cross-platform packaged smoke remains a CI responsibility where platform-specific artifacts are produced.

## Architecture and safety

- Renderer code reaches application behavior only through validated Zod RPC channels and `CoquiClient`.
- The main process injects the active profile; profile-scoped renderer requests cannot choose a profile ID.
- TanStack Query owns all renderer refetch policy. Components own no polling interval.
- Research datasets and evidence are immutable and content-addressed.
- Financial values use exact decimal types and text persistence.
- Paper and real portfolio accounting remain separate.
- The OMS is internal to `PaperExecutionService`; renderer, scheduler, and composition code cannot persist paper orders directly.
- Electron uses sandboxed preload, CSP, sender validation, an external-navigation allowlist, and permission denial.

Start with [the plan](./docs/PLAN.md), [architecture](./docs/ARCHITECTURE.md), [UI/UX contract](./docs/UI-UX.md), and [current interface inventory](./docs/design/current-interface-inventory-2026-08-23.md).

## Known limitations and open owner gates

- The 2026-08-24 screenshot set approved the prior direction. Material 2026-08-27 shell and market-workspace changes have a [new review set](./docs/design/owner-screenshot-review-2026-08-27.md) awaiting owner approval.
- Real Coinbase permission verification is owner-deferred because API keys are personal. No key is bundled, requested, or needed for public market data and paper-only operation.
- A forward-only confirmatory edge study is registered and its prospective collector is active, but 365 complete observed days and 30 cost-bearing rebalances cannot be manufactured. Manual edge settings are ignored and profitability checks block proposals until an integrity-verified pass exists.
- The seven-day zero-edge stand-down campaign starts on the first real scheduler observation. It requires seven consecutive observed UTC days, a confirmed safety-stop exercise and acknowledgement, and reconciliation; missed days are never backfilled.
- Daily paper valuation evidence begins when the scheduler records it; missing historical days are never fabricated or backfilled.
- Strategy curves appear only when an immutable artifact explicitly contains them. Existing artifacts without curves show an unavailable state.
- Live execution remains hard-disabled.
