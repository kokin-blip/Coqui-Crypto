# P5 wireframes and task maps — 2026-08-21

**Status: APPROVED on information hierarchy, 2026-08-21.**

Density default is **comfortable** (owner). The negative-results panel is labelled
**`NEGATIVE FINDINGS`** and reconciliation appears in **both** the rail and the portfolio
strip — both delegated to research; the reasoning is recorded at the foot of this document
under "Resolved questions". The remaining gate is the §7.9 screenshot review.

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
| 5 | What has already been tested and not adopted? | Negative findings | leaving the app |
| 6 | Why is trading blocked? | Action area | reading code |

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [wallet: main ▾]  MODE paper  KILL armed·OFF   data 3m ago ●fresh            │ 1
│ jobs: idle        reconcile 06:00Z · 2 unresolved   ·  cost model 85bps      │
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
│ EVIDENCE                                 │ NEGATIVE FINDINGS (10)            │ 5
│  ┌────────────────────────────────────┐  │  alt rotation      not adopted    │
│  │      equity, after cost            │  │  fear & greed      not adopted    │
│  │  ╱╲    ╱╲╱                         │  │  volume gate       not adopted    │
│  │ ╱  ╲__╱                            │  │  profit-protect    not adopted    │
│  └────────────────────────────────────┘  │  meta-label        no edge        │
│  walk-forward   adds_value (3 folds)     │  regime caps       not adopted    │
│  dataset  7a3f9c…  ·  code  0995980      │  adaptive pick     not adopted    │
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
`docs/PLAN.md` P8 makes the "Negative-results surface" a deliverable and says of a
negative outcome: "A negative result here is a success. It is the single most
valuable thing this project can tell its owner." Ten of them is the most
trustworthy thing this app can show.

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

## Screen 3 — Paper-action review · **SUPERSEDED 2026-08-22 (B7)**

> **This screen was not built, deliberately.** It assumed a manual
> preview-and-submit flow. The engine that shipped in P6 is **scheduler-driven**:
> a daily UTC slot wakes it, `runExecutionGates` approves or refuses, and the OMS
> executes without a human in the loop. There is no user-initiated order to
> confirm, so a review screen would have advertised an interaction that does not
> exist — and a `[ submit paper order ]` button with nothing behind it is exactly
> the kind of claim this project refuses to make.
>
> The owner's direction (2026-08-21): *"that could cause confusion, maybe we
> should just integrate the paper trade mode into the app how it is and show it
> side by side with 'actual portfolio value' 'possible (paper) portfolio value'"*.
>
> **What was built instead** — `PaperComparison.tsx`, rendered beside the real
> total on screen 2:
>
> ```
> ACTUAL PORTFOLIO VALUE  $12,481.06     POSSIBLE (PAPER) VALUE — simulation, not money
>   priced 6 of 6                          $13,204.11   ▲ +$723.05
>   unrealised ▲ +$1,204.55                paper started 2026-06-14
>   cost basis $11,276.51                  ● 68 of 90 days · ○ 41 of 50 decisions · ○ 22 of 30 fills
>                                          last run 2026-08-21: the guardrails refused every
>                                          proposed trade.
>                                          Meeting the evidence bar makes live trading
>                                          considerable, never enabled.
> ```
>
> The three intents below survive the change and were carried into that
> component: costs stay itemised, the fill-timing rule stays visible in the run
> explanation, and there is still no optimistic success — a stand-down is stated
> in plain words rather than rendered as nothing having happened. The guardrail
> checklist moves to P8's risk dashboard, where it describes the rules
> continuously rather than per-order.
>
> The original design follows, unedited, as the record of what was decided and
> why it changed.

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

(The `Paper review` column below describes the superseded screen; its states are
now served by the paper comparison on the portfolio screen.)

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

## Resolved questions

### 1. Density default — **comfortable**

Owner's call. Already the persisted default at
`packages/services/src/accounts/settings.ts`, and `account_preferences_v1` carries no column
default, so this required no migration. The compact token still exists and remains a
mandatory screenshot-review state (`docs/UI-UX.md` §0).

### 2. Panel label — **`NEGATIVE FINDINGS`**, not "RULED OUT"

- **It is the spec's own name for the region.** `docs/UI-UX.md` §2.4 lists the Evidence view
  as containing "negative findings". Using a different word on screen than in the IA spec
  costs consistency for nothing, and consistency is one of the six NN/g heuristics §8 cites
  as the review's grounding.
- **It matches the project's canonical noun.** `docs/PLAN.md` P8 names the deliverable the
  "Negative-results surface"; `docs/ARCHITECTURE.md` describes `docs/studies/` as holding
  "negative results". "RULED OUT" appeared nowhere in the repository except this document.
- **"Ruled out" overclaims.** Each study's own status is "not adopted", and several negatives
  are window-specific — the predecessor's note 29 keeps the rotation engine "in core for
  future re-tests (different universes/windows)". "Ruled out" asserts a finality the evidence
  does not support, which is precisely the kind of overclaim this project exists to avoid.
  Row status therefore reads `not adopted` / `no edge`, matching the studies.
- "What we tested and rejected" was the alternative. It has no precedent, reads against §0's
  demand for "concise, specific interface copy", and "rejected" is already this repo's word
  for rejected *library candidates* (ADR-0005).

### 3. Reconciliation — **detail on portfolio, state in the rail**

Both, asymmetrically, and it costs the rail no extra line.

- **The rail already had a reconciliation slot.** §2.1 puts "last successful reconciliation"
  there. This is not an addition; it makes that slot honest. Showing
  `last reconcile 06:00Z` while two exceptions sit unresolved answers the rail's own stated
  question — "Is anything wrong right now?" — with "no", which is false. The rail is exactly
  two full lines, so a new badge would have displaced something; rewording the existing slot
  does not.
- **The detail stays on portfolio.** §2 has the other screens reuse the scoreboard's patterns
  rather than duplicate content, and the resolve action belongs beside the lots it concerns.
  The rail entry is a pointer: `reconcile 06:00Z · 2 unresolved`.
- **It is not rendered as an alarm, because the code says it is not one.** A discrepancy is
  returned on the `ok: true` path with no severity field
  (`packages/services/src/accounts/coinbase-sync.ts`), stored as immutable evidence
  (migration 42), and absent from every failure code. This repo's blocking vocabulary —
  `canExecute`, the kill switch, guardrails, the evidence gate — is never invoked for
  reconciliation, and "halts on mismatch" belongs to P11 live trading. So the rail shows
  status, not a stop.
- Unchanged: on a main screen, never behind settings, never auto-closed, and never resolved
  by inventing or rescaling a lot (invariant 12).

---

## Remaining gate

The §7.9 screenshot review: the three workflows in light, dark, high-contrast, compact, 200%
zoom, stale data, negative evidence, and a blocked paper action.
