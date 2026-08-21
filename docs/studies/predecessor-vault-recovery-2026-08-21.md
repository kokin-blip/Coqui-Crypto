# Predecessor vault recovery — 2026-08-21

## Outcome

P3's blocker is cleared. The registry moves from **178, `known-lower-bound`** to
**215, `conservative-upper-bound`**, which means deflated Sharpe becomes
computable for the first time.

The change is not a claim that 215 is the true lifetime count. It is a claim that
215 is **not an under-count**, which is the only property DSR actually needs.
Deflating against too many trials can hide a real edge; deflating against too few
manufactures one. The registry now distinguishes those two failure modes instead
of refusing to answer.

## What the 2026-08-04 audit could not see

That audit concluded with: *"The predecessor source mentions an earlier rotation
round and private vault notes that are not present in Git."* Both gaps are now
closed, and one of them turned out to hide searches nobody had counted.

**The "private vault" is an Obsidian vault, not a secret.** `BUILD_PLAN.md`,
`README.md` and `CLAUDE.md` in the predecessor all point at
`Documents/Obsidian Vault/kokintrader/`, and it exists on the owner's machine:
52 notes, numbered 00–52, dated 2026-06-26 through 2026-07-10. The audit treated
it as unavailable because it is outside the repository. It was readable all along.

**The audit read one branch.** It states its source as `pivot/kokintrader` @
`80b5a1b`. Commit `5d164a3`, *"Adaptivity research arc: CPCV/PBO instruments + 3
pre-registered negatives"*, is **not an ancestor of that branch** — it is on
`kokinstocks`. Three pre-registered studies were therefore run, recorded, and
never counted:

```
$ git merge-base --is-ancestor 5d164a3 pivot/kokintrader  -> NO
$ git merge-base --is-ancestor 5d164a3 kokinstocks        -> YES
```

This is the more serious of the two findings. A missing count is visible as a
lower bound; a missing *branch* is invisible, and the audit's own framing —
"culminates in the negative trend-ensemble study at `4f33bb8`" — asserted a
completeness the branch topology did not support.

## Added records

| Record | Trials | Source |
|---|---:|---|
| `predecessor-rotation-round1-upper-bound` | 24 | vault note 29 + `research-deep.mts:266` |
| `predecessor-regime-allocator-arms` | 9 | vault note 48 (self-declared budget) |
| `predecessor-adaptive-pick-arms` | 2 | vault note 49 |
| `predecessor-pooled-metalabel-arms` | 2 | vault note 50 |
| **Recovered total** | **37** | |
| Previously audited | 178 | `predecessor-search-audit-2026-08-04.md` |
| **Registry total** | **215** | |

### Rotation round 1 — reconstructed, not recovered

Vault note 29 records two rounds of the rotation study and only the second
survives in code:

> **Round 1** (weekly, no buffer): catastrophic — every config lost to both
> benchmarks; best +102% vs BTC +872%; turnover burned **$40–88k on a $10k start**.

`scripts/research-deep.mts:266` corroborates it from the other side:

> `// lb120 + inverse-vol won round 1 (and everything lost to costs) — round 2`
> `// attacks turnover: hold-buffer hysteresis × slower cadences.`

Round 1 was overwritten before the first commit — even the earliest revision of
that file, `23da510`, already contains round 2's grid. So the **axes** are known
(cadence fixed weekly, no buffer, lookback swept and won by 120, weighting swept
and won by inverse-vol) while the **values** are not recorded anywhere.

The reconstruction takes the widest defensible reading of each swept axis:
round 2's `topN` set `{3, 5, 8}`, the primary grid's lookback set
`{60, 90, 120, 180}`, and both weightings — 3 × 4 × 2 = **24**. If the real
round 1 was narrower, the registry over-counts, which is the safe direction. It
is recorded as `legacy-unresolved` with null dataset and cost-profile hashes,
exactly like every other historical record.

### The adaptivity arc — recovered, not reconstructed

These three are pre-registered notes with frozen decision rules, so their budgets
are stated rather than inferred. Note 48 declares its own: *"Arm-aware DSR
(deflated against all 9 trials raced here)"*, and that number is used in
preference to recounting its arms. Notes 49 and 50 contribute their new arms only
— the six re-raced incumbent tracks are already counted, following the 2026-08-04
rule that repeated baselines are not counted twice.

All three were negative (regime caps, adaptive pick, pooled meta-label), which is
why counting them matters: they consumed search budget without producing a
default, and that is precisely the multiple-testing cost DSR exists to charge.

They are filed under `trendvol` because each was raced against the frozen
trendvol incumbent and each could have altered the trendvol default path.
Attributing them there raises trendvol's deflation, which is the conservative
placement.

## Enforcement added

- `TrialRegistryCompleteness` gains `conservative-upper-bound`.
  `trialCountForSignificance` supplies a budget for it and for `complete`, and
  continues to supply nothing for `known-lower-bound`.
- Migration 45 rebuilds `trial_registry_meta` to admit the new value. SQLite
  cannot alter a CHECK constraint, so the single row is carried across a table
  rebuild; the append-only records table is untouched.
- `setTrialRegistryCompleteness` only ever advances. It refuses to regress to
  `known-lower-bound`, which would silently withdraw a DSR the scoreboard had
  already displayed, and refuses to downgrade a `complete` audit.
- `seedPredecessorVaultRecovery` appends the four records idempotently and
  performs the promotion.

## What is still not true

**215 is not the lifetime count.** It is an upper bound on the searches that any
surviving artifact records. Nothing rules out further iterations that left no
trace in the repository, the vault, or the build log.

**The old runs remain unresolved.** They still lack preserved input bytes and an
immutable dataset hash, and the sweeps still passed `commissionPct: 0.1` — 10bps
against Coqui's 85bps profile. Every historical record stays
`legacy-unresolved`. A computable DSR does not make these runs citable evidence;
it makes the multiple-testing cost of the *replacement* study computable.

**The defaults are still unvalidated.** The 2026-08-10 trend-ensemble replacement
run was negative on its own frozen criteria (PBO 28.6% against a 5% ceiling,
drawdown 35.84% against a 35% limit). Nothing here revives it. Strategy
parameters continue to render as legacy/unvalidated wherever they appear.

## Next evidence action

Re-run the registered replacement study now that a budget exists, and report DSR
against 215 with the bound's direction stated on the surface — the scoreboard
must show "deflated against an upper bound of 215 trials", never a bare number.
A DSR that clears at 215 clears at the true count too, since the true count is no
larger.
