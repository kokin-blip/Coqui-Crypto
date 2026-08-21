import type { JsonValue, TrialRecord } from '@coqui/core';
import {
  appendTrialRecord,
  loadTrialRegistry,
  setTrialRegistryCompleteness,
  type Db,
} from '@coqui/storage';

const STUDY = 'docs/studies/predecessor-search-audit-2026-08-04.md';
const VAULT_STUDY = 'docs/studies/predecessor-vault-recovery-2026-08-21.md';
const ADAPTIVITY_REVISION = '5d164a3';
const PRIMARY_REVISION = '23da510264334c1a7ba56f1a39d346044b2747f6';
const DEFENSIVE_REVISION = 'e53e5a0706360933e754a65a9dc603d8b2fbb888';

function vaultRecovered(record: {
  id: string;
  family: TrialRecord['family'];
  searchKind: TrialRecord['searchKind'];
  parameterSpace: Readonly<Record<string, readonly JsonValue[]>>;
  trialCount: number;
  searchedAt: string;
  codeRevision: string;
}): TrialRecord {
  return Object.freeze({
    ...record,
    evidenceStatus: 'legacy-unresolved',
    datasetHash: null,
    costProfileHash: null,
    producedDefaults: {},
    studyRef: VAULT_STUDY,
  });
}

function legacy(record: {
  id: string;
  family: TrialRecord['family'];
  searchKind: TrialRecord['searchKind'];
  parameterSpace: Readonly<Record<string, readonly JsonValue[]>>;
  trialCount: number;
  searchedAt: string;
  codeRevision: string;
  producedDefaults?: Readonly<Record<string, JsonValue>>;
}): TrialRecord {
  return Object.freeze({
    ...record,
    evidenceStatus: 'legacy-unresolved',
    datasetHash: null,
    costProfileHash: null,
    producedDefaults: record.producedDefaults ?? {},
    studyRef: STUDY,
  });
}

/** Code-visible lower bound; missing private vault iterations keep it incomplete. */
export const PREDECESSOR_TRIAL_AUDIT: readonly TrialRecord[] = Object.freeze([
  legacy({
    id: 'predecessor-primary-momentum-grid', family: 'momentum', searchKind: 'grid',
    parameterSpace: { cadence: [7, 14, 30], lookbackDays: [60, 90, 120, 180] },
    trialCount: 12, searchedAt: '2026-07-04T11:19:55.000Z', codeRevision: PRIMARY_REVISION,
    producedDefaults: { lookbackDays: 120 },
  }),
  legacy({
    id: 'predecessor-primary-voltarget-grid', family: 'voltarget', searchKind: 'grid',
    parameterSpace: {
      cadence: [7, 14, 30], targetVolPct: [40, 50, 60], trendGateDays: [100, 200],
    },
    trialCount: 18, searchedAt: '2026-07-04T11:19:55.000Z', codeRevision: PRIMARY_REVISION,
    producedDefaults: { targetVolPct: 40, trendGateDays: 100 },
  }),
  legacy({
    id: 'predecessor-primary-trendvol-grid', family: 'trendvol', searchKind: 'grid',
    parameterSpace: {
      cadence: [7, 14, 30], lookbackDays: [60, 90, 120, 180],
      targetVolPct: [40, 50, 60], trendGateDays: [100, 200],
    },
    trialCount: 72, searchedAt: '2026-07-04T11:19:55.000Z', codeRevision: PRIMARY_REVISION,
    producedDefaults: { cadence: 14, lookbackDays: 120, targetVolPct: 40, trendGateDays: 100 },
  }),
  legacy({
    id: 'predecessor-defensive-momentum-grid', family: 'momentum', searchKind: 'grid',
    parameterSpace: {
      defensiveScale: [0.2, 0.35, 0.5], maxRelativeTilt: [0.2, 0.35, 0.5],
    },
    trialCount: 9, searchedAt: '2026-07-04T19:50:13.000Z',
    codeRevision: DEFENSIVE_REVISION,
    producedDefaults: { defensiveScale: 0.2, maxRelativeTilt: 0.35 },
  }),
  legacy({
    id: 'predecessor-defensive-voltarget-grid', family: 'voltarget', searchKind: 'grid',
    parameterSpace: { belowTrendMaxExposure: [0.3, 0.5, 0.7] },
    trialCount: 3, searchedAt: '2026-07-04T19:50:13.000Z',
    codeRevision: DEFENSIVE_REVISION,
    producedDefaults: { belowTrendMaxExposure: 0.7 },
  }),
  legacy({
    id: 'predecessor-defensive-trendvol-grid', family: 'trendvol', searchKind: 'grid',
    parameterSpace: {
      defensiveScale: [0.2, 0.35, 0.5], maxRelativeTilt: [0.2, 0.35, 0.5],
      belowTrendMaxExposure: [0.3, 0.5, 0.7],
    },
    trialCount: 27, searchedAt: '2026-07-04T19:50:13.000Z',
    codeRevision: DEFENSIVE_REVISION,
    producedDefaults: {
      defensiveScale: 0.2, maxRelativeTilt: 0.35, belowTrendMaxExposure: 0.7,
    },
  }),
  legacy({
    id: 'predecessor-rotation-grid-visible-round', family: 'rotation', searchKind: 'grid',
    parameterSpace: { topN: [3, 5, 8], cadence: [7, 14, 30], holdBufferMultiple: [1, 2, 3] },
    trialCount: 27, searchedAt: '2026-07-04T11:19:55.000Z', codeRevision: PRIMARY_REVISION,
    producedDefaults: { topN: 5, cadence: 14, holdBufferMultiple: 2 },
  }),
  legacy({
    id: 'predecessor-fear-greed-screen', family: 'trendvol', searchKind: 'feature-screen',
    parameterSpace: { overlay: ['contrarian-both', 'trim-greed', 'lean-fear'] },
    trialCount: 3, searchedAt: '2026-07-04T19:50:13.000Z',
    codeRevision: DEFENSIVE_REVISION,
  }),
  legacy({
    id: 'predecessor-combined-finalist', family: 'trendvol', searchKind: 'human-guided',
    parameterSpace: { candidate: ['c14-lb120-tv40-tg100-ds.2-rt.35-bt.7'] },
    trialCount: 1, searchedAt: '2026-07-04T19:50:13.000Z',
    codeRevision: DEFENSIVE_REVISION,
    producedDefaults: {
      cadence: 14, lookbackDays: 120, targetVolPct: 40,
      trendGateDays: 100, defensiveScale: 0.2, belowTrendMaxExposure: 0.7,
    },
  }),
  legacy({
    id: 'predecessor-volume-confirmation-screen', family: 'trendvol',
    searchKind: 'feature-screen', parameterSpace: { volumeGate: [true] }, trialCount: 1,
    searchedAt: '2026-07-05T02:02:53.000Z',
    codeRevision: 'ffce414ea5f7db2d4b978f97cb46c88a9623e1f0',
  }),
  legacy({
    id: 'predecessor-profit-protect-screen', family: 'trendvol', searchKind: 'feature-screen',
    parameterSpace: { minGain: [0.02], retrace: [0.01] }, trialCount: 1,
    searchedAt: '2026-07-05T07:38:57.000Z',
    codeRevision: '4e0f2938484d82247c59cb2166da25354ee0ade1',
  }),
  legacy({
    id: 'predecessor-ensemble-momentum-screen', family: 'momentum',
    searchKind: 'feature-screen',
    parameterSpace: { ensemble: [[63, 126, 252], [21, 63, 126, 252]] }, trialCount: 2,
    searchedAt: '2026-07-06T06:24:17.000Z',
    codeRevision: '4f33bb86d6475f2ee207b2cc2c71682497d7fca8',
  }),
  legacy({
    id: 'predecessor-ensemble-trendvol-screen', family: 'trendvol',
    searchKind: 'feature-screen',
    parameterSpace: { ensemble: [[63, 126, 252], [21, 63, 126, 252]] }, trialCount: 2,
    searchedAt: '2026-07-06T06:24:17.000Z',
    codeRevision: '4f33bb86d6475f2ee207b2cc2c71682497d7fca8',
  }),
]);

/**
 * Searches the 2026-08-04 audit could not see.
 *
 * Two blind spots, both closed by recovering the Obsidian vault at
 * `Documents/Obsidian Vault/kokintrader/`. The audit read only branch
 * `pivot/kokintrader`, so the three pre-registered adaptivity studies committed
 * to `kokinstocks` were never counted. And the first rotation round was
 * overwritten before any commit, surviving only as vault prose plus a code
 * comment; its cardinality is reconstructed as an upper bound, never as fact.
 *
 * See `docs/studies/predecessor-vault-recovery-2026-08-21.md`.
 */
export const PREDECESSOR_VAULT_RECOVERY: readonly TrialRecord[] = Object.freeze([
  vaultRecovered({
    // Vault note 29 records "Round 1 (weekly, no buffer)"; research-deep.mts
    // says "lb120 + inverse-vol won round 1". The swept axes are therefore
    // known, the values are not. This takes the widest defensible reading:
    // round 2's topN set, the primary grid's lookback set, both weightings.
    id: 'predecessor-rotation-round1-upper-bound', family: 'rotation', searchKind: 'grid',
    parameterSpace: {
      topN: [3, 5, 8],
      lookbackDays: [60, 90, 120, 180],
      weighting: ['equal', 'inverse_vol'],
      cadence: [7],
      holdBufferMultiple: [0],
    },
    trialCount: 24,
    searchedAt: '2026-07-04T19:50:13.000Z',
    codeRevision: PRIMARY_REVISION,
  }),
  vaultRecovered({
    // Vault note 48 declares its own budget: "deflated against all 9 trials
    // raced here". Its own number is used rather than a recount of the arms.
    id: 'predecessor-regime-allocator-arms', family: 'trendvol', searchKind: 'human-guided',
    parameterSpace: {
      caps: [
        [1.0, 0.8, 0.4, 0.25],
        [1.0, 0.9, 0.6, 0.4],
      ],
      trendDays: [200], volDays: [30], confirmDays: [5], rampDays: [28],
    },
    trialCount: 9,
    searchedAt: '2026-07-10T06:33:40.000Z',
    codeRevision: ADAPTIVITY_REVISION,
  }),
  vaultRecovered({
    // Note 49: two new arms; the six re-raced incumbents are already counted.
    id: 'predecessor-adaptive-pick-arms', family: 'trendvol', searchKind: 'human-guided',
    parameterSpace: { dwellDays: [28, 42], switchMargin: [0.2, 0.3] },
    trialCount: 2,
    searchedAt: '2026-07-10T06:33:40.000Z',
    codeRevision: ADAPTIVITY_REVISION,
  }),
  vaultRecovered({
    // Note 50: two pooled feature sets, both no_edge.
    id: 'predecessor-pooled-metalabel-arms', family: 'trendvol', searchKind: 'feature-screen',
    parameterSpace: { featureSet: ['v1-base', 'v2-regime'] },
    trialCount: 2,
    searchedAt: '2026-07-10T06:33:40.000Z',
    codeRevision: ADAPTIVITY_REVISION,
  }),
]);

/** Idempotently append the auditable predecessor lower-bound records. */
export function seedPredecessorTrialAudit(database: Db): number {
  const existing = new Set(loadTrialRegistry(database).records.map((record) => record.id));
  let inserted = 0;
  for (const record of PREDECESSOR_TRIAL_AUDIT) {
    if (!existing.has(record.id)) {
      appendTrialRecord(record, database);
      inserted += 1;
    }
  }
  return inserted;
}

/**
 * Seed the vault-recovered searches and promote the registry to a usable state.
 *
 * The promotion is the point. Before this the registry was a known lower bound,
 * which supplies no budget and leaves DSR permanently unavailable. Afterwards it
 * is a conservative upper bound: not exact, but provably not an under-count, so
 * deflating against it can understate an edge and never invent one.
 */
export function seedPredecessorVaultRecovery(database: Db): number {
  const existing = new Set(loadTrialRegistry(database).records.map((record) => record.id));
  let inserted = 0;
  for (const record of PREDECESSOR_VAULT_RECOVERY) {
    if (!existing.has(record.id)) {
      appendTrialRecord(record, database);
      inserted += 1;
    }
  }
  setTrialRegistryCompleteness('conservative-upper-bound', database);
  return inserted;
}
