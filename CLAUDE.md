# CLAUDE.md — Coqui Crypto

Read this file fully before writing code. It defines the invariants. It does not
define the plan — see the doc map at the bottom and read only what the current
task needs.

---

## 1. What this project is

A single-user, local-first desktop application for crypto **portfolio tracking,
tax lots, allocation, and paper-trading research**. Coinbase-centric, USD, daily
cadence, free-data-only.

It is **not** a live trading bot. Live order submission does not exist in this
codebase and must not be added. See §3.

## 2. The prime directive: transplant, do not rewrite

Coqui is a new shell around a migrated engine from a predecessor project
(`kokin-trading-framework`, branch `main`). That predecessor's `src/core` is
~20,000 lines of tested, statistically careful code with zero UI dependencies.

**Default action for any predecessor module is COPY.** Rewriting is the exception
and requires a stated reason recorded in `docs/MIGRATION.md`.

The failure mode to avoid: you are in a fresh repo, rewriting feels cleaner than
porting, and you reimplement a backtest engine that took months to get correct.
An earlier version of that engine had a same-bar look-ahead bug that was found
and fixed. Do not reintroduce it.

**When porting, read the predecessor source. Do not reconstruct it from these
docs.** These docs describe intent; the source is the truth.

## 3. Hard invariants

Violating any of these is a defect regardless of what a task asks for.

1. **`canExecute(mode, killed)` returns `true` only for `mode === 'paper'`.**
   Never for `'live'`. There is no code path that submits a real exchange order.
2. **A Coinbase API key carrying `can_trade` or `can_transfer` is rejected at
   connect time.** The application refuses to hold a key that could move money.
3. **Secrets never leave the main process.** No secret in an IPC response, log
   line, error message, database column, exported file, or crash report.
4. **Cost-model pessimism is load-bearing. Do not reduce it.** Fees, spread,
   slippage, and the square-root market-impact term on the guard path exist to
   prevent false confidence. "Optimising" them is a defect.
5. **Guardrails are enforced in code, not UI.** Per-trade cap, position cap,
   total-at-risk cap, turnover cap, max trades per run, minimum trade size, and
   the global kill switch. No execution path may skip them.
6. **Signals observe only completed bars strictly before the execution bar.**
   Fills use the next bar's open. Any same-bar fill is a look-ahead bug.
7. **Every parameter search that influences a shipped default must register its
   trial count**, and that count must reach the deflated-Sharpe calculation. A
   default chosen by an unregistered search is not a validated default.
8. **The execution journal is append-only.** No update or delete path exists.
9. **Migrations are forward-only, ordered, transactional, and never renumbered.**
10. **No gross (cost-excluded) return is ever displayed.**
11. **Money is Decimal or fixed-point. Never binary float** for orders, fills,
    balances, or ledger entries.
12. **Never invent or silently resize a tax lot.** An unexplained balance is a
    reconciliation *exception* requiring user resolution — not a zero-basis lot
    and not a proportional rescale. The predecessor does both; do not port that.
13. **Instruments are identified canonically** as `(venue, product_id,
    product_type)`. Never join datasets on a display symbol.
14. **One cost model.** Every backtest, sweep, paper fill and preview reads the
    same venue profile. A research script passing its own commission number is a
    defect — the predecessor's sweep used 10bps against an 85bps app default.
15. **An ambiguous order submission transitions to `unknown`.** Never blind
    retry. Recovery queries the venue before deciding to resubmit.

If a task appears to require breaking one of these, stop and say so rather than
finding a way around it.

## 3a. Stack decision

**`docs/adr/0001-stack.md` is Accepted.** Coqui uses TypeScript/Electron/SQLite
for the application and preserves Python as an evidence-only research toolchain.
The predecessor proves the research code and a file-based JSON contract, but not
a packaged stdio sidecar; Phase 3 hardens that boundary before relying on it.

Revisit the decision after Phase 3 only if measured research needs justify it.

## 4. Structural rules

- `packages/core` is pure. It may not import `electron`, `react`, `node:fs`,
  `node:net`, `node:http`, or any workspace package. Time comes from an injected
  `Clock`; there is no `Date.now()` in `core`.
- Only `packages/adapters/src/http` may call global `fetch`.
- The renderer talks to `CoquiClient`. No component imports services, storage,
  or adapters. No component calls IPC directly.
- **No component owns a `setInterval`.** All polling goes through the query
  layer. The predecessor had 19 independent component timers and no shared
  cache; that is the specific problem this repo exists to avoid.
- Renderer motion follows `docs/UI-UX.md`: shared duration/easing tokens,
  compositor-friendly properties, no false intermediate financial values, and
  a complete `prefers-reduced-motion` plus in-app no-motion path.
- UI polish may not consume the interaction budget. Phase 5 measures p75
  interaction latency at ≤200ms and keeps CPU-heavy work off main/renderer
  threads; a visually smooth demo is not evidence without a production trace.
- No service imports more than two other services. Dependency cycles fail CI.
- Max 500 lines per file; 300 for renderer components.
- Every module ships with its tests.
- No `TODO` comments. The predecessor has zero across ~63,000 lines. Match it.

These are enforced by ESLint and CI, not by good intentions. If a rule is not yet
enforced, adding the enforcement is in scope.

## 5. Verification

```
pnpm verify        # typecheck + lint + test + build — green before anything is done
pnpm test          # vitest
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint, includes boundary rules
```

`fixtures/golden-backtest-v2.json` pins backtest numerical behaviour. **It must
pass after every change to `packages/core`.** If a change legitimately alters the
numbers, regenerate it in a *separate commit* and state the delta in the message.

## 6. Facts: verify, do not recall

These docs contain counts and line numbers from an audit dated 2026-08-01. They
drift. **Never quote a number from a doc as current fact.** Re-derive it:

```
# size of a predecessor module
wc -l <predecessor>/src/app/main/index.ts

# how many IPC handlers remain to rehome
grep -c "ipcMain.handle" <predecessor>/src/app/main/index.ts

# components still owning a timer
grep -rc "setInterval" src/app/renderer/src/components/*.tsx | grep -v ":0"

# what a parameter default actually is
grep -A8 "DEFAULT_MOMENTUM_CONFIG" <predecessor>/src/core/execution/momentum.ts
```

**Where a doc and the code disagree, the code wins.** Fix the doc in the same
change; do not work around the discrepancy silently.

Claims marked `ASSUMED` in the docs were not verified. Treat them as hypotheses.

Verified by the second audit: the predecessor's suite runs **434 pass / 15 fail**,
where all fifteen are SQLite suites that could not load a `better-sqlite3` native
binary in a sandbox — not application defects. `pnpm typecheck` and `pnpm lint`
pass. Verified 2026-08-01: `keytar` is archived; ADR-0002 preserves the existing
`kokincrypto` service identity but prohibits silently restoring that dependency.

## 7. Scope discipline

Do not build, even if it seems adjacent to the current task:

live order submission · a second exchange · TradingView ingestion · user
accounts or multi-tenancy · ML models in the default decision path · WebSocket
feeds · any server, cloud database, or container orchestration · market making,
grid trading, HFT, or cross-exchange arbitrage.

Round-trip friction at this venue is roughly 170 basis points on daily bars,
which arithmetically rules out the last group. The rest are sequenced later or
rejected outright in `docs/PLAN.md` §4.

`adaptive-learning.ts` in the predecessor is quarantined. It must never reach the
default decision path — self-tuning parameters are an unbounded unregistered
search and would invalidate invariant 7.

## 8. Working style

- Read the predecessor source before porting. Cite the file you read.
- One work item at a time. Finish it, verify it, then move on.
- Say when something is uncertain rather than picking plausibly.
- If a doc is wrong, say so and fix it.
- Prefer deleting to adding. This project's value is what it refuses to claim.

## 9. Doc map — read on demand, not upfront

| Need | Read |
|---|---|
| Where does a file go? Copy or rewrite? | `docs/MIGRATION.md` |
| Package layout, boundaries, tech choices, data flow | `docs/ARCHITECTURE.md` |
| Current phase, next work item, exit criteria | `docs/PLAN.md` |
| Which market-data source is authoritative? | `docs/DATA-SOURCES.md` |
| Open architectural decisions | `docs/adr/` |
| Why the plan is shaped this way | `docs/audit/` — background only |

`docs/audit/second-audit-2026-08-01.md` is an **independent second audit** of the
same predecessor. Where the two agree, confidence is high. Where they disagree,
`docs/adr/0001-stack.md` states the conflict and what is unresolved. Do not
follow its architecture sections while ADR-0001 is PROPOSED — its stack
recommendation is the thing under dispute.

`docs/audit/` holds the original audit (executive summary, codebase audit,
strategy audit, research report, gap analysis, risk register). It is context for
the human, not build instructions. Do not load it for implementation work.
