# P5 wireframes and task maps — 2026-08-21

**Status: awaiting owner approval on information hierarchy.**

`docs/UI-UX.md` §0 requires low-fidelity wireframes for the scoreboard,
portfolio, and paper-action review, approved on hierarchy, *before* any visual
theme or component selection. This is that artifact. It is deliberately
typographic: no color, no spacing decisions, no component library. If a region
cannot justify itself in ASCII, styling will not save it.

Every region below names the user question it answers. A region that answers no
question is deleted rather than decorated.

---

## Screen 1 — Strategy scoreboard

The first screen, and the one that sets the language for the rest
(`docs/UI-UX.md` §2).

### Task map

| # | User question | Region | Must be answerable without |
|---|---|---|---|
| 1 | Is anything wrong right now? | Status rail | scrolling |
| 2 | Which track is leading, and can I act on it? | Decision summary | opening another screen |
| 3 | How do the tracks actually compare? | Scoreboard table | hovering |
| 4 | Why should I believe this number? | Provenance on every row | documentation |
| 5 | What has already been ruled out? | Negative findings | leaving the app |
| 6 | Why is trading blocked? | Action area | reading code |

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [wallet: main ▾]  MODE paper  KILL armed·OFF   data 3m ago ●fresh            │ 1
│ jobs: idle        last reconcile 2026-08-21 06:00Z  ·  cost model 85bps      │
├──────────────────────────────────────────────────────────────────────────────┤
│ LEADER   trendvol                                    RISK STAGE  2 of 5      │ 2
│ after-cost return +18.4%   ·   sample 412d   ·   Sortino 0.61                │
│                                                                              │
│ ⚠ NOT VALIDATED — parameters are legacy defaults. The 2026-08-10             │
│   replacement study was negative (PBO 28.6% vs 5% ceiling). Trading is       │
│   blocked because the evidence gate is not met, not because of an error.     │
│                                              [ what would unblock this? ]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ TRACK      AFTER-COST   MAXDD    SORTINO   DSR        SAMPLE   PROVENANCE    │ 3,4
│ ─────────────────────────────────────────────────────────────────────────    │
│ hold          +11.2%   −44.1%      0.38      —         412d    ⓘ bars·cb     │
│ trendvol ★    +18.4%   −31.7%      0.61    0.41 ▲ub    412d    ⓘ 7a3f…  unv  │
│ voltarget      +9.8%   −28.4%      0.44    0.22 ▲ub    412d    ⓘ 7a3f…  unv  │
│ momentum       +6.1%   −39.0%      0.29    0.08 ▲ub    412d    ⓘ 7a3f…  unv  │
│ passive        +4.4%   −22.8%      0.31      —         412d    ⓘ bars·cb     │
│                                                                              │
│ ▲ub  DSR deflated against an UPPER BOUND of 215 trials. The true count is    │
│      no larger, so a figure that clears here clears at the true count too.   │
│ unv  parameters are legacy/unvalidated — no adopted study backs them.        │
├──────────────────────────────────────────┬───────────────────────────────────┤
│ EVIDENCE                                 │ RULED OUT (10)                    │ 5
│  ┌────────────────────────────────────┐  │  alt rotation        negative     │
│  │      equity, after cost            │  │  fear & greed        negative     │
│  │  ╱╲    ╱╲╱                         │  │  volume gate         negative     │
│  │ ╱  ╲__╱                            │  │  profit-protect      negative     │
│  └────────────────────────────────────┘  │  meta-label          no edge      │
│  walk-forward   adds_value (3 folds)     │  regime caps         negative     │
│  dataset  7a3f9c…  ·  code  0995980      │  adaptive pick       negative     │
│  study    trendvol-replacement-v1        │            [ see all studies ]    │
├──────────────────────────────────────────┴───────────────────────────────────┤
│ ACTION            paper preview only — no live path exists in this build     │ 6
│ [ preview rebalance ]   blocked: evidence gate 0/3 met                       │
│   · 90 observed days      412 ✓                                              │
│   · 50 decisions           31 ✗                                              │
│   · 30 fills               12 ✗                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Why it is shaped this way

The **warning sits above the table, not below it.** A user who reads only the top
third must still leave knowing the numbers are unvalidated. Putting the caveat
under the data would let the data be read first and the caveat never.

**`▲ub` is a footnote marker, not a tooltip.** §0 forbids exposing provenance
only on hover, and the direction of the bound is the whole point — a bare
"DSR 0.41" would be a stronger claim than the evidence supports.

**Negative findings are a peer of the evidence panel, not a buried page.**
`docs/PLAN.md` §6 treats the negative-results ledger as a headline product
feature; ten rejected ideas is the most trustworthy thing this app can show.

**The gate shows counts, not a percentage.** "0/3 met" with the raw numbers
underneath is checkable. A progress bar would imply the gate is a countdown
rather than a set of conditions, and would invite reading 89/90 days as "almost".

**★ marks the leader; it never uses color alone** (§1).

---

## Screen 2 — Portfolio

### Task map

| # | User question | Region |
|---|---|---|
| 1 | What is it worth, and is that figure complete? | Header total |
| 2 | What do I hold and how did each position do? | Holdings table |
| 3 | Which prices are stale or missing? | Per-row freshness |
| 4 | What is my cost basis and unrealised position? | Lot detail (expand) |
| 5 | Does this match the exchange? | Reconciliation strip |

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [status rail — identical to scoreboard]                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ PORTFOLIO VALUE   $12,481.06        priced 7 of 8 holdings                   │ 1
│ unrealised        +$1,204.11        ⚠ 1 holding unpriced — total is a        │
│ cost basis        $11,276.95          PRICED SUBTOTAL, not complete equity   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ASSET   QTY          PRICE      VALUE       COST      UNREAL     PRICE AS OF │ 2,3
│ ────────────────────────────────────────────────────────────────────────────  │
│ BTC     0.10424000   64,001.12  6,671.47   6,010.00  +661.47 ▲   3m  ●fresh  │
│ ETH     1.80000000    2,410.55  4,338.99   4,120.44  +218.55 ▲   3m  ●fresh  │
│ SOL    12.00000000      118.22  1,418.64   1,146.51  +272.13 ▲  41m  ◐aging  │
│ LINK   30.00000000        1.73     51.96      —          —      3m  ●fresh  │
│ XYZ    100.0000000         —        —      205.00      —        —   ○ none  │
│                                                     ↳ no price source        │
├──────────────────────────────────────────────────────────────────────────────┤
│ RECONCILIATION   last run 06:00Z   ·   2 exceptions, unresolved              │ 5
│  · SOL  exchange 12.5  vs  lots 12.0   difference 0.5  → needs your decision │
│  · XYZ  exchange 0     vs  lots 100    difference −100 → needs your decision │
│    Coqui will not invent a lot or rescale to close these. [ resolve ]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Why it is shaped this way

**"Priced subtotal, not complete equity" is stated in the header**, beside the
number it qualifies. An unpriced holding silently omitted from a total is the
predecessor's exact failure mode, and a number that is wrong by an unknown amount
is worse than a number labelled incomplete.

**Reconciliation exceptions are shown, never auto-closed.** Invariant 12 forbids
inventing a zero-basis lot or rescaling. The UI therefore has to have somewhere
to put an unresolved difference, and it is on the main screen rather than behind
a settings page.

**`▲` accompanies every gain and `▼` every loss** — sign plus shape plus label,
never color alone (§1).

---

## Screen 3 — Paper-action review

The confirmation step for the only financial action that exists in this build.

### Task map

| # | User question | Region |
|---|---|---|
| 1 | Exactly what am I about to do? | Order summary |
| 2 | What will it cost me? | Cost breakdown |
| 3 | What does it do to my risk? | Risk effect |
| 4 | Which rules did it have to pass? | Guardrail checklist |
| 5 | Can I still stop? | Confirm / cancel |

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ REVIEW PAPER ORDER                          MODE paper · no real money moves │ 1
├──────────────────────────────────────────────────────────────────────────────┤
│   BUY   SOL-USD                                                              │
│   notional        $250.00                                                    │
│   est. quantity   2.11467000  @ est. 118.22   (next open, not this bar)      │
├──────────────────────────────────────────────────────────────────────────────┤
│ ESTIMATED COST                                                    $2.13      │ 2
│   fee      60bps   $1.50        These are estimates. The fill uses the next  │
│   spread   10bps   $0.25        bar's open, so the final number will differ. │
│   slippage 15bps   $0.38                                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ RISK EFFECT                                                                  │ 3
│   SOL weight        11.4%  →  13.4%          position cap 25%      ok        │
│   total at risk     62.0%  →  64.0%          cap 80%               ok        │
│   turnover today     2.0%  →   4.0%          cap 15%               ok        │
├──────────────────────────────────────────────────────────────────────────────┤
│ GUARDRAILS                                                                   │ 4
│   ✓ per-trade cap        $250 ≤ $500                                         │
│   ✓ position cap         13.4% ≤ 25%                                         │
│   ✓ total at risk        64.0% ≤ 80%                                         │
│   ✓ turnover cap          4.0% ≤ 15%                                         │
│   ✓ min trade size       $250 ≥ $25                                          │
│   ✓ trades this run        1 ≤ 3                                             │
│   ✓ kill switch          not engaged                                         │
│   ✓ mode                 paper                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                        [ cancel ]   [ submit paper order ]   │ 5
└──────────────────────────────────────────────────────────────────────────────┘
```

### Why it is shaped this way

**All eight guardrails are listed, including the ones that passed.** A checklist
showing only failures teaches the user that the absence of a warning means
nothing was checked. `CLAUDE.md` §3.5 puts these in code; this screen makes the
enforcement visible without implying the UI performs it.

**The cost breakdown itemises rather than totalling.** Invariant 4 makes
cost-model pessimism load-bearing, and a single "$2.13 fees" line invites the
question "can I turn that down". Three named components are harder to argue with.

**"next open, not this bar" appears next to the estimated price.** Invariant 6 is
the look-ahead rule; saying it here means a user who sees a different fill price
does not read it as a bug.

**No optimistic success.** `docs/UI-UX.md` §3.1 forbids it for financial actions.
Submit moves to a pending state with a stable label, and only a confirmed fill
renders as success. An ambiguous outcome renders as `unknown` — never as either.

---

## States every screen must define

Designed from real Coqui scenarios, not generic placeholders (§0).

| State | Scoreboard | Portfolio | Paper review |
|---|---|---|---|
| loading | skeleton rows, rail live | skeleton rows, header live | n/a — opens populated |
| empty | "no tracks have run yet" + how to start | "no holdings — import or add a lot" | n/a |
| stale | `◐aging` / `○stale` per figure | per-row freshness dot | recomputes before confirm |
| partial | tracks that ran, gap named | priced subtotal, count shown | blocked if any input missing |
| error | typed code + next safe action | per-row, table still renders | refuses to open |
| blocked | gate counts, reason in prose | n/a | failing guardrail highlighted |
| unknown | n/a | n/a | "outcome unconfirmed — do not retry" |

Error copy is driven by the stable issue codes the transport already defines
(`packages/contracts/src/rpc.ts`), so every failure has designed copy rather than
a raw string.

---

## Open questions for the owner

1. **Density default** — comfortable or compact on first run? The scoreboard is
   readable at both; the portfolio table is the one that benefits from compact.
2. **Is "RULED OUT" the right label** for the negative-results panel, or is
   "what we tested and rejected" worth the extra width?
3. **Reconciliation placement** — on the portfolio screen as drawn, or promoted
   to the status rail when exceptions exist?
