/**
 * The negative-results ledger.
 *
 * `docs/PLAN.md` P8 makes this a deliverable and says of a negative outcome:
 * "A negative result here is a success. It is the single most valuable thing
 * this project can tell its owner." Ten rejected ideas is the most trustworthy
 * thing this application can show, so the ledger is first-class data rather
 * than prose someone has to go read.
 *
 * **Why this is curated data and not generated from `docs/studies/`.** Only a
 * minority of the 26 files there report a strategy finding — most are
 * engineering decisions (SQLite binding, structured logging, the primitive
 * spike). The files carry no frontmatter, so there is nothing machine-readable
 * to filter on, and the predecessor's findings are not in this repository at
 * all: they live in an Obsidian vault outside it. A generated manifest would
 * therefore be both wrong and incomplete.
 *
 * Drift is prevented by `tests/negative-findings.test.ts`, which asserts every
 * `coqui-study` reference resolves to a real file — the same doc-integrity
 * pattern `tests/handler-inventory.test.ts` already uses.
 */

/** `no-edge` is weaker than `not-adopted`: the test could not detect signal either way. */
export type NegativeFindingOutcome = 'not-adopted' | 'no-edge';

/**
 * `predecessor-vault` entries are recorded from the predecessor's own ledger and
 * are **not independently verifiable from this repository** — their evidence
 * lives in an Obsidian vault outside it. The distinction is on the record so a
 * surface can say which findings this codebase can actually stand behind.
 */
export type NegativeFindingSource = 'coqui-study' | 'predecessor-vault';

export interface NegativeFinding {
  readonly id: string;
  readonly title: string;
  readonly outcome: NegativeFindingOutcome;
  readonly source: NegativeFindingSource;
  /** A `docs/studies/*.md` path, or a vault note reference for predecessor entries. */
  readonly reference: string;
  /** One line stating what was tested and what came back. */
  readonly summary: string;
}

export const NEGATIVE_FINDINGS: readonly NegativeFinding[] = Object.freeze([
  Object.freeze({
    id: 'alt-rotation',
    title: 'Cross-sectional alt rotation',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 29',
    summary:
      'Ranking a 24-coin universe by risk-adjusted momentum lost to hold-BTC on every ' +
      'metric across a full cycle; turnover burned $40–88k on a $10k start.',
  }),
  Object.freeze({
    id: 'fear-greed-overlay',
    title: 'Fear & Greed exposure overlay',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 31',
    summary: 'Contrarian exposure scaling on the sentiment index did not improve risk-adjusted return.',
  }),
  Object.freeze({
    id: 'supervised-meta-label',
    title: 'Supervised meta-label on daily bars',
    outcome: 'no-edge',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 28',
    summary: 'Triple-barrier labels over 1,793 samples produced AUC 0.47 — no detectable signal.',
  }),
  Object.freeze({
    id: 'mean-excess',
    title: 'Mean-excess filter',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 33',
    summary: 'Recorded as a ledger entry in note 38; see the enumeration discrepancy below.',
  }),
  Object.freeze({
    id: 'dip-buy',
    title: 'Dip-buy entry rule',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 43 enumeration',
    summary: 'Recorded as a ledger entry in note 43; see the enumeration discrepancy below.',
  }),
  Object.freeze({
    id: 'volume-gate',
    title: 'Volume-confirmation gate',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 36',
    summary: 'Requiring volume agreement before acting did not improve outcomes; Coinbase volume history limits it further.',
  }),
  Object.freeze({
    id: 'profit-protect',
    title: 'Profit-protect exit rule',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 38',
    summary: 'Locking gains at a threshold reduced risk-adjusted return rather than protecting it.',
  }),
  Object.freeze({
    id: 'trend-ensemble',
    title: 'Multi-lookback trend ensemble',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 43',
    summary: 'Pre-registered; the ensemble did not beat the single-lookback incumbent by the declared margin.',
  }),
  Object.freeze({
    id: 'regime-exposure-caps',
    title: 'Regime-conditioned exposure caps',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 48',
    summary:
      'Pre-registered; rolling Sortino 1.32 vs 1.70 incumbent, 43% return sacrificed, ' +
      'CPCV win rate 7%, PBO 25%.',
  }),
  Object.freeze({
    id: 'adaptive-pick',
    title: 'Regime-switching strategy selection',
    outcome: 'not-adopted',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 49',
    summary:
      'Pre-registered; Sortino 0.30 vs 0.74 and 15pp deeper drawdown. PBO 10% showed ' +
      "in-sample winners keep winning, so not adapting is the right adaptation.",
  }),
  Object.freeze({
    id: 'pooled-meta-label',
    title: 'Pooled meta-label retry',
    outcome: 'no-edge',
    source: 'predecessor-vault',
    reference: 'predecessor vault note 50',
    summary:
      'Pre-registered; AUC 0.478 over ~9,000 pooled samples across 8 years. Closes the ' +
      'direction: daily-bar ML on free price data needs new information, not more model.',
  }),
  Object.freeze({
    id: 'trendvol-replacement-v1',
    title: 'Trend-vol replacement v1',
    outcome: 'not-adopted',
    source: 'coqui-study',
    reference: 'docs/studies/trendvol-replacement-v1-2026-08-09.md',
    summary:
      'Coqui-run and pre-registered. The selected candidate earned positive holdout excess ' +
      'but its confidence lower bounds were negative, PBO was 28.6% against a 5% ceiling, ' +
      'and drawdown 35.84% against a 35% limit.',
  }),
] satisfies NegativeFinding[]);

/**
 * A known inconsistency in the predecessor's own record, preserved rather than
 * resolved.
 *
 * Vault note 38 enumerates the ledger as rotation, F&G, meta-label,
 * **mean-excess**, volume, profit-protect. Note 43 enumerates it as F&G,
 * rotation, volume gate, profit-protect, **dip-buy**, meta-label, trend
 * ensemble. The two disagree about one slot. Both are carried above with
 * summaries that say so, because silently dropping one would understate the
 * search budget and silently merging them would invent a finding.
 */
export const NEGATIVE_FINDING_LEDGER_NOTE =
  'Vault notes 38 and 43 enumerate one ledger slot differently (mean-excess vs dip-buy). ' +
  'Both are listed; neither is independently verifiable from this repository.';

export function negativeFindingCount(): number {
  return NEGATIVE_FINDINGS.length;
}
