/** Explainable, conservative entry scoring for paper auto-trading. */

import { realizedVolatilityPct, rsi, sma } from '../indicators/index.js';
import {
  decimal,
  instrumentKey,
  type AllocationPolicy,
  type AssetRef,
  type ExecutionIntent,
  type Holding,
  type InstrumentKey,
} from '../types/index.js';

export interface BuyCandidateMarket {
  asset: AssetRef;
  priceUsd: number;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  rank: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  closes: number[];
}

export interface BuyCandidateConfig {
  minScore: number;
  minVolume24hUsd: number;
  minMarketCapUsd: number;
  maxRank: number;
  minHistoryDays: number;
  maxRsi: number;
  maxDailyMovePct: number;
  maxVolatilityPct: number;
  sleevePct: number;
  maxCandidates: number;
  maxCandidateWeightPct: number;
}

export interface BuyCandidateScore {
  asset: AssetRef;
  action: 'BUY' | 'HOLD';
  score: number;
  reasonCode: string;
  explanation: string;
  targetWeight: number;
  priceUsd: number;
  checks: {
    trendConfirmed: boolean;
    momentumConfirmed: boolean;
    liquidityOk: boolean;
    notOverextended: boolean;
    volatilityOk: boolean;
    alreadyHeld: boolean;
  };
  metrics: {
    rsi14: number | null;
    return7dPct: number | null;
    return30dPct: number | null;
    volatility30dPct: number | null;
    volume24hUsd: number | null;
    marketCapUsd: number | null;
  };
}

export interface BuyCandidateOverlay {
  targets: AllocationPolicy['targets'];
  candidateHoldings: Holding[];
  selected: BuyCandidateScore[];
  evaluated: BuyCandidateScore[];
}

export const DEFAULT_BUY_CANDIDATE_CONFIG: BuyCandidateConfig = {
  minScore: 70,
  minVolume24hUsd: 2_000_000,
  minMarketCapUsd: 50_000_000,
  maxRank: 250,
  minHistoryDays: 35,
  maxRsi: 74,
  maxDailyMovePct: 20,
  maxVolatilityPct: 160,
  sleevePct: 0.08,
  maxCandidates: 2,
  maxCandidateWeightPct: 0.08,
};

const STABLE_OR_WRAPPED = new Set([
  'USD',
  'USDC',
  'USDT',
  'DAI',
  'FDUSD',
  'PYUSD',
  'TUSD',
  'USDS',
  'WBTC',
  'WETH',
  'CBETH',
  'RETH',
  'STETH',
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function pctReturn(closes: readonly number[], days: number): number | null {
  if (closes.length <= days) return null;
  const start = closes[closes.length - 1 - days]!;
  const end = closes[closes.length - 1]!;
  if (start <= 0 || end <= 0) return null;
  return (end / start - 1) * 100;
}

function scoreBand(value: number, goodAt: number, weakAt: number): number {
  if (value >= goodAt) return 1;
  if (value <= weakAt) return 0;
  return (value - weakAt) / (goodAt - weakAt);
}

function reasonForHold(checks: {
  historyOk: boolean;
  liquidityOk: boolean;
  trendConfirmed: boolean;
  momentumConfirmed: boolean;
  notOverextended: boolean;
  volatilityOk: boolean;
  alreadyHeld: boolean;
}): string {
  if (checks.alreadyHeld) return 'HOLD_POSITION_ALREADY_HELD';
  if (!checks.historyOk) return 'HOLD_MARKET_DATA_INSUFFICIENT';
  if (!checks.liquidityOk) return 'HOLD_LIQUIDITY_BELOW_MINIMUM';
  if (!checks.volatilityOk) return 'HOLD_VOLATILITY_TOO_HIGH';
  if (!checks.notOverextended) return 'HOLD_OVEREXTENDED';
  if (!checks.trendConfirmed) return 'HOLD_TREND_NOT_CONFIRMED';
  if (!checks.momentumConfirmed) return 'HOLD_MOMENTUM_WEAK';
  return 'HOLD_NO_CONFIRMED_ENTRY_SIGNAL';
}

function explainBuy(
  score: number,
  return7d: number | null,
  return30d: number | null,
  relativeStrength: number | null,
): string {
  const details = [`entry score ${score.toFixed(0)}/100`];
  if (return7d !== null) details.push(`7d ${return7d >= 0 ? '+' : ''}${return7d.toFixed(1)}%`);
  if (return30d !== null) {
    details.push(`30d ${return30d >= 0 ? '+' : ''}${return30d.toFixed(1)}%`);
  }
  if (relativeStrength !== null) details.push(`RSI ${relativeStrength.toFixed(0)}`);
  return `Candidate passed the entry filter (${details.join(', ')}).`;
}

export function scoreBuyCandidate(
  market: BuyCandidateMarket,
  heldInstruments: ReadonlySet<InstrumentKey>,
  config: BuyCandidateConfig = DEFAULT_BUY_CANDIDATE_CONFIG,
): BuyCandidateScore {
  const closes = market.closes.filter((value) => Number.isFinite(value) && value > 0);
  const latest = closes[closes.length - 1] ?? market.priceUsd;
  const relativeStrength = rsi(closes, 14);
  const average7 = sma(closes, 7);
  const average30 = sma(closes, 30);
  const return7d = market.change7dPct ?? pctReturn(closes, 7);
  const return30d = pctReturn(closes, 30);
  const volatility = realizedVolatilityPct(closes, 30);
  const baseAsset = market.asset.baseAsset.toUpperCase();

  const alreadyHeld = heldInstruments.has(instrumentKey(market.asset.instrument));
  const historyOk = closes.length >= config.minHistoryDays && latest > 0;
  const tradeable =
    market.asset.instrument.productType === 'spot' &&
    market.asset.quoteAsset === 'USD' &&
    !STABLE_OR_WRAPPED.has(baseAsset);
  const liquidByVolume =
    market.volume24hUsd !== null && market.volume24hUsd >= config.minVolume24hUsd;
  const liquidByCap =
    market.marketCapUsd === null ||
    market.marketCapUsd >= config.minMarketCapUsd ||
    (market.rank !== null && market.rank <= config.maxRank);
  const liquidityOk = tradeable && liquidByVolume && liquidByCap;
  const trendConfirmed =
    historyOk &&
    average7 !== null &&
    average30 !== null &&
    latest >= average30 &&
    average7 >= average30;
  const momentumConfirmed =
    return7d !== null && return30d !== null && return7d > 0.5 && return30d > 0;
  const notOverextended =
    (relativeStrength === null || relativeStrength <= config.maxRsi) &&
    (market.change24hPct === null ||
      Math.abs(market.change24hPct) <= config.maxDailyMovePct) &&
    (return7d === null || return7d <= 35);
  const volatilityOk = volatility === null || volatility <= config.maxVolatilityPct;

  const trendScore =
    trendConfirmed && average30 ? clamp((latest / average30 - 1) / 0.12, 0, 1) : 0;
  const momentumScore =
    return7d !== null && return30d !== null
      ? 0.55 * scoreBand(return7d, 6, 0) + 0.45 * scoreBand(return30d, 15, -5)
      : 0;
  const rsiScore =
    relativeStrength === null
      ? 0.4
      : relativeStrength < 35
        ? 0.45
        : relativeStrength <= 62
          ? 1
          : relativeStrength <= config.maxRsi
            ? (config.maxRsi - relativeStrength) / (config.maxRsi - 62)
            : 0;
  const liquidityScore =
    market.volume24hUsd !== null
      ? clamp(Math.log10(market.volume24hUsd / config.minVolume24hUsd + 1) / 1.2, 0, 1)
      : 0;
  const volatilityScore =
    volatility === null
      ? 0.5
      : clamp((config.maxVolatilityPct - volatility) / config.maxVolatilityPct, 0, 1);
  const score = Math.round(
    30 * trendScore +
      25 * momentumScore +
      20 * rsiScore +
      15 * liquidityScore +
      10 * volatilityScore,
  );
  const hardPass =
    historyOk &&
    liquidityOk &&
    trendConfirmed &&
    momentumConfirmed &&
    notOverextended &&
    volatilityOk &&
    !alreadyHeld &&
    score >= config.minScore;
  const reasonCode = hardPass
    ? 'BUY_CANDIDATE_SCORE_CONFIRMED'
    : reasonForHold({
        historyOk,
        liquidityOk,
        trendConfirmed,
        momentumConfirmed,
        notOverextended,
        volatilityOk,
        alreadyHeld,
      });

  return {
    asset: market.asset,
    action: hardPass ? 'BUY' : 'HOLD',
    score,
    reasonCode,
    explanation: hardPass
      ? explainBuy(score, return7d, return30d, relativeStrength)
      : `Candidate held: entry score ${score}/100 did not clear the configured buy filter.`,
    targetWeight: 0,
    priceUsd: market.priceUsd,
    checks: {
      trendConfirmed,
      momentumConfirmed,
      liquidityOk,
      notOverextended,
      volatilityOk,
      alreadyHeld,
    },
    metrics: {
      rsi14: relativeStrength,
      return7dPct: return7d,
      return30dPct: return30d,
      volatility30dPct: volatility,
      volume24hUsd: market.volume24hUsd,
      marketCapUsd: market.marketCapUsd,
    },
  };
}

export function buildBuyCandidateOverlay(
  policy: AllocationPolicy,
  holdings: readonly Holding[],
  markets: readonly BuyCandidateMarket[],
  config: BuyCandidateConfig = DEFAULT_BUY_CANDIDATE_CONFIG,
): BuyCandidateOverlay {
  const heldInstruments = new Set(
    holdings.map((holding) => instrumentKey(holding.asset.instrument)),
  );
  const evaluated = markets
    .map((market) => scoreBuyCandidate(market, heldInstruments, config))
    .sort((left, right) => right.score - left.score);
  const selected = evaluated
    .filter((candidate) => candidate.action === 'BUY')
    .slice(0, Math.max(0, Math.floor(config.maxCandidates)));
  if (selected.length === 0 || policy.targets.length === 0 || holdings.length === 0) {
    return { targets: policy.targets, candidateHoldings: [], selected, evaluated };
  }

  const sleeve = clamp(config.sleevePct, 0, 0.25);
  const candidateWeight = Math.min(
    sleeve / selected.length,
    clamp(config.maxCandidateWeightPct, 0, 0.25),
  );
  const selectedSleeve = candidateWeight * selected.length;
  const candidateIds = new Set(
    selected.map((candidate) => instrumentKey(candidate.asset.instrument)),
  );
  const targets: AllocationPolicy['targets'] = [
    ...policy.targets
      .filter((target) => !candidateIds.has(instrumentKey(target.instrument)))
      .map((target) => ({ ...target, weight: target.weight * (1 - selectedSleeve) })),
    ...selected.map((candidate) => ({
      instrument: candidate.asset.instrument,
      weight: candidateWeight,
    })),
  ];

  const candidateHoldings: Holding[] = selected.map((candidate) => ({
    asset: candidate.asset,
    quantity: decimal('0'),
    avgCostUsd: decimal('0'),
    priceUsd: decimal(String(candidate.priceUsd)),
    valueUsd: decimal('0'),
    unrealizedPnlUsd: null,
    unrealizedPnlPct: null,
  }));

  return {
    targets,
    candidateHoldings,
    selected: selected.map((candidate) => ({ ...candidate, targetWeight: candidateWeight })),
    evaluated,
  };
}

export function annotateCandidateBuyIntent(
  intent: ExecutionIntent,
  candidate: BuyCandidateScore | undefined,
): ExecutionIntent {
  if (
    !candidate ||
    instrumentKey(intent.asset.instrument) !== instrumentKey(candidate.asset.instrument) ||
    intent.side !== 'buy'
  ) {
    return intent;
  }
  return {
    ...intent,
    origin: 'rule',
    urgency: 'standard',
    referencePriceUsd: decimal(String(candidate.priceUsd)),
    reason: `${candidate.explanation} Target sleeve ${(candidate.targetWeight * 100).toFixed(1)}%.`,
  };
}
