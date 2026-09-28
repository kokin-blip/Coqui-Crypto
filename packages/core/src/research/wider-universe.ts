import { Decimal } from 'decimal.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/decision.js';
import { sha256Hex } from '../crypto/sha256.js';
import type { MarketBar } from '../market/market-bars.js';
import type { UniverseProductObservation } from '../market/universe.js';
import { instrumentKey } from '../types/index.js';

export const UNIVERSE_DAY = 86_400_000;
export const UNIVERSE_COSTS = Object.freeze({ takerFee: '0.0025', adverseSlippage: '0.0015' });
export function universeHash(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}
export function freezeUniverse<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeUniverse); Object.freeze(value);
  }
  return value;
}
export interface UniversePolicy {
  readonly schemaVersion: 1; readonly version: string;
  readonly historyDays: number; readonly freshnessMs: number;
  readonly maxSpreadBps: number; readonly depthBandBps: number;
  readonly depthMultiple: number; readonly minimumTradeUsd: string;
  readonly maximumNativeMinimumUsd: string;
}
export const WIDER_UNIVERSE_POLICY: UniversePolicy = freezeUniverse({ schemaVersion: 1,
  version: 'coinbase-alpaca-usd-v1', historyDays: 180, freshnessMs: 60_000,
  maxSpreadBps: 50, depthBandBps: 50, depthMultiple: 10,
  minimumTradeUsd: '25', maximumNativeMinimumUsd: '25' });
export const STRICT_UNIVERSE_POLICY: UniversePolicy = freezeUniverse({ ...WIDER_UNIVERSE_POLICY,
  version: 'coinbase-alpaca-usd-liquid-v1', maxSpreadBps: 25, depthMultiple: 20 });
export function validateUniversePolicy(policy: UniversePolicy): void {
  if (policy.schemaVersion !== 1 || !policy.version || !Number.isSafeInteger(policy.historyDays) ||
      policy.historyDays < 180 || policy.historyDays > 400 || ![policy.freshnessMs, policy.maxSpreadBps, policy.depthBandBps,
        policy.depthMultiple].every((n) => Number.isFinite(n) && n > 0) ||
      !positive(policy.minimumTradeUsd) || !positive(policy.maximumNativeMinimumUsd) ||
      new Decimal(policy.minimumTradeUsd).lt(25) || new Decimal(policy.maximumNativeMinimumUsd).gt(25) ||
      policy.freshnessMs > 60_000 || policy.maxSpreadBps > 50 || policy.depthBandBps > 50 || policy.depthMultiple < 10) {
    throw new Error('invalid_universe_policy');
  }
}
export interface UniverseAlpacaAsset {
  readonly id: string; readonly symbol: string; readonly class: string;
  readonly status: string; readonly tradable: boolean;
  readonly min_order_size: string; readonly min_trade_increment: string;
  readonly price_increment: string;
}
export interface UniverseMapping {
  readonly assetId: string; readonly base: string; readonly coinbaseProductId: string;
  readonly alpacaAssetId: string; readonly alpacaSymbol: string;
}
export function mapUniverseProducts(products: readonly UniverseProductObservation[],
  assets: readonly UniverseAlpacaAsset[]) {
  return [...products].sort((a, b) => instrumentKey(a.instrument).localeCompare(instrumentKey(b.instrument)))
    .map((product) => {
      const matches = assets.filter((a) => a.class === 'crypto' && a.symbol === `${product.baseAsset}/USD`);
      const ambiguousBase = products.filter((p) => p.baseAsset === product.baseAsset).length !== 1;
      const validIdentity = product.instrument.productId === `${product.baseAsset}-USD` &&
        product.instrument.venue === 'coinbase' && product.instrument.productType === 'spot' && product.quoteAsset === 'USD';
      const asset = matches[0];
      const reason = !validIdentity || ambiguousBase || matches.length > 1 ? 'ambiguous_mapping'
        : asset === undefined ? 'alpaca_product_absent' : null;
      const mapping: UniverseMapping | null = reason !== null || asset === undefined ? null : {
        assetId: instrumentKey(product.instrument), base: product.baseAsset,
        coinbaseProductId: product.instrument.productId, alpacaAssetId: asset.id, alpacaSymbol: asset.symbol };
      return { product, asset: reason === null ? asset! : null, mapping, reason };
    });
}
export interface UniverseLiquidity {
  readonly quoteAtMs: number; readonly bookAtMs: number; readonly capturedAtMs: number;
  readonly bid: string; readonly ask: string;
  readonly bids: readonly { readonly price: string; readonly size: string }[];
  readonly asks: readonly { readonly price: string; readonly size: string }[];
}
export interface UniverseAssetEvidence {
  readonly product: UniverseProductObservation; readonly asset: UniverseAlpacaAsset | null;
  readonly mapping: UniverseMapping | null; readonly mappingReason: string | null;
  readonly catalogObservedAtMs: number; readonly accountObservedAtMs: number;
  readonly accountReady: boolean | null; readonly bars: readonly MarketBar[];
  readonly listedAtMs: number | null;
  readonly currentProduct: (UniverseProductObservation & { readonly baseMinSize?: string;
    readonly auctionMode?: boolean; readonly isDisabled?: boolean }) | null;
  readonly currentAsset: UniverseAlpacaAsset | null;
  readonly rulesObservedAtMs: number;
  readonly coinbase: UniverseLiquidity | null; readonly alpaca: UniverseLiquidity | null;
}
export interface UniverseCheck {
  readonly code: string; readonly status: 'pass' | 'fail' | 'unknown';
  readonly measured: string | number | null; readonly threshold: string | number | null;
}
export function positive(value: string): boolean {
  try { const d = new Decimal(value); return d.isFinite() && d.gt(0); } catch { return false; }
}
function sameDecimal(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && positive(left) && positive(right) && new Decimal(left).eq(right);
}
export function universeQuantity(value: string, increment: string, minimum: string): string {
  if (!positive(increment) || !positive(minimum)) throw new Error('invalid_quantity_rules');
  const quantity = new Decimal(value);
  if (!quantity.isFinite() || quantity.isNegative()) throw new Error('invalid_quantity');
  const rounded = quantity.div(increment).floor().mul(increment);
  return rounded.lt(minimum) ? '0' : rounded.toFixed();
}
export function universeHistory(bars: readonly MarketBar[], assetId: string, atMs: number, days: number) {
  const end = Math.floor(atMs / UNIVERSE_DAY) * UNIVERSE_DAY;
  const valid = bars.filter((b) => b.assetId === assetId && b.source === 'coinbase' && b.interval === '1d' &&
    b.quality === 'reported_ohlc' && b.isComplete && b.endTimeMs <= end &&
    b.startTimeMs % UNIVERSE_DAY === 0 && b.endTimeMs === b.startTimeMs + UNIVERSE_DAY &&
    [b.open, b.high, b.low, b.close].every((n) => Number.isFinite(n) && n > 0) &&
    b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close) &&
    b.volume !== null && Number.isFinite(b.volume) && b.volume >= 0);
  const counts = new Map<number, number>();
  valid.forEach((b) => counts.set(b.startTimeMs, (counts.get(b.startTimeMs) ?? 0) + 1));
  const missing: number[] = []; let longestGap = 0, gap = 0;
  for (let t = end - days * UNIVERSE_DAY; t < end; t += UNIVERSE_DAY) {
    if (counts.get(t) !== 1) { missing.push(t); longestGap = Math.max(longestGap, ++gap); } else gap = 0;
  }
  const times = [...counts.keys()].sort((a, b) => a - b);
  return { requestedDays: days, coveredDays: days - missing.length, missingStarts: missing, longestGap,
    incompleteBars: bars.filter((b) => !b.isComplete || b.endTimeMs > end).length,
    invalidBars: bars.length - valid.length, firstStartMs: times[0] ?? null,
    latestStartMs: times.at(-1) ?? null,
    evidencedAgeDays: times[0] === undefined ? null : Math.floor((end - times[0]) / UNIVERSE_DAY),
    hourlyReadiness: 'not_collected' as const };
}
export function evaluateUniverseAsset(evidence: UniverseAssetEvidence, atMs: number,
  policy: UniversePolicy = WIDER_UNIVERSE_POLICY, proposedNotional = policy.minimumTradeUsd) {
  validateUniversePolicy(policy);
  if (!Number.isSafeInteger(atMs) || atMs <= 0 || !positive(proposedNotional)) throw new Error('invalid_universe_time_or_notional');
  const checks: UniverseCheck[] = [];
  const check = (code: string, value: boolean | null, measured: UniverseCheck['measured'] = null,
    threshold: UniverseCheck['threshold'] = null) => checks.push({ code,
      status: value === null ? 'unknown' : value ? 'pass' : 'fail', measured, threshold });
  const p = evidence.product, a = evidence.asset;
  const mapping = evidence.mapping;
  check(evidence.mappingReason ?? 'mapping', mapping !== null && evidence.mappingReason === null &&
    mapping.assetId === instrumentKey(p.instrument) && mapping.coinbaseProductId === p.instrument.productId &&
    mapping.base === p.baseAsset && mapping.alpacaSymbol === `${p.baseAsset}/USD` &&
    mapping.alpacaAssetId === a?.id && mapping.alpacaSymbol === a.symbol);
  check('catalog_asof', evidence.catalogObservedAtMs > 0 && evidence.catalogObservedAtMs < Math.floor(atMs / UNIVERSE_DAY) * UNIVERSE_DAY &&
    evidence.catalogObservedAtMs >= (Math.floor(atMs / UNIVERSE_DAY) - 1) * UNIVERSE_DAY);
  check('account_ready', evidence.accountReady);
  check('account_fresh', atMs - evidence.accountObservedAtMs >= 0 && atMs - evidence.accountObservedAtMs <= policy.freshnessMs);
  check('coinbase_online', p.status === 'online');
  for (const flag of ['tradingDisabled', 'cancelOnly', 'limitOnly', 'postOnly'] as const) check(`coinbase_${flag}`, p[flag] === null ? null : !p[flag]);
  check('alpaca_active', a === null ? null : a.status === 'active' && a.tradable);
  const current = evidence.currentProduct, currentAsset = evidence.currentAsset;
  check('current_rules_fresh', evidence.rulesObservedAtMs <= atMs && atMs - evidence.rulesObservedAtMs <= policy.freshnessMs);
  check('coinbase_current_tradable', current === null ? null : current.status === 'online' &&
    instrumentKey(current.instrument) === instrumentKey(p.instrument) && current.baseAsset === p.baseAsset && current.quoteAsset === 'USD' &&
    [current.tradingDisabled, current.cancelOnly, current.limitOnly, current.postOnly].every((f) => f === false));
  check('alpaca_current_tradable', currentAsset === null ? null : currentAsset.status === 'active' && currentAsset.tradable);
  check('coinbase_not_auction', current?.auctionMode === undefined ? null : !current.auctionMode);
  check('coinbase_not_disabled', current?.isDisabled === undefined ? null : !current.isDisabled);
  check('rules_unchanged', current === null || currentAsset === null || a === null ? null :
    sameDecimal(current.baseIncrement, p.baseIncrement) && sameDecimal(current.quoteIncrement, p.quoteIncrement) &&
    sameDecimal(current.minMarketFunds, p.minMarketFunds) && sameDecimal(currentAsset.min_order_size, a.min_order_size) &&
    sameDecimal(currentAsset.min_trade_increment, a.min_trade_increment) && sameDecimal(currentAsset.price_increment, a.price_increment) &&
    currentAsset.id === a.id && currentAsset.symbol === a.symbol);
  const history = universeHistory(evidence.bars, instrumentKey(p.instrument), atMs, policy.historyDays);
  check('history_complete', history.missingStarts.length === 0, history.coveredDays, policy.historyDays);
  check('product_age', evidence.listedAtMs === null ? history.evidencedAgeDays === null ? null : history.evidencedAgeDays >= policy.historyDays
    : (atMs - evidence.listedAtMs) / UNIVERSE_DAY >= policy.historyDays,
  evidence.listedAtMs === null ? history.evidencedAgeDays : (atMs - evidence.listedAtMs) / UNIVERSE_DAY, policy.historyDays);
  let maximumNotional = new Decimal(Infinity);
  for (const venue of ['coinbase', 'alpaca'] as const) {
    const liquidity = evidence[venue];
    if (liquidity === null) { check(`${venue}_liquidity`, null); maximumNotional = new Decimal(0); continue; }
    const fresh = [liquidity.quoteAtMs, liquidity.bookAtMs, liquidity.capturedAtMs].every((t) =>
      Number.isSafeInteger(t) && t > 0 && t <= atMs && atMs - t <= policy.freshnessMs);
    check(`${venue}_fresh`, fresh);
    if (![liquidity.bid, liquidity.ask].every(positive) || new Decimal(liquidity.bid).gt(liquidity.ask)) {
      check(`${venue}_valid_quote`, false); maximumNotional = new Decimal(0); continue;
    }
    const mid = new Decimal(liquidity.bid).plus(liquidity.ask).div(2);
    const spread = new Decimal(liquidity.ask).minus(liquidity.bid).div(mid).mul(10_000);
    check(`${venue}_spread`, spread.lte(policy.maxSpreadBps), spread.toString(), policy.maxSpreadBps);
    let validBook = liquidity.bids.length > 0 && liquidity.asks.length > 0;
    const depths = (['bids', 'asks'] as const).map((side) => {
      let depth = new Decimal(0), previous: Decimal | null = null;
      for (const level of liquidity[side]) {
        if (!positive(level.price) || !positive(level.size)) { validBook = false; continue; }
        const price = new Decimal(level.price);
        if (previous !== null && (side === 'bids' ? price.gte(previous) : price.lte(previous))) validBook = false;
        if (side === 'bids' ? price.gt(liquidity.ask) : price.lt(liquidity.bid)) validBook = false;
        previous = price;
        if (price.minus(mid).abs().div(mid).mul(10_000).lte(policy.depthBandBps)) depth = depth.plus(price.mul(level.size));
      }
      return depth;
    });
    if (validBook && new Decimal(liquidity.bids[0]!.price).gt(liquidity.asks[0]!.price)) validBook = false;
    check(`${venue}_valid_book`, validBook);
    const support = Decimal.min(...depths).div(policy.depthMultiple);
    maximumNotional = Decimal.min(maximumNotional, validBook && fresh ? support : 0);
    check(`${venue}_depth`, validBook && support.gte(proposedNotional), support.toString(), proposedNotional);
    const increment = venue === 'coinbase' ? p.baseIncrement : a?.min_trade_increment;
    const minimum = venue === 'coinbase' ? null : a?.min_order_size;
    const quoteRule = venue === 'coinbase' ? p.quoteIncrement : a?.price_increment;
    const rulesValid = increment != null && positive(increment) && quoteRule != null && positive(quoteRule) &&
      (venue === 'coinbase' ? p.minMarketFunds !== null && positive(p.minMarketFunds) &&
        positive(current?.baseMinSize ?? '') : minimum != null && positive(minimum));
    check(`${venue}_rules`, rulesValid ? true : null);
    if (rulesValid) {
      const nativeQty = venue === 'coinbase' ? Decimal.max(current!.baseMinSize!, new Decimal(p.minMarketFunds!).div(liquidity.ask)) : new Decimal(minimum!);
      const nativeUsd = nativeQty.div(increment!).ceil().mul(increment!).mul(liquidity.ask);
      check(`${venue}_minimum`, nativeUsd.lte(policy.maximumNativeMinimumUsd), nativeUsd.toString(), policy.maximumNativeMinimumUsd);
    }
  }
  const reasons = checks.filter((c) => c.status !== 'pass').map((c) => c.code);
  return freezeUniverse({ assetId: instrumentKey(p.instrument), atMs, policyHash: universeHash(policy),
    evidenceHash: universeHash(evidence), mappingHash: universeHash(evidence.mapping),
    eligible: reasons.length === 0, reasons, checks, history,
    maximumSupportedNotional: maximumNotional.isFinite() ? maximumNotional.toString() : '0' });
}
export type UniverseEligibility = ReturnType<typeof evaluateUniverseAsset>;
