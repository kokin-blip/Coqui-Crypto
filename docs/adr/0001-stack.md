# ADR-0001 — Implementation stack

**Status:** ACCEPTED
**Date:** 2026-08-01
**Context:** two independent audits of the same predecessor reached different stack conclusions.

---

## The disagreement

Two audits were run against `kokin-blip/kokin-trading-framework` on the same day. They converge on almost everything — new repo justified, modular monolith, live trading stays off, the same-close look-ahead in `pivot`, turnover double-counting, understated deflated-Sharpe trial counts, survivorship bias, an over-centralised main process, negative results as an asset, Parquet+DuckDB for research, webhooks as signal input only.

They diverge on one thing, and it is expensive either way.

| | Audit A (this pack) | Audit B (`docs/audit/second-audit-2026-08-01.md`) |
|---|---|---|
| Language | TypeScript, Python sidecar | Python 3.12 + FastAPI, TS frontend only |
| Engine | **Migrate** the ~20k-line TS core | **Rewrite** the domain in Python |
| Operational DB | SQLite | PostgreSQL |
| Shell | Electron desktop | Hosted web (React + OpenAPI client) |
| Identity | None — single user | OIDC, RBAC, workspaces, memberships, KMS |
| Trading engine | Own bar loop, borrow the deterministic-clock pattern | NautilusTrader proof-of-concept behind domain ports |
| Anchor branch | `main` | `pivot` (as requested), with `main` verified separately |

---

## Evidence gathered

**Python's quant ecosystem advantage is real but already captured.** GitHub's `backtesting` topic carries roughly 3,174 Python repositories against 355 for TypeScript ([GitHub topics](https://github.com/topics/backtesting)), and the mature options — VectorBT for speed, Backtrader for realism, Backtesting.py for simplicity, `bt` for portfolio-level logic — are all Python ([QuantStart](https://www.quantstart.com/articles/backtesting-systematic-trading-strategies-in-python-considerations-and-open-source-frameworks/), [Pineify comparison](https://pineify.app/resources/blog/best-python-backtesting-library-the-complete-guide-for-algorithmic-traders), [awesome-systematic-trading](https://github.com/wangzhe3224/awesome-systematic-trading)).

**The predecessor already contains a Python research prototype on `main`.** It
has 725 lines of pandas/numpy/scipy analysis, nine Python tests, and a 221-line
TypeScript contract with three contract tests. The `pivot/kokintrader` branch is
TypeScript-only. On `main`, Python is invoked manually and exchanges JSON through
files; it is not bundled with Electron, run by `pnpm verify`, or integrated as a
supervised stdio sidecar. The statistical work that genuinely needs Python is
already represented, but Phase 3 must harden and package the boundary.

**Rewrite risk is real, and the canonical warnings are weaker than usually quoted.** Brooks' second-system effect describes exactly this situation: a successful first system followed by an over-engineered second one, inflated by confidence and deferred ideas added all at once ([Wikipedia](https://en.wikipedia.org/wiki/Second-system_effect), [Laws of Software Engineering](https://lawsofsoftwareengineering.com/laws/second-system-effect/)). Spolsky's "never rewrite" argument is that crufty code encodes hard-won bug knowledge ([Potapov](https://potapov.dev/blog/why-rewrites-fail/)). But the counter-analysis is worth taking seriously: on Netscape, the usual cautionary example, the decline slope barely changed before and after the rewrite — Internet Explorer explains it better than Mozilla does ([Schwartzer, CyberArk Engineering](https://medium.com/cyberark-engineering/joel-is-wrong-and-it-costs-you-a-fortune-105924be8f01)). Many rewrites succeed. "Never rewrite" is too strong; "know what the code knows that you don't" is the durable form.

**What does this code know?** Not much cruft — zero `TODO`s across ~63,000 lines. What it knows is concentrated in roughly 1,500 lines of subtle statistical work: a correct from-scratch Probabilistic and Deflated Sharpe implementation, next-bar execution timing that took a dedicated overhaul to get right, and a cost model calibrated to the actual venue fee tier. That is the knowledge at risk, and it is small enough to port carefully — **in either language**.

**The golden fixture cuts against my own position.** `golden-backtest-v2.json` is language-agnostic. A Python port can be verified against the identical fixture. This is the strongest argument for Audit B's side and I want it on the record.

**Local-first is the simpler security model for one person.** Data never leaves the machine; there is no server to patch, no database to breach remotely, no credential store to harden ([Thrust](https://thrust.finance/learn/best-privacy-first-personal-finance-apps-2026/), [SenticMoney](https://senticmoney.com/blog/personal-finance-software-local-vs-cloud)). A pure local-first app is dramatically simpler to run than a self-hosted server, and for one-person setups often sufficient ([Super Productivity](https://super-productivity.com/blog/self-hosted-productivity-guide-2026/)). Audit B's identity layer — OIDC, RBAC, workspaces, memberships, KMS envelope encryption — is correct engineering for a multi-tenant product and unjustified overhead for a confirmed single user.

---

## Recommendation: migrate TypeScript now, revisit the language after Phase 3

Not because TypeScript wins on merits. Because **sequencing dominates the language question.**

Phase 3 re-derives the strategy defaults under honest registered trial counts, against a never-tuned holdout, on a point-in-time universe. Audit B's finding that `scripts/research-deep.mts` passes `commissionPct: 0.1` — 10 basis points against the application's 85 — makes that re-derivation more likely, not less, to come back negative. The sweeps that selected the shipped defaults may have modelled one-eighth the real friction.

If the strategies do not survive that test, the engine you spent three months rewriting in Python computes nothing worth computing. **Find out cheaply, in the language where the engine is already correct, and let the answer inform the stack.**

Concretely:

- Migrate the TS core per `docs/MIGRATION.md`. Golden fixture is the proof gate.
- Run Phase 3. Get the honest answer about the defaults.
- **Then** reopen this ADR with real information: do the strategies justify further investment, does the research workload actually strain TypeScript, has the Python sidecar's boundary become the friction point?

### Conditions on the Python boundary

- TypeScript remains authoritative for signals, costs, guardrails, portfolio
  state, tax lots, execution timing, and paper orders.
- Python is evidence-only and receives no exchange credentials or execution
  capability.
- Phase 3 pins the Python environment, validates both sides of the versioned
  contract, runs Python tests in CI, and adds bounded process supervision.
- Large immutable datasets use Parquet/Arrow rather than JSON payloads.
- The application remains usable when Python is absent or a research job fails.

## Adopt from Audit B regardless of language

These are stack-independent and it is right on all of them. They are folded into `MIGRATION.md` and `PLAN.md`:

- **One OMS state machine shared by paper and any eventual live path** — orders, transitions, idempotency, cancel/replace, fills, reconciliation. Not two implementations.
- **Double-entry position and cash ledger.** Every order-state mutation and ledger posting in one transaction.
- **Explicit reconciliation exceptions.** Never silently invent or resize a tax lot.
- **Canonical instrument identity** — `(venue, product_id, product_type)`, never symbol-only joins.
- **Decimal/fixed-point for all money.** Never binary float for orders or ledger entries.
- **Immutable dataset snapshots with run manifests**, not just a hash. A hash without the durable dataset is not reproducibility.
- **Trial counts must include human-guided iterations and feature screens**, not only the displayed finalists.
- **Nested chronological validation plus CSCV/PBO**, not track-switching walk-forward.
- **Benchmark-relative significance.** PSR/DSR test Sharpe against zero and search luck; the product claim is excess after costs versus hold and passive. Those are different questions.
- **Ambiguous order submissions transition to `unknown`, never blind retry.** Recovery queries the venue before deciding to resubmit.

## What changes if the answer is Python

If Phase 3 comes back positive and the language is revisited:

- The golden fixture ports unchanged — it is JSON.
- `packages/core` is pure functions over typed data with no I/O, which is the most portable shape a rewrite can start from.
- The Python sidecar contract already exists and can absorb responsibility incrementally rather than in one cut.
- Adapters, storage, and the shell are the expensive parts and would need to move too — which is precisely why this decision should not be made before the engine has proven it is worth carrying.

## Consequences of accepting this ADR

**Accepted:** faster path to the one answer that matters; the tested engine is preserved; local-first keeps the security model simple; no identity infrastructure is built for a single user. Cost: if the answer is eventually Python, some migration work is done twice — bounded, since `core` is I/O-free.

**If rejected in favour of Audit B:** stronger long-term quant ecosystem, a real OMS and ledger from day one, and a UI reachable from any device. Cost: rewriting ~20,000 tested lines including the statistical core, plus identity and secrets infrastructure a single user does not need, before knowing whether the strategies are real.

---

**Decision:** Accept TypeScript/Electron/SQLite with an evidence-only Python
research toolchain. Review after Phase 3; do not rewrite the operational engine
before the registered-trial research gate reports its result.
**Decided by:** Project owner
**Date:** 2026-08-01
