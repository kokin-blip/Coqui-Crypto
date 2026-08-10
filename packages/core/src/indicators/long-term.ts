import { realizedVolatilityPct, rsi, sma } from './technical.js';

export type LongTermAction = 'accumulate' | 'hold' | 'trim' | 'exit';
export type MarketRegime = 'calm' | 'volatile';

export interface LongTermParams {
  trendPeriod: number;
  fastPeriod: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  volLookback: number;
  volatileThresholdPct: number;
}

export const DEFAULT_LONG_TERM_PARAMS: LongTermParams = {
  trendPeriod: 200,
  fastPeriod: 50,
  rsiPeriod: 14,
  rsiOversold: 40,
  rsiOverbought: 70,
  volLookback: 30,
  volatileThresholdPct: 80,
};

export interface LongTermContext {
  /** Market-wide Fear & Greed, 0-100; absent in historical backtests. */
  fearGreed?: number | null;
}

export interface LongTermAssessment {
  action: LongTermAction;
  rationale: string;
  priceUsd: number | null;
  fastSma: number | null;
  trendSma: number | null;
  rsi: number | null;
  pctFromTrend: number | null;
  bull: boolean;
  volatilityPct: number | null;
  regime: MarketRegime;
}

export type LongTermSignalEvaluator = (closes: number[]) => {
  action: LongTermAction;
  rsi: number | null;
  regime: MarketRegime;
};

function percentDifference(value: number, basis: number): number {
  return ((value - basis) / basis) * 100;
}

/** Evaluate a slow trend-plus-pullback model over completed oldest-first closes. */
export function evaluateLongTerm(
  closes: readonly number[],
  params: LongTermParams = DEFAULT_LONG_TERM_PARAMS,
  context: LongTermContext = {},
): LongTermAssessment {
  const price = closes.length > 0 ? closes[closes.length - 1]! : null;
  const trendAverage = sma(closes, params.trendPeriod);
  const fastAverage = sma(closes, params.fastPeriod);
  const relativeStrength = rsi(closes, params.rsiPeriod);
  const pctFromTrend =
    price !== null && trendAverage !== null
      ? percentDifference(price, trendAverage)
      : null;
  const bull = price !== null && trendAverage !== null ? price >= trendAverage : false;
  const volatilityPct = realizedVolatilityPct(closes, params.volLookback);
  const regime: MarketRegime =
    volatilityPct !== null && volatilityPct >= params.volatileThresholdPct
      ? 'volatile'
      : 'calm';
  const base = {
    priceUsd: price,
    fastSma: fastAverage,
    trendSma: trendAverage,
    rsi: relativeStrength,
    pctFromTrend,
    bull,
    volatilityPct,
    regime,
  };

  if (price === null || trendAverage === null || relativeStrength === null) {
    return {
      ...base,
      action: 'hold',
      rationale: 'Insufficient price history for a long-term read.',
    };
  }

  const above = pctFromTrend! >= 0;
  const trendDescription = `${Math.abs(pctFromTrend!).toFixed(0)}% ${above ? 'above' : 'below'} its ${params.trendPeriod}-day average`;
  let action: LongTermAction;
  let rationale: string;
  if (!bull) {
    action = 'exit';
    rationale = `Long-term trend broken - price is ${trendDescription} (RSI ${relativeStrength.toFixed(0)}). Reduce / stay out until it reclaims the trend.`;
  } else if (relativeStrength >= params.rsiOverbought) {
    action = 'trim';
    rationale = `Uptrend but overbought - RSI ${relativeStrength.toFixed(0)} >= ${params.rsiOverbought}, ${trendDescription}. Trim into strength.`;
  } else if (relativeStrength <= params.rsiOversold) {
    action = 'accumulate';
    rationale = `Uptrend pullback - RSI ${relativeStrength.toFixed(0)} <= ${params.rsiOversold} while ${trendDescription}. A dip to accumulate.`;
  } else {
    action = 'hold';
    rationale = `Healthy uptrend - ${trendDescription}, RSI ${relativeStrength.toFixed(0)} (neutral). Hold.`;
  }

  const fearGreed = context.fearGreed;
  if (bull && action === 'hold' && typeof fearGreed === 'number') {
    const volatilityNote =
      regime === 'volatile' ? ' Volatile tape - scale in/out gradually.' : '';
    const greedRsi = regime === 'volatile' ? 60 : 55;
    const fearRsi = regime === 'volatile' ? 45 : 50;
    if (fearGreed >= 75 && relativeStrength >= greedRsi) {
      action = 'trim';
      rationale = `Market in extreme greed (Fear & Greed ${fearGreed}) and getting extended - RSI ${relativeStrength.toFixed(0)}, ${trendDescription}. Trim into the froth.${volatilityNote}`;
    } else if (fearGreed <= 25 && relativeStrength <= fearRsi) {
      action = 'accumulate';
      rationale = `Market in extreme fear (Fear & Greed ${fearGreed}) within an uptrend - RSI ${relativeStrength.toFixed(0)}, ${trendDescription}. Accumulate gradually.${volatilityNote}`;
    }
  }

  return { ...base, action, rationale };
}

/**
 * Adapt the model to the one shared backtest engine. The engine supplies only
 * completed closes before the execution interval and owns the venue cost model.
 */
export function createLongTermSignalEvaluator(
  params: LongTermParams = DEFAULT_LONG_TERM_PARAMS,
): LongTermSignalEvaluator {
  return (closes) => {
    const assessment = evaluateLongTerm(closes, params);
    return {
      action: assessment.action,
      rsi: assessment.rsi,
      regime: assessment.regime,
    };
  };
}
