import { Decimal } from 'decimal.js';

import {
  decimal,
  instrumentKey,
  type Clock,
  type InstrumentIdentity,
  type PriceSource,
} from '@coqui/core';
import {
  latestWalletDecisionRun,
  listPaperBalances,
  type Db,
} from '@coqui/storage';

import { forwardPaperEvidence, type ForwardEvidenceView } from './forward-evidence.js';

/**
 * What the strategy would be worth, beside what you actually hold.
 *
 * This is deliberately **not** a separate paper screen. The engine is
 * scheduler-driven, so there is no user-initiated order to preview or confirm;
 * a paper console would imply an interaction that does not exist. Paper is a
 * comparison the user reads.
 *
 * The paper figure is a **simulation** and is labelled as one everywhere it
 * appears. It is priced with the same source as the real portfolio so the two
 * numbers are comparable — pricing them differently would make the difference
 * partly an artefact of the data rather than of the strategy.
 */

const CASH = 'USD' as const;

export type PaperStandDown = 'kill_switch_engaged' | 'no_policy' | 'no_intents' | 'gates_refused';

export interface PaperPosition {
  readonly instrument: InstrumentIdentity;
  readonly quantity: string;
  /** Null when the position could not be priced; never a zero standing in. */
  readonly valueUsd: string | null;
}

export interface PaperLastRun {
  readonly scheduledForMs: number;
  readonly decidedAtMs: number;
  readonly standDown: PaperStandDown | null;
  readonly filled: number;
  readonly refused: number;
}

export interface PaperPortfolioView {
  readonly profileId: string;
  readonly asOfMs: number;
  /** Literal `true`. No surface may present this as money. */
  readonly simulation: true;
  readonly startedAtMs: number | null;
  readonly cashUsd: string;
  readonly positions: readonly PaperPosition[];
  /** Priced positions plus cash. Null when a position could not be priced. */
  readonly totalValueUsd: string | null;
  readonly unpricedCount: number;
  readonly lastRun: PaperLastRun | null;
  readonly evidence: ForwardEvidenceView;
}

export interface PaperPortfolioDependencies {
  readonly database: Db;
  readonly clock: Clock;
  /** The same source the real portfolio uses, so the two figures compare. */
  readonly priceSource: PriceSource;
}

function parseInstrument(assetId: string): InstrumentIdentity | null {
  const [venue, productType, productId] = assetId.split('|');
  if (venue !== 'coinbase' || productType !== 'spot' || productId === undefined) return null;
  return { venue, productId, productType };
}

function parseLastRun(snapshotJson: string): Pick<PaperLastRun, 'standDown' | 'filled' | 'refused'> {
  try {
    const parsed = JSON.parse(snapshotJson) as Record<string, unknown>;
    return {
      standDown: (parsed['standDown'] as PaperStandDown | null) ?? null,
      filled: typeof parsed['filled'] === 'number' ? parsed['filled'] : 0,
      refused: typeof parsed['refused'] === 'number' ? parsed['refused'] : 0,
    };
  } catch {
    return { standDown: null, filled: 0, refused: 0 };
  }
}

export async function paperPortfolioView(
  dependencies: PaperPortfolioDependencies,
  profileId: string,
): Promise<PaperPortfolioView> {
  const { database } = dependencies;
  const asOfMs = dependencies.clock.nowMs();
  const balances = listPaperBalances(profileId, database);

  const cashUsd = balances.find((balance) => balance.assetId === CASH)?.quantity ?? '0';
  const assetBalances = balances.filter((balance) => balance.assetId !== CASH);

  const instruments = assetBalances
    .map((balance) => parseInstrument(balance.assetId))
    .filter((instrument): instrument is InstrumentIdentity => instrument !== null);

  const prices =
    instruments.length === 0
      ? new Map<string, { priceUsd: string }>()
      : await dependencies.priceSource.spot(instruments);

  // Exact decimal throughout. Invariant 11 forbids binary float for balances,
  // and a comparison figure computed with floats would drift from the ledger
  // it is being compared against.
  let total = new Decimal(decimal(cashUsd));
  let unpricedCount = 0;
  const positions: PaperPosition[] = [];

  for (const balance of assetBalances) {
    const instrument = parseInstrument(balance.assetId);
    if (instrument === null) {
      unpricedCount += 1;
      continue;
    }
    const observation = prices.get(instrumentKey(instrument));
    if (observation === undefined) {
      // Unpriced stays null rather than zero: a zero would silently shrink the
      // comparison and flatter whichever side is missing a price.
      unpricedCount += 1;
      positions.push({ instrument, quantity: balance.quantity, valueUsd: null });
      continue;
    }
    const value = new Decimal(decimal(balance.quantity)).mul(decimal(observation.priceUsd));
    total = total.add(value);
    positions.push({ instrument, quantity: balance.quantity, valueUsd: value.toFixed(2) });
  }

  const opening = balances.reduce<number | null>(
    (earliest, balance) =>
      earliest === null || balance.updatedAt < earliest ? balance.updatedAt : earliest,
    null,
  );

  const latest = latestWalletDecisionRun(profileId, database);

  return {
    profileId,
    asOfMs,
    simulation: true,
    startedAtMs: opening,
    cashUsd,
    positions: Object.freeze(positions),
    // A total that omits an unpriced position would understate the simulation
    // without saying so, exactly as the real portfolio refuses to.
    totalValueUsd: unpricedCount > 0 ? null : total.toFixed(2),
    unpricedCount,
    lastRun:
      latest === null
        ? null
        : {
            scheduledForMs: latest.scheduledFor,
            decidedAtMs: latest.createdAt,
            ...parseLastRun(latest.snapshotJson),
          },
    evidence: forwardPaperEvidence({ database, clock: dependencies.clock }, profileId),
  };
}
